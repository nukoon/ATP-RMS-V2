import { useState } from 'react'
import type { MapPoint } from '@/types'
import type { Mission } from '@/types/fleet'
import { useFleetStore } from '@/store/fleet.store'

const STATUS_COLOR: Record<Mission['status'], string> = {
  PENDING:   '#5a7080',
  ASSIGNED:  '#00d4ff',
  EXECUTING: '#00ff88',
  FINISHED:  '#3a7050',
  FAILED:    '#ff4444',
  CANCELLED: '#aa6644',
}

let seq = 1

export function OrderPanel({ nodes }: { nodes: MapPoint[] }) {
  const missions   = useFleetStore(s => s.missions)
  const addMission = useFleetStore(s => s.addMission)
  const cancelMission = useFleetStore(s => s.cancelMission)

  // pick reasonable defaults: first two distinct nodes
  const pickable = nodes.filter(n => n.cls !== 'Charge')
  const [from, setFrom] = useState(pickable[0]?.id ?? '')
  const [to, setTo]     = useState(pickable[1]?.id ?? '')
  const [priority, setPriority] = useState(5)

  const create = () => {
    if (!to || from === to) return
    const m: Mission = {
      id: `M${Date.now().toString().slice(-6)}-${seq}`,
      missionNo: `MS-${String(seq++).padStart(4, '0')}`,
      agvId: null, type: 'TRANSPORT', status: 'PENDING',
      priority, startNode: from, endNode: to, progress: 0,
      createdAt: new Date().toISOString(),
    }
    addMission(m)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: '#5a7080', textTransform: 'uppercase', padding: '8px 12px 6px' }}>
        Missions — <span style={{ color: '#00d4ff', fontFamily: 'Share Tech Mono' }}>{missions.filter(m => m.status === 'EXECUTING' || m.status === 'PENDING').length} active</span>
      </div>

      {/* Create form */}
      <div style={{ padding: '0 12px 8px', borderBottom: '1px solid #152030', display: 'grid', gap: 5 }}>
        <Select label="From" value={from} options={pickable} onChange={setFrom} />
        <Select label="To"   value={to}   options={pickable} onChange={setTo} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: '#5a7080', width: 34 }}>Prio</span>
          <input type="range" min={1} max={9} value={priority} onChange={e => setPriority(+e.target.value)}
            style={{ flex: 1, accentColor: '#00d4ff', height: 3 }} />
          <span style={{ fontFamily: 'Share Tech Mono', fontSize: 10, color: '#00d4ff', width: 12 }}>{priority}</span>
        </div>
        <button onClick={create} disabled={!to || from === to}
          style={{ padding: '5px 0', fontSize: 10, fontWeight: 600, letterSpacing: 1, borderRadius: 2,
            cursor: from === to ? 'not-allowed' : 'pointer', color: '#00ff88',
            border: '1px solid rgba(0,255,136,0.4)', background: 'rgba(0,255,136,0.08)', opacity: from === to ? 0.4 : 1 }}>
          + CREATE MISSION
        </button>
      </div>

      {/* List */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {missions.length === 0 && <div style={{ fontSize: 10, color: '#3a5060', padding: '10px 12px' }}>No missions yet</div>}
        {missions.slice(0, 40).map(m => (
          <div key={m.id} style={{ padding: '6px 12px', borderBottom: '1px solid rgba(21,32,48,0.6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'Share Tech Mono', fontSize: 10, color: '#00d4ff' }}>{m.missionNo}</span>
              <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, fontWeight: 700, letterSpacing: 0.5,
                color: STATUS_COLOR[m.status], border: `1px solid ${STATUS_COLOR[m.status]}40`, background: STATUS_COLOR[m.status] + '12' }}>
                {m.status}
              </span>
            </div>
            <div style={{ fontSize: 9, color: '#5a7080', marginTop: 2 }}>
              {m.startNode} → {m.endNode} {m.agvId && <span style={{ color: '#c8d8e8' }}>· {m.agvId}</span>}
            </div>
            {(m.status === 'EXECUTING' || m.status === 'ASSIGNED') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <div style={{ flex: 1, height: 3, background: '#152030', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${m.progress}%`, background: '#00ff88', transition: 'width 0.4s' }} />
                </div>
                <span style={{ fontFamily: 'Share Tech Mono', fontSize: 9, color: '#5a7080' }}>{m.progress}%</span>
                <button onClick={() => cancelMission(m.id)} title="Cancel"
                  style={{ background: 'transparent', border: 'none', color: '#ff4444', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>×</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Select({ label, value, options, onChange }:
  { label: string; value: string; options: MapPoint[]; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 9, color: '#5a7080', width: 34 }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ flex: 1, fontSize: 10, fontFamily: 'Share Tech Mono', background: '#0c1a28', color: '#c8d8e8',
          border: '1px solid #152030', borderRadius: 2, padding: '3px 4px' }}>
        {options.map(n => <option key={n.id} value={n.id}>{n.id}{n.name && n.name !== n.id ? ` (${n.name})` : ''}</option>)}
      </select>
    </div>
  )
}
