/**
 * TrafficAreaDialog — confirm creation of a Traffic Area (mutual-exclusion
 * zone) from the group of map nodes the operator lassoed. At most `capacity`
 * AMRs may be inside the zone at once; others wait outside (no reversing).
 */
import { useState } from 'react'
import { useStorageStore } from '@/store/storage.store'
import { ApiError } from '@/services/api'

export function TrafficAreaDialog({ nodeIds, onClose }: { nodeIds: string[]; onClose: () => void }) {
  const addTrafficArea = useStorageStore(s => s.addTrafficArea)
  const existing = useStorageStore(s => s.trafficAreas)

  const [name, setName] = useState(`TZ-${existing.length + 1}`)
  const [capacity, setCapacity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const create = async () => {
    if (!name.trim() || !nodeIds.length) return
    setBusy(true); setErr('')
    try {
      await addTrafficArea({ name: name.trim(), nodeIds, capacity, enabled: true })
      setDone(true)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'failed to create traffic area')
    } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={ovl}>
      <div onClick={e => e.stopPropagation()} style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #d4dae3' }}>
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 11, letterSpacing: 2, color: '#dc2626' }}>⛒ NEW TRAFFIC AREA</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {done ? (
            <div style={{ fontSize: 12, color: '#16a34a' }}>✓ Created. Restart SIM to apply the new zone.</div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: '#4a5568' }}>
                Zone over <b style={{ color: '#dc2626' }}>{nodeIds.length}</b> node(s). At most <b>{capacity}</b> AMR(s) inside at once — others wait outside.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 90, overflowY: 'auto' }}>
                {nodeIds.map(id => (
                  <span key={id} style={{ fontSize: 9, fontFamily: 'Roboto Mono', padding: '1px 5px', borderRadius: 2, color: '#dc2626', border: '1px solid rgba(220,38,38,0.3)' }}>{id}</span>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
                <div><Lbl>Name</Lbl><input value={name} onChange={e => setName(e.target.value)} style={inp} placeholder="TZ-1" /></div>
                <div><Lbl>Capacity</Lbl>
                  <input type="number" min={1} max={9} value={capacity} onChange={e => setCapacity(Math.max(1, +e.target.value || 1))} style={inp} />
                </div>
              </div>
              {err && <div style={{ fontSize: 10, color: '#dc2626' }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={create} disabled={busy || !nodeIds.length} style={{ ...primaryBtn, opacity: busy ? 0.5 : 1 }}>
                  {busy ? '… CREATING' : '+ CREATE ZONE'}
                </button>
                <button onClick={onClose} style={cancelBtn}>CANCEL</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const Lbl = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 9, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', marginBottom: 3 }}>{children}</div>
)
const ovl: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
const panel: React.CSSProperties = { width: 440, maxHeight: '84vh', background: '#ffffff', border: '1px solid #d4dae3', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter, "Noto Sans JP", sans-serif', color: '#1a2230' }
const inp: React.CSSProperties = { background: '#f3f6fa', color: '#1a2230', border: '1px solid #d4dae3', borderRadius: 2, padding: '5px 7px', fontSize: 10, fontFamily: 'Roboto Mono', width: '100%', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer', color: '#dc2626', border: '1px solid rgba(220,38,38,0.4)', background: 'rgba(220,38,38,0.08)' }
const cancelBtn: React.CSSProperties = { padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer', color: '#64748b', border: '1px solid #d4dae3', background: 'transparent' }
