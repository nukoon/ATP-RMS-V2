/**
 * FacilitiesDialog — map infrastructure that is NOT storage: parking/charging
 * DOCKS and mutual-exclusion TRAFFIC areas. Split out from the Storage editor
 * so the two concerns don't get mixed up.
 */
import { useRef, useState } from 'react'
import { useStorageStore } from '@/store/storage.store'
import { useFleetStore } from '@/store/fleet.store'
import type { DockType, TrafficArea } from '@/types/fleet'
import { FLEET_ROSTER } from '@/constants/fleet-roster'
import { downloadMapData, parseMapDataFile, importMapData } from '@/services/mapData.io'

type Tab = 'docks' | 'traffic'

export function FacilitiesDialog({ onClose, onDrawTrafficArea, onEditTrafficZone }: { onClose: () => void; onDrawTrafficArea?: () => void; onEditTrafficZone?: (z: TrafficArea) => void }) {
  const [tab, setTab] = useState<Tab>('docks')
  return (
    <div onClick={onClose} style={ovl}>
      <div onClick={e => e.stopPropagation()} style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 11, letterSpacing: 2, color: 'var(--accent)' }}>DOCKS &amp; TRAFFIC</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {([['docks', 'DOCKS (PARK / CHARGE)'], ['traffic', 'TRAFFIC AREAS']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex: 1, padding: '8px 0', fontSize: 10, fontWeight: 600, letterSpacing: 1, cursor: 'pointer', fontFamily: 'Inter, "Noto Sans JP", sans-serif',
                background: tab === k ? 'rgba(37,99,235,0.08)' : 'transparent', color: tab === k ? 'var(--accent)' : 'var(--text-muted)',
                border: 'none', borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent' }}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14 }}>
          {tab === 'docks' ? <DocksTab /> : <TrafficTab onDraw={onDrawTrafficArea} onEdit={onEditTrafficZone} />}
        </div>
        <PortabilityBar />
      </div>
    </div>
  )
}

// ── Export / Import the whole operating dataset (stock + docks + traffic) ──
function PortabilityBar() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const onExport = async () => {
    setErr(''); setMsg(''); setBusy(true)
    try {
      const doc = await downloadMapData()
      setMsg(`Exported — ${doc.counts.storages} stock · ${doc.counts.areas} areas · ${doc.counts.docks} docks · ${doc.counts.trafficAreas} traffic`)
    } catch (e) { setErr(e instanceof Error ? e.message : 'export failed') }
    finally { setBusy(false) }
  }

  const onImport = async (file: File) => {
    setErr(''); setMsg(''); setBusy(true)
    try {
      const doc = parseMapDataFile(await file.text())
      const s = await importMapData(doc)
      let m = `Imported — ${s.storages} stock · ${s.areas} areas · ${s.docks} docks · ${s.trafficAreas} traffic · ${s.bindings} action(s)`
      if (s.missingNodes.length) m += ` ⚠ ${s.missingNodes.length} node id(s) not on this map: ${s.missingNodes.slice(0, 5).join(', ')}${s.missingNodes.length > 5 ? '…' : ''}`
      setMsg(m)
    } catch (e) { setErr(e instanceof Error ? e.message : 'import failed') }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase', marginRight: 'auto' }}>Portability</span>
        <button onClick={onExport} disabled={busy} style={{ ...ioBtn, opacity: busy ? 0.5 : 1 }}>⤓ EXPORT</button>
        <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ ...ioBtn, opacity: busy ? 0.5 : 1 }}>⤒ IMPORT</button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f) }} />
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-faint)', lineHeight: 1.5 }}>
        Save all stock, areas, docks (park/charge) &amp; traffic zones to a JSON file to move to another machine. Import is additive — load the matching map first so node ids resolve.
      </div>
      {msg && <div style={{ fontSize: 10, color: '#16a34a' }}>{msg}</div>}
      {err && <div style={{ fontSize: 10, color: '#dc2626' }}>{err}</div>}
    </div>
  )
}

