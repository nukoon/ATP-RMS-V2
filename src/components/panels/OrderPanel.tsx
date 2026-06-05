/**
 * OrderPanel — create & track storage transport missions.
 * A mission moves a load from a PICKUP storage (FULL) to a DROPOFF storage
 * (EMPTY); both are chosen by storage name and resolve to map nodes + a
 * VDA5050 action plan on the backend. On completion the storages flip state.
 */
import { useState } from 'react'
import type { Mission, Storage, StorageArea, AmrConfig } from '@/types/fleet'
import { useFleetStore } from '@/store/fleet.store'
import { useStorageStore } from '@/store/storage.store'
import { useConfigStore } from '@/store/config.store'
import { useAuthStore } from '@/store/auth.store'
import { api, ApiError } from '@/services/api'
import { mqttService } from '@/services/mqtt.service'
import { buildVda5050Order } from '@/services/order.service'
import { VDA_BRANDS } from '@/constants/vda-brands'

// the VDA5050 manufacturer segment for a robot comes from its brand preset
const mfrOf = (a: AmrConfig) => (VDA_BRANDS[a.brand] ?? VDA_BRANDS.aiten).manufacturer

const STATUS_COLOR: Record<Mission['status'], string> = {
  PENDING:   'var(--text-muted)',
  ASSIGNED:  'var(--accent)',
  EXECUTING: '#16a34a',
  FINISHED:  '#15803d',
  FAILED:    '#dc2626',
  CANCELLED: '#b45309',
}

export type JobPick = 'pickup' | 'dropoff' | 'pickArea' | 'dropArea'
export interface JobSel { pickup?: string; dropoff?: string; pickArea?: string; dropArea?: string }

