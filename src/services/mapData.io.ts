/**
 * mapData.io — portable EXPORT / IMPORT of a map's operating data so a setup can
 * be moved between machines. Bundles everything the dashboard layers on top of
 * the raw map file: STOCK (storages + areas), DOCKS (parking + charge), TRAFFIC
 * zones, plus the VDA5050 action templates and per-storage action bindings the
 * stock missions depend on.
 *
 * The file is plain JSON. Import is ADDITIVE and remaps every primary key, so it
 * never collides with the target DB's ids: areas → storages → templates →
 * bindings → docks → traffic. Templates are de-duplicated by `code` so repeated
 * imports don't pile up duplicates. Entities reference map *node ids*, so the
 * matching map must be loaded on the target for those ids to resolve (we report
 * any node ids that aren't present).
 */
import { api } from '@/services/api'
import { useStorageStore } from '@/store/storage.store'
import { useConfigStore } from '@/store/config.store'
import { useFleetStore } from '@/store/fleet.store'
import type {
  Storage, StorageArea, Dock, TrafficArea, VdaActionTemplate, StorageActionBinding,
} from '@/types/fleet'

export const MAP_DATA_FORMAT = 'atp-rms-map-data'
export const MAP_DATA_VERSION = 1

export interface MapDataDoc {
  format: string
  version: number
  exportedAt: string
  mapName?: string
  counts: Record<string, number>
  data: {
    areas: StorageArea[]
    storages: Storage[]
    templates: VdaActionTemplate[]
    bindings: Record<string, StorageActionBinding[]>   // storageId → bindings
    docks: Dock[]
    trafficAreas: TrafficArea[]
  }
}

export interface ImportSummary {
  areas: number
  storages: number
  docks: number
  trafficAreas: number
  templatesNew: number
  templatesReused: number
  bindings: number
  overwritten: number      // existing entities updated in place (matched by name)
  missingNodes: string[]   // node ids referenced by the file but absent on the current map
}

// Gather the full operating dataset for the current setup (fetches per-storage
// action bindings, which are otherwise lazy-loaded).
export async function buildMapDataExport(): Promise<MapDataDoc> {
  const st = useStorageStore.getState()
  if (!st.loaded) await st.loadAll()
  const { storages, areas, docks, trafficAreas, templates } = useStorageStore.getState()

  const bindings: Record<string, StorageActionBinding[]> = {}
  await Promise.all(storages.map(async s => {
    try { const b = await api.listStorageActions(s.id); if (b.length) bindings[s.id] = b } catch { /* skip */ }
  }))

  const cfg = useConfigStore.getState()
  const mapName = cfg.maps.find(m => m.id === cfg.activeMapId)?.name

  return {
    format: MAP_DATA_FORMAT,
    version: MAP_DATA_VERSION,
    exportedAt: new Date().toISOString(),
    mapName,
    counts: {
      storages: storages.length, areas: areas.length, docks: docks.length,
      trafficAreas: trafficAreas.length, templates: templates.length,
    },
    data: { areas, storages, templates, bindings, docks, trafficAreas },
  }
}

// Build the file and trigger a browser download. Returns the doc (for a summary).
export async function downloadMapData(): Promise<MapDataDoc> {
  const doc = await buildMapDataExport()
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = doc.exportedAt.slice(0, 10)
  const slug = (doc.mapName ?? 'map').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'map'
  a.href = url
  a.download = `atp-map-data-${slug}-${stamp}.json`
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
  return doc
}

export function parseMapDataFile(text: string): MapDataDoc {
  let doc: unknown
  try { doc = JSON.parse(text) } catch { throw new Error('Invalid JSON file') }
  if (!doc || typeof doc !== 'object' || (doc as MapDataDoc).format !== MAP_DATA_FORMAT) {
    throw new Error('Not an ATP map-data file (missing format tag)')
  }
  return doc as MapDataDoc
}