// ── Docks tab: parking & charging points, bind a robot ──────
function DocksTab() {
  const { docks, addDock, updateDock, removeDock } = useStorageStore()
  const map = useFleetStore(s => s.map)
  const robots = useFleetStore(s => s.robots)
  const nodes = map?.points ?? []
  const robotIds = [...new Set([...robots.keys(), ...FLEET_ROSTER.map(r => r.id)])]

  const [name, setName] = useState('')
  const [node, setNode] = useState('')
  const [type, setType] = useState<DockType>('PARK')
  const [err, setErr] = useState('')

  const create = async () => {
    const nodeId = node || nodes[0]?.id
    if (!name.trim() || !nodeId) return
    setErr('')
    try { await addDock({ name: name.trim(), nodeId, type, enabled: true }); setName('') }
    catch (e) { setErr(e instanceof Error ? e.message : 'failed') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px auto', gap: 6, alignItems: 'end' }}>
        <div><Lbl>Dock name</Lbl><input value={name} onChange={e => setName(e.target.value)} placeholder="DOCK-1" style={inp} /></div>
        <div><Lbl>Node</Lbl>
          <select value={node || nodes[0]?.id || ''} onChange={e => setNode(e.target.value)} style={inp}>
            {nodes.map(n => <option key={n.id} value={n.id}>{n.id}{n.cls === 'Charge' ? ' ⚡' : ''}</option>)}
          </select>
        </div>
        <div><Lbl>Type</Lbl>
          <select value={type} onChange={e => setType(e.target.value as DockType)} style={inp}>
            <option>PARK</option><option>CHARGE</option>
          </select>
        </div>
        <button onClick={create} style={primaryBtn}>+ ADD</button>
      </div>
      {err && <div style={{ fontSize: 10, color: '#dc2626' }}>{err}</div>}
      <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>CHARGE docks recharge robots; PARK docks just hold them. Bind a robot to reserve its home dock. Changes apply on the next START SIM.</div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <Lbl>Docks ({docks.length})</Lbl>
        {docks.length === 0 && <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>No docks yet — robots fall back to the map's Charge nodes.</div>}
        {docks.map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(212,218,227,0.6)', fontSize: 11 }}>
            <span style={{ fontFamily: 'Roboto Mono', color: d.type === 'CHARGE' ? '#ea7a00' : 'var(--accent)', width: 90 }}>{d.name}</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', flex: 1 }}>@{d.nodeId}</span>
            <select value={d.type} onChange={e => updateDock(d.id, { type: e.target.value as DockType }).catch(() => {})} style={{ ...inp, width: 80 }}>
              <option>PARK</option><option>CHARGE</option>
            </select>
            <select value={d.agvId ?? ''} onChange={e => updateDock(d.id, { agvId: e.target.value || null }).catch(() => {})} style={{ ...inp, width: 90 }} title="Bound robot">
              <option value="">any</option>
              {robotIds.map(id => <option key={id} value={id}>{id}</option>)}
              {d.agvId && !robotIds.includes(d.agvId) && <option value={d.agvId}>{d.agvId}</option>}
            </select>
            <button onClick={() => removeDock(d.id).catch(() => {})} style={{ ...miniBtn, color: '#dc2626' }}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Traffic areas tab: mutual-exclusion zones (drawn on the map) ──
function TrafficTab({ onDraw, onEdit }: { onDraw?: () => void; onEdit?: (z: TrafficArea) => void }) {
  const { trafficAreas, updateTrafficArea, removeTrafficArea } = useStorageStore()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
        Traffic Areas are zones where at most <b>N</b> AMRs may be present at once. Robots wait <i>outside</i> a full zone (no reversing) — use them on single-lane corridors or intersections the auto-router can't sequence.
      </div>
      <button onClick={onDraw} disabled={!onDraw}
        style={{ ...primaryBtn, color: '#dc2626', border: '1px solid rgba(220,38,38,0.4)', background: 'rgba(220,38,38,0.08)', alignSelf: 'flex-start' }}>
        ▭ DRAW ON MAP
      </button>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <Lbl>Zones ({trafficAreas.length})</Lbl>
        {trafficAreas.length === 0 && <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>No traffic areas — click DRAW ON MAP and lasso a corridor.</div>}
        {trafficAreas.map(z => (
          <div key={z.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(212,218,227,0.6)', fontSize: 11 }}>
            <span style={{ fontFamily: 'Roboto Mono', color: '#dc2626', flex: 1 }}>⛒ {z.name}</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{z.nodeIds.length} node(s)</span>
            <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>cap
              <input type="number" min={1} max={9} value={z.capacity}
                onChange={e => updateTrafficArea(z.id, { capacity: Math.max(1, +e.target.value || 1) }).catch(() => {})}
                style={{ ...inp, width: 42, padding: '3px 4px' }} />
            </label>
            <button onClick={() => updateTrafficArea(z.id, { enabled: !z.enabled }).catch(() => {})}
              style={{ ...miniBtn, color: z.enabled ? '#16a34a' : 'var(--text-faint)' }}>{z.enabled ? 'ON' : 'OFF'}</button>
            {onEdit && <button onClick={() => onEdit(z)} title="Edit nodes / name" style={{ ...miniBtn, color: 'var(--accent)' }}>EDIT</button>}
            <button onClick={() => removeTrafficArea(z.id).catch(() => {})} style={{ ...miniBtn, color: '#dc2626' }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>Changes take effect on the next START SIM.</div>
    </div>
  )
}

// ── shared styles ──────────────────────────────────────────
const Lbl = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 9, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>{children}</div>
)
const ovl: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
const panel: React.CSSProperties = { width: 560, maxHeight: '84vh', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter, "Noto Sans JP", sans-serif', color: 'var(--text)' }
const inp: React.CSSProperties = { background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 2, padding: '5px 7px', fontSize: 10, fontFamily: 'Roboto Mono', width: '100%', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer', color: '#16a34a', border: '1px solid rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.08)' }
const miniBtn: React.CSSProperties = { fontSize: 9, padding: '2px 6px', borderRadius: 2, cursor: 'pointer', color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'transparent', fontFamily: 'Roboto Mono' }
const ioBtn: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: 0.5, padding: '5px 12px', borderRadius: 3, cursor: 'pointer', color: 'var(--accent)', border: '1px solid rgba(37,99,235,0.4)', background: 'rgba(37,99,235,0.08)', fontFamily: 'Roboto Mono', whiteSpace: 'nowrap' }
