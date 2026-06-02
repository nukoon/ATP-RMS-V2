/**
 * Storage Store — DB-backed pickup/delivery storage areas, the VDA5050 action
 * templates, and per-storage action bindings. Storages bind to a map location
 * node and carry an EMPTY/FULL state shown on the map. All mutations go through
 * the backend API (server/index.js); nothing is persisted to localStorage.
 */
import { create } from 'zustand'
import { api } from '@/services/api'
import type {
  Storage, StorageState, StorageArea, Dock, TrafficArea, VdaActionTemplate, StorageActionBinding,
} from '@/types/fleet'

interface StorageStore {
  storages: Storage[]
  areas: StorageArea[]
  docks: Dock[]
  trafficAreas: TrafficArea[]
  templates: VdaActionTemplate[]
  bindings: Record<string, StorageActionBinding[]>  // storageId → bindings
  loaded: boolean

  loadAll: () => Promise<void>

  addTrafficArea:    (a: Partial<TrafficArea>) => Promise<TrafficArea>
  updateTrafficArea: (id: string, patch: Partial<TrafficArea>) => Promise<void>
  removeTrafficArea: (id: string) => Promise<void>

  addStorage:    (s: Partial<Storage>) => Promise<Storage>
  updateStorage: (id: string, patch: Partial<Storage>) => Promise<void>
  removeStorage: (id: string) => Promise<void>
  setState:      (id: string, state: StorageState) => Promise<void>

  addArea:    (a: Partial<StorageArea>) => Promise<StorageArea>
  updateArea: (id: string, patch: Partial<StorageArea>) => Promise<void>
  removeArea: (id: string) => Promise<void>
  setAreaState: (areaId: string, state: StorageState) => Promise<void>  // batch FULL/EMPTY

  addDock:    (d: Partial<Dock>) => Promise<Dock>
  updateDock: (id: string, patch: Partial<Dock>) => Promise<void>
  removeDock: (id: string) => Promise<void>

  addTemplate:    (a: Partial<VdaActionTemplate>) => Promise<void>
  updateTemplate: (id: string, patch: Partial<VdaActionTemplate>) => Promise<void>
  removeTemplate: (id: string) => Promise<void>

  loadBindings: (storageId: string) => Promise<StorageActionBinding[]>
  saveBindings: (storageId: string, bindings: StorageActionBinding[]) => Promise<void>
}

export const useStorageStore = create<StorageStore>((set, get) => ({
  storages: [],
  areas: [],
  docks: [],
  trafficAreas: [],
  templates: [],
  bindings: {},
  loaded: false,

  loadAll: async () => {
    // Resilient load: a single missing/failing endpoint (e.g. an older backend
    // without /traffic-areas) must NOT blank out the others. Each falls back to
    // an empty list independently.
    const safe = async <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [])
    const [storages, templates, areas, docks, trafficAreas] = await Promise.all([
      safe(api.listStorages()), safe(api.listActions()), safe(api.listAreas()),
      safe(api.listDocks()), safe(api.listTrafficAreas()),
    ])
    set({ storages, templates, areas, docks, trafficAreas, loaded: true })
  },

  addTrafficArea: async (a) => {
    const created = await api.createTrafficArea(a)
    set(st => ({ trafficAreas: [...st.trafficAreas, created].sort((x, y) => x.name.localeCompare(y.name)) }))
    return created
  },
  updateTrafficArea: async (id, patch) => {
    const updated = await api.updateTrafficArea(id, patch)
    set(st => ({ trafficAreas: st.trafficAreas.map(a => a.id === id ? updated : a) }))
  },
  removeTrafficArea: async (id) => {
    await api.deleteTrafficArea(id)
    set(st => ({ trafficAreas: st.trafficAreas.filter(a => a.id !== id) }))
  },

  addStorage: async (s) => {
    const created = await api.createStorage(s)
    set(st => ({ storages: [...st.storages, created].sort((a, b) => a.name.localeCompare(b.name)) }))
    return created
  },
  updateStorage: async (id, patch) => {
    const updated = await api.updateStorage(id, patch)
    set(st => ({ storages: st.storages.map(s => s.id === id ? updated : s) }))
  },
  removeStorage: async (id) => {
    await api.deleteStorage(id)
    set(st => ({ storages: st.storages.filter(s => s.id !== id) }))
  },
  setState: async (id, state) => {
    // optimistic flip so the map/icon updates immediately, then persist
    set(st => ({ storages: st.storages.map(s => s.id === id ? { ...s, state } : s) }))
    try { await api.updateStorage(id, { state }) }
    catch (e) { await get().loadAll(); throw e }
  },

  addArea: async (a) => {
    const created = await api.createArea(a)
    set(st => ({ areas: [...st.areas, created].sort((x, y) => x.name.localeCompare(y.name)) }))
    return created
  },
  updateArea: async (id, patch) => {
    const updated = await api.updateArea(id, patch)
    set(st => ({ areas: st.areas.map(a => a.id === id ? updated : a) }))
  },
  removeArea: async (id) => {
    await api.deleteArea(id)
    // server orphans members → drop the areaId locally too
    set(st => ({
      areas: st.areas.filter(a => a.id !== id),
      storages: st.storages.map(s => s.areaId === id ? { ...s, areaId: null } : s),
    }))
  },
  setAreaState: async (areaId, state) => {
    const members = get().storages.filter(s => s.areaId === areaId)
    if (!members.length) return
    // optimistic flip for the whole group, then persist each (re-sync on error)
    set(st => ({ storages: st.storages.map(s => s.areaId === areaId ? { ...s, state } : s) }))
    try { await Promise.all(members.map(m => api.updateStorage(m.id, { state }))) }
    catch (e) { await get().loadAll(); throw e }
  },

  addDock: async (d) => {
    const created = await api.createDock(d)
    set(st => ({ docks: [...st.docks, created] }))
    return created
  },
  updateDock: async (id, patch) => {
    const updated = await api.updateDock(id, patch)
    set(st => ({ docks: st.docks.map(d => d.id === id ? updated : d) }))
  },
  removeDock: async (id) => {
    await api.deleteDock(id)
    set(st => ({ docks: st.docks.filter(d => d.id !== id) }))
  },

  addTemplate: async (a) => {
    const created = await api.createAction(a)
    set(st => ({ templates: [...st.templates, created] }))
  },
  updateTemplate: async (id, patch) => {
    const updated = await api.updateAction(id, patch)
    set(st => ({ templates: st.templates.map(t => t.id === id ? updated : t) }))
  },
  removeTemplate: async (id) => {
    await api.deleteAction(id)
    set(st => ({ templates: st.templates.filter(t => t.id !== id) }))
  },

  loadBindings: async (storageId) => {
    const bindings = await api.listStorageActions(storageId)
    set(st => ({ bindings: { ...st.bindings, [storageId]: bindings } }))
    return bindings
  },
  saveBindings: async (storageId, bindings) => {
    const saved = await api.setStorageActions(storageId, bindings)
    set(st => ({ bindings: { ...st.bindings, [storageId]: saved } }))
  },
}))
