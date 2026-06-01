/**
 * OrderPanel — create & track storage transport missions.
 * A mission moves a load from a PICKUP storage (FULL) to a DROPOFF storage
 * (EMPTY); both are chosen by storage name and resolve to map nodes + a
 * VDA5050 action plan on the backend. On completion the storages flip state.
 */
import { useState } from 'react'
import type { Mission, Storage } from '@/types/fleet'
import { useFleetStore } from '@/store/fleet.store'
import { useStorageStore } from '@/store/storage.store'
import { useConfigStore } from '@/store/config.store'
import { api, ApiError } from '@/services/api'
import { mqttService } from '@/services/mqtt.service'
import { buildVda5050Order } from '@/services/order.service'

const STATUS_COLOR: Record<Mission['status'], string> = {
  PENDING:   '#64748b',
  ASSIGNED:  '#2563eb',
  EXECUTING: '#16a34a',
  FINISHED:  '#15803d',
  FAILED:    '#dc2626',
  CANCELLED: '#b45309',
}

export function OrderPanel({ onManageStorage }: { onManageStorage?: () => void }) {
  const missions    = useFleetStore(s => s.missions)
  const addMission  = useFleetStore(s => s.addMission)
  const cancelMission = useFleetStore(s => s.cancelMission)
  const map         = useFleetStore(s => s.map)
  const mqttConnected = useFleetStore(s => s.mqttConnected)
  const storages    = useStorageStore(s => s.storages)
  const broker      = useConfigStore(s => s.broker)
  const amrs        = useConfigStore(s => s.amrs)

  const pickups  = storages.filter(s => s.enabled && (s.kind === 'PICK' || s.kind === 'BOTH') && s.state === 'FULL')
  const dropoffs = storages.filter(s => s.enabled && (s.kind === 'DROP' || s.kind === 'BOTH') && s.state === 'EMPTY')

  const [from, setFrom] = useState('')
  const [to, setTo]     = useState('')
  const [priority, setPriority] = useState(5)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')

  const pickId = from || pickups[0]?.id || ''
  const dropId = to   || dropoffs[0]?.id || ''
  const canCreate = !!pickId && !!dropId && pickId !== dropId && !busy

  const create = async () => {
    if (!canCreate) return
    setErr(''); setBusy(true)
    try {
      const m = await api.createMission({ pickupStorageId: pickId, dropoffStorageId: dropId, priority })
      addMission(m)
      // LIVE: publish a VDA5050 Order (with the resolved PICK/DROP actions) to a real robot
      if (mqttConnected) {
        const target = amrs.find(a => a.enabled)
        if (target) mqttService.sendOrder(target.serial, buildVda5050Order(target.serial, broker.manufacturer, m, map))
      }
      setFrom(''); setTo('')
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
        <span style={{ fontSize: 9, letterSpacing: 2, color: '#64748b', textTransform: 'uppercase' }}>
          Missions — <span style={{ color: '#2563eb', fontFamily: 'Roboto Mono' }}>{activeCount} active</span>
        </span>
        {onManageStorage && (
          <button onClick={onManageStorage} title="Manage storages"
            style={{ marginLeft: 'auto', fontSize: 8, color: '#64748b', background: 'transparent', border: '1px solid #d4dae3', borderRadius: 2, cursor: 'pointer', padding: '2px 6px', fontFamily: 'Roboto Mono' }}>⚙ STORAGE</button>
        )}
      </div>

      {/* Create form */}
      <div style={{ padding: '0 12px 8px', borderBottom: '1px solid #d4dae3', display: 'grid', gap: 5 }}>
        <StorageSelect label="Pickup"  value={pickId} options={pickups}  onChange={setFrom} empty="No FULL pickup storage" />
        <StorageSelect label="Dropoff" value={dropId} options={dropoffs} onChange={setTo}   empty="No EMPTY dropoff storage" />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: '#64748b', width: 42 }}>Prio</span>
          <input type="range" min={1} max={9} value={priority} onChange={e => setPriority(+e.target.value)}
            style={{ flex: 1, accentColor: '#2563eb', height: 3 }} />
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 10, color: '#2563eb', width: 12 }}>{priority}</span>
        </div>
        <button onClick={create} disabled={!canCreate}
          style={{ padding: '5px 0', fontSize: 10, fontWeight: 600, letterSpacing: 1, borderRadius: 2,
            cursor: canCreate ? 'pointer' : 'not-allowed', color: '#16a34a',
            border: '1px solid rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.08)', opacity: canCreate ? 1 : 0.4 }}>
          {busy ? '… CREATING' : '+ CREATE MISSION'}
        </button>
        {err && <div style={{ fontSize: 9, color: '#dc2626' }}>{err}</div>}
        {!storages.length && <div style={{ fontSize: 9, color: '#94a3b4' }}>No storages yet — add some in the STORAGE tab.</div>}
      </div>

      {/* List */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {missions.length === 0 && <div style={{ fontSize: 10, color: '#94a3b4', padding: '10px 12px' }}>No missions yet</div>}
        {missions.slice(0, 40).map(m => (
          <div key={m.id} style={{ padding: '6px 12px', borderBottom: '1px solid rgba(212,218,227,0.6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'Roboto Mono', fontSize: 10, color: '#2563eb' }}>{m.missionNo}</span>
              <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, fontWeight: 700, letterSpacing: 0.5,
                color: STATUS_COLOR[m.status], border: `1px solid ${STATUS_COLOR[m.status]}40`, background: STATUS_COLOR[m.status] + '12' }}>
                {m.status}
              </span>
            </div>
            <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>
              {(m.pickupStorageName || m.startNode)} → {(m.dropoffStorageName || m.endNode)} {m.agvId && <span style={{ color: '#1a2230' }}>· {m.agvId}</span>}
            </div>
            {!!m.actions?.length && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                {m.actions.map((a, i) => (
                  <span key={i} style={{ fontSize: 8, fontFamily: 'Roboto Mono', padding: '0 4px', borderRadius: 2,
                    color: a.stage === 'PICK' ? '#2563eb' : '#f59e0b',
                    border: `1px solid ${a.stage === 'PICK' ? 'rgba(37,99,235,0.3)' : 'rgba(245,158,11,0.3)'}` }}>
                    {a.actionType}
                  </span>
                ))}
              </div>
            )}
            {(m.status === 'EXECUTING' || m.status === 'ASSIGNED') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <div style={{ flex: 1, height: 3, background: '#d4dae3', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${m.progress}%`, background: '#16a34a', transition: 'width 0.4s' }} />
                </div>
                <span style={{ fontFamily: 'Roboto Mono', fontSize: 9, color: '#64748b' }}>{m.progress}%</span>
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

function StorageSelect({ label, value, options, onChange, empty }:
  { label: string; value: string; options: Storage[]; onChange: (v: string) => void; empty: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 9, color: '#64748b', width: 42 }}>{label}</span>
      {options.length ? (
        <select value={value} onChange={e => onChange(e.target.value)}
          style={{ flex: 1, fontSize: 10, fontFamily: 'Roboto Mono', background: '#f3f6fa', color: '#1a2230',
            border: '1px solid #d4dae3', borderRadius: 2, padding: '3px 4px' }}>
          {options.map(s => <option key={s.id} value={s.id}>{s.name} @ {s.nodeId}</option>)}
        </select>
      ) : (
        <span style={{ flex: 1, fontSize: 9, color: '#94a3b4', fontStyle: 'italic' }}>{empty}</span>
      )}
    </div>
  )
}