// Upsert every entity on the target DB. Entities are matched to existing rows by
// NAME (area/storage/dock/traffic) or CODE (templates): a match is UPDATED in
// place (override), otherwise a new row is created with a fresh id. This keeps
// import idempotent and avoids the backend's unique-name conflicts. Reloads the
// storage store at the end so the UI updates.
export async function importMapData(doc: MapDataDoc): Promise<ImportSummary> {
  const d = doc.data ?? ({} as MapDataDoc['data'])
  const cfg = useConfigStore.getState()
  const mapId = cfg.activeMapId ?? null
  const mapPoints = new Set((useFleetStore.getState().map?.points ?? []).map(p => p.id))
  const missing = new Set<string>()
  const checkNode = (id?: string | null) => { if (id && mapPoints.size && !mapPoints.has(id)) missing.add(id) }

  const summary: ImportSummary = {
    areas: 0, storages: 0, docks: 0, trafficAreas: 0,
    templatesNew: 0, templatesReused: 0, bindings: 0, overwritten: 0, missingNodes: [],
  }

  // fetch current rows fresh so we can match by name regardless of store staleness
  const [exAreas, exStorages, exDocks, exTraffic, exTemplates] = await Promise.all([
    api.listAreas().catch(() => []), api.listStorages().catch(() => []),
    api.listDocks().catch(() => []), api.listTrafficAreas().catch(() => []),
    api.listActions().catch(() => []),
  ])
  const areaByName = new Map(exAreas.map(a => [a.name, a]))
  const storageByName = new Map(exStorages.map(s => [s.name, s]))
  const dockByName = new Map(exDocks.map(d2 => [d2.name, d2]))
  const trafficByName = new Map(exTraffic.map(z => [z.name, z]))

  // 1) areas — upsert by name (old id → resolved id)
  const areaIdMap = new Map<string, string>()
  for (const a of d.areas ?? []) {
    const ex = areaByName.get(a.name)
    if (ex) {
      await api.updateArea(ex.id, { kind: a.kind, enabled: a.enabled })
      areaIdMap.set(a.id, ex.id); summary.overwritten++
    } else {
      const c = await api.createArea({ name: a.name, kind: a.kind, enabled: a.enabled, mapId })
      areaByName.set(c.name, c); areaIdMap.set(a.id, c.id)
    }
    summary.areas++
  }

  // 2) action templates — match by code (update default params / meta on match)
  const byCode = new Map(exTemplates.map(t => [t.code, t.id]))
  const templateIdMap = new Map<string, string>()
  for (const t of d.templates ?? []) {
    let id = byCode.get(t.code)
    if (!id) {
      const c = await api.createAction({
        code: t.code, actionType: t.actionType, name: t.name,
        blockingType: t.blockingType, description: t.description, defaultParams: t.defaultParams,
      })
      id = c.id; byCode.set(t.code, id); summary.templatesNew++
    } else summary.templatesReused++
    templateIdMap.set(t.id, id)
  }

  // 3) storages — upsert by name (remap areaId)
  const storageIdMap = new Map<string, string>()
  for (const s of d.storages ?? []) {
    checkNode(s.nodeId)
    const areaId = s.areaId ? (areaIdMap.get(s.areaId) ?? null) : null
    const ex = storageByName.get(s.name)
    if (ex) {
      await api.updateStorage(ex.id, { nodeId: s.nodeId, kind: s.kind, state: s.state, enabled: s.enabled, label: s.label, areaId })
      storageIdMap.set(s.id, ex.id); summary.overwritten++
    } else {
      const c = await api.createStorage({ name: s.name, nodeId: s.nodeId, kind: s.kind, state: s.state, enabled: s.enabled, label: s.label, mapId, areaId })
      storageByName.set(c.name, c); storageIdMap.set(s.id, c.id)
    }
    summary.storages++
  }

  // 4) per-storage action bindings (remap storageId + actionId; setStorageActions
  //    replaces the storage's bindings, so this overrides existing ones too)
  for (const [oldSid, binds] of Object.entries(d.bindings ?? {})) {
    const newSid = storageIdMap.get(oldSid)
    if (!newSid) continue
    const remapped: StorageActionBinding[] = binds.map(b => ({
      storageId: newSid, actionId: templateIdMap.get(b.actionId) ?? b.actionId,
      stage: b.stage, seq: b.seq, params: b.params,
    }))
    if (remapped.length) { await api.setStorageActions(newSid, remapped); summary.bindings += remapped.length }
  }

  // 5) docks (park + charge) — upsert by name
  for (const dk of d.docks ?? []) {
    checkNode(dk.nodeId)
    const ex = dockByName.get(dk.name)
    if (ex) {
      await api.updateDock(ex.id, { nodeId: dk.nodeId, type: dk.type, agvId: dk.agvId ?? null, enabled: dk.enabled })
      summary.overwritten++
    } else {
      const c = await api.createDock({ name: dk.name, nodeId: dk.nodeId, type: dk.type, agvId: dk.agvId ?? null, enabled: dk.enabled, mapId })
      dockByName.set(c.name, c)
    }
    summary.docks++
  }

  // 6) traffic zones — upsert by name
  for (const z of d.trafficAreas ?? []) {
    (z.nodeIds ?? []).forEach(checkNode)
    const ex = trafficByName.get(z.name)
    if (ex) {
      await api.updateTrafficArea(ex.id, { nodeIds: z.nodeIds, capacity: z.capacity, enabled: z.enabled })
      summary.overwritten++
    } else {
      const c = await api.createTrafficArea({ name: z.name, nodeIds: z.nodeIds, capacity: z.capacity, enabled: z.enabled, mapId })
      trafficByName.set(c.name, c)
    }
    summary.trafficAreas++
  }

  summary.missingNodes = [...missing]
  await useStorageStore.getState().loadAll()
  return summary
}