export function OrderPanel({ onManageStorage, sel, setSel, pickMode, onRequestPick }: {
  onManageStorage?: () => void
  sel: JobSel
  setSel: (updater: (s: JobSel) => JobSel) => void
  pickMode: JobPick | null
  onRequestPick: (m: JobPick | null) => void
}) {
  const missions    = useFleetStore(s => s.missions)
  const addMission  = useFleetStore(s => s.addMission)
  const cancelMission = useFleetStore(s => s.cancelMission)
  const updateMission = useFleetStore(s => s.updateMission)
  const map         = useFleetStore(s => s.map)
  const mqttConnected = useFleetStore(s => s.mqttConnected)
  const storages    = useStorageStore(s => s.storages)
  const amrs        = useConfigStore(s => s.amrs)

  const areas       = useStorageStore(s => s.areas)

  const pickups  = storages.filter(s => s.enabled && (s.kind === 'PICK' || s.kind === 'BOTH') && s.state === 'FULL')
  const dropoffs = storages.filter(s => s.enabled && (s.kind === 'DROP' || s.kind === 'BOTH') && s.state === 'EMPTY')

  // batch: areas with at least one ready member (FULL pickups / EMPTY dropoffs)
  const countIn = (areaId: string, set: Storage[]) => set.filter(s => s.areaId === areaId).length
  const pickAreas = areas.filter(a => a.enabled && (a.kind === 'PICK' || a.kind === 'BOTH') && countIn(a.id, pickups) > 0)
  const dropAreas = areas.filter(a => a.enabled && (a.kind === 'DROP' || a.kind === 'BOTH') && countIn(a.id, dropoffs) > 0)

  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [priority, setPriority] = useState(5)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')

  const role = useAuthStore(s => s.user?.role)
  const canCommand = role !== 'VIEWER'   // VIEWER is read-only (server enforces too)

  // selections live in App so a map click can set them; a picked id that isn't in
  // the default valid set is still shown (prepended) so the dropdown stays in sync.
  const setField = (k: JobPick, v: string) => setSel(s => ({ ...s, [k]: v }))
  const withSel = (opts: Storage[], id?: string) =>
    id && !opts.some(o => o.id === id) ? [storages.find(s => s.id === id), ...opts].filter(Boolean) as Storage[] : opts
  const withSelArea = (opts: StorageArea[], id?: string) =>
    id && !opts.some(o => o.id === id) ? [areas.find(a => a.id === id), ...opts].filter(Boolean) as StorageArea[] : opts

  const pickOpts  = withSel(pickups, sel.pickup)
  const dropOpts  = withSel(dropoffs, sel.dropoff)
  const pAreaOpts = withSelArea(pickAreas, sel.pickArea)
  const dAreaOpts = withSelArea(dropAreas, sel.dropArea)
  const pickId  = sel.pickup   || pickups[0]?.id   || ''
  const dropId  = sel.dropoff  || dropoffs[0]?.id  || ''
  const pAreaId = sel.pickArea || pickAreas[0]?.id || ''
  const dAreaId = sel.dropArea || dropAreas[0]?.id || ''
  // can't pick from an EMPTY source nor deliver to a FULL destination (server also enforces);
  // relevant when a map-pick selects a stock outside the default FULL/EMPTY lists
  const pickStore = storages.find(s => s.id === pickId)
  const dropStore = storages.find(s => s.id === dropId)
  const pickBad = mode === 'single' && !!pickStore && pickStore.state !== 'FULL'
  const dropBad = mode === 'single' && !!dropStore && dropStore.state !== 'EMPTY'
  const canCreate = !busy && canCommand && (mode === 'single'
    ? (!!pickId && !!dropId && pickId !== dropId && !pickBad && !dropBad)
    : (!!pAreaId && !!dAreaId))

  const create = async () => {
    if (!canCreate) return
    setErr(''); setBusy(true)
    try {
      if (mode === 'batch') {
        const created = await api.createBatchMissions({ pickupAreaId: pAreaId, dropoffAreaId: dAreaId, priority })
        for (const m of created) {
          addMission(m)
          if (mqttConnected) {
            const target = amrs.find(a => a.enabled)
            if (target) mqttService.sendOrder(target.serial, buildVda5050Order(target.serial, mfrOf(target), m, map))
          }
        }
        setSel(s => ({ ...s, pickArea: undefined, dropArea: undefined })); onRequestPick(null)
      } else {
        const m = await api.createMission({ pickupStorageId: pickId, dropoffStorageId: dropId, priority })
        addMission(m)
        // LIVE: publish a VDA5050 Order (with the resolved PICK/DROP actions) to a real robot
        if (mqttConnected) {
          const target = amrs.find(a => a.enabled)
          if (target) mqttService.sendOrder(target.serial, buildVda5050Order(target.serial, mfrOf(target), m, map))
        }
        setSel(s => ({ ...s, pickup: undefined, dropoff: undefined })); onRequestPick(null)
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'failed to create mission')
    } finally {
      setBusy(false)
    }
  }

  const activeCount = missions.filter(m => m.status === 'EXECUTING' || m.status === 'PENDING').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px 6px' }}>
        <span style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          Missions — <span style={{ color: 'var(--accent)', fontFamily: 'Roboto Mono' }}>{activeCount} active</span>
        </span>
        {onManageStorage && (
          <button onClick={onManageStorage} title="Manage storages"
            style={{ marginLeft: 'auto', fontSize: 8, color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer', padding: '2px 6px', fontFamily: 'Roboto Mono' }}>⚙ STORAGE</button>
        )}
      </div>

      {/* Create form */}
      <div style={{ padding: '0 12px 8px', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 5 }}>
        {/* mode toggle: single storage vs batch (area) */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['single', 'batch'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{ flex: 1, fontSize: 9, padding: '3px 0', borderRadius: 2, cursor: 'pointer', fontFamily: 'Roboto Mono',
                color: mode === m ? 'var(--accent)' : 'var(--text-muted)', border: `1px solid ${mode === m ? 'rgba(37,99,235,0.4)' : 'var(--border)'}`,
                background: mode === m ? 'rgba(37,99,235,0.08)' : 'transparent' }}>
              {m === 'single' ? 'SINGLE' : 'BATCH (AREA)'}
            </button>
          ))}
        </div>
        {mode === 'single' ? (
          <>
            <StorageSelect label="Pickup"  value={pickId} options={pickOpts}  onChange={v => setField('pickup', v)} empty="No FULL pickup storage"
              picking={pickMode === 'pickup'}  onPick={() => onRequestPick(pickMode === 'pickup' ? null : 'pickup')} />
            <StorageSelect label="Dropoff" value={dropId} options={dropOpts} onChange={v => setField('dropoff', v)} empty="No EMPTY dropoff storage"
              picking={pickMode === 'dropoff'} onPick={() => onRequestPick(pickMode === 'dropoff' ? null : 'dropoff')} />
            {pickMode && <div style={{ fontSize: 8, color: '#7c3aed' }}>Click the {pickMode === 'pickup' ? 'pickup' : 'dropoff'} stock on the map…</div>}
          </>
        ) : (
          <>
            <AreaSelect label="Pick area" value={pAreaId} options={pAreaOpts} counts={a => countIn(a, pickups)} onChange={v => setField('pickArea', v)} empty="No area with FULL pickups"
              picking={pickMode === 'pickArea'} onPick={() => onRequestPick(pickMode === 'pickArea' ? null : 'pickArea')} />
            <AreaSelect label="Drop area" value={dAreaId} options={dAreaOpts} counts={a => countIn(a, dropoffs)} onChange={v => setField('dropArea', v)} empty="No area with EMPTY dropoffs"
              picking={pickMode === 'dropArea'} onPick={() => onRequestPick(pickMode === 'dropArea' ? null : 'dropArea')} />
            {pickMode ? <div style={{ fontSize: 8, color: '#7c3aed' }}>Click the {pickMode === 'pickArea' ? 'pick' : 'drop'} area on the map…</div> : (
              <div style={{ fontSize: 8, color: 'var(--text-faint)' }}>
                Creates {Math.min(countIn(pAreaId, pickups), countIn(dAreaId, dropoffs)) || 0} mission(s) — FULL pickups paired with EMPTY dropoffs.
              </div>
            )}
          </>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 42 }}>Prio</span>
          <input type="range" min={1} max={9} value={priority} onChange={e => setPriority(+e.target.value)}
            style={{ flex: 1, accentColor: 'var(--accent)', height: 3 }} />
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 10, color: 'var(--accent)', width: 12 }}>{priority}</span>
        </div>
        <button onClick={create} disabled={!canCreate}
          style={{ padding: '5px 0', fontSize: 10, fontWeight: 600, letterSpacing: 1, borderRadius: 2,
            cursor: canCreate ? 'pointer' : 'not-allowed', color: '#16a34a',
            border: '1px solid rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.08)', opacity: canCreate ? 1 : 0.4 }}>
          {busy ? '… CREATING' : mode === 'batch' ? '+ CREATE BATCH' : '+ CREATE MISSION'}
        </button>
        {pickBad && <div style={{ fontSize: 9, color: '#dc2626' }}>Pickup {pickStore?.name} is EMPTY — nothing to pick up.</div>}
        {dropBad && <div style={{ fontSize: 9, color: '#dc2626' }}>Dropoff {dropStore?.name} is FULL — no space to deliver.</div>}
        {err && <div style={{ fontSize: 9, color: '#dc2626' }}>{err}</div>}
        {!canCommand && <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>Your role (VIEWER) is read-only — ask an OPERATOR or ADMIN to issue commands.</div>}
        {!storages.length && <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>No storages yet — add some in the STORAGE tab.</div>}
      </div>

      {/* List */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {missions.length === 0 && <div style={{ fontSize: 10, color: 'var(--text-faint)', padding: '10px 12px' }}>No missions yet</div>}
        {missions.slice(0, 40).map(m => (
          <div key={m.id} style={{ padding: '6px 12px', borderBottom: '1px solid rgba(212,218,227,0.6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: 'Roboto Mono', fontSize: 10, color: 'var(--accent)' }}>{m.missionNo}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                {/* priority chip — P1 (urgent) is highlighted red */}
                <span title={`Priority ${m.priority}`} style={{ fontSize: 8, fontFamily: 'Roboto Mono', fontWeight: 700, padding: '1px 4px', borderRadius: 2,
                  color: m.priority <= 1 ? '#dc2626' : 'var(--text-muted)', border: `1px solid ${m.priority <= 1 ? 'rgba(220,38,38,0.4)' : 'var(--border)'}`,
                  background: m.priority <= 1 ? 'rgba(220,38,38,0.08)' : 'transparent' }}>
                  P{m.priority}
                </span>
                {/* urgent: jump this PENDING mission to the front of the dispatch queue */}
                {m.status === 'PENDING' && m.priority > 1 && (
                  <button onClick={() => updateMission(m.id, { priority: 1 })} title="Mark urgent (priority 1)"
                    style={{ fontSize: 9, lineHeight: 1, padding: '1px 4px', borderRadius: 2, cursor: 'pointer', color: '#dc2626',
                      border: '1px solid rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.06)' }}>⚡</button>
                )}
                <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, fontWeight: 700, letterSpacing: 0.5,
                  color: STATUS_COLOR[m.status], border: `1px solid ${STATUS_COLOR[m.status]}40`, background: STATUS_COLOR[m.status] + '12' }}>
                  {m.status}
                </span>
              </span>
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
              {(m.pickupStorageName || m.startNode)} → {(m.dropoffStorageName || m.endNode)} {m.agvId && <span style={{ color: 'var(--text)' }}>· {m.agvId}</span>}
            </div>
            {!!m.actions?.length && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                {m.actions.map((a, i) => (
                  <span key={i} style={{ fontSize: 8, fontFamily: 'Roboto Mono', padding: '0 4px', borderRadius: 2,
                    color: a.stage === 'PICK' ? 'var(--accent)' : '#f59e0b',
                    border: `1px solid ${a.stage === 'PICK' ? 'rgba(37,99,235,0.3)' : 'rgba(245,158,11,0.3)'}` }}>
                    {a.actionType}
                  </span>
                ))}
              </div>
            )}
            {(m.status === 'EXECUTING' || m.status === 'ASSIGNED') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '100%', background: '#16a34a', transform: `scaleX(${m.progress / 100})`, transformOrigin: 'left', transition: 'transform 0.4s' }} />
                </div>
                <span style={{ fontFamily: 'Roboto Mono', fontSize: 9, color: 'var(--text-muted)' }}>{m.progress}%</span>
                <button onClick={() => cancelMission(m.id)} title="Cancel"
                  style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>×</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// 📍 pin button to enter "click on the map" mode for this field
function PinBtn({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={active ? 'Cancel map pick' : 'Pick on the map'}
      style={{ flexShrink: 0, width: 24, fontSize: 11, lineHeight: 1, padding: '3px 0', borderRadius: 2, cursor: 'pointer',
        color: active ? '#fff' : '#7c3aed', border: `1px solid ${active ? '#7c3aed' : 'rgba(124,58,237,0.4)'}`,
        background: active ? '#7c3aed' : 'rgba(124,58,237,0.08)' }}>📍</button>
  )
}

function AreaSelect({ label, value, options, counts, onChange, empty, onPick, picking }:
  { label: string; value: string; options: StorageArea[]; counts: (areaId: string) => number; onChange: (v: string) => void; empty: string; onPick?: () => void; picking?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 42 }}>{label}</span>
      {options.length ? (
        <select value={value} onChange={e => onChange(e.target.value)}
          style={{ flex: 1, minWidth: 0, fontSize: 10, fontFamily: 'Roboto Mono', background: 'var(--surface-2)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 2, padding: '3px 4px' }}>
          {options.map(a => <option key={a.id} value={a.id}>{a.name} ({counts(a.id)})</option>)}
        </select>
      ) : (
        <span style={{ flex: 1, fontSize: 9, color: 'var(--text-faint)', fontStyle: 'italic' }}>{empty}</span>
      )}
      {onPick && <PinBtn active={!!picking} onClick={onPick} />}
    </div>
  )
}

function StorageSelect({ label, value, options, onChange, empty, onPick, picking }:
  { label: string; value: string; options: Storage[]; onChange: (v: string) => void; empty: string; onPick?: () => void; picking?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 42 }}>{label}</span>
      {options.length ? (
        <select value={value} onChange={e => onChange(e.target.value)}
          style={{ flex: 1, minWidth: 0, fontSize: 10, fontFamily: 'Roboto Mono', background: 'var(--surface-2)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 2, padding: '3px 4px' }}>
          {options.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : (
        <span style={{ flex: 1, fontSize: 9, color: 'var(--text-faint)', fontStyle: 'italic' }}>{empty}</span>
      )}
      {onPick && <PinBtn active={!!picking} onClick={onPick} />}
    </div>
  )
}
