/**
 * TrafficAreaDialog — create OR edit a Traffic Area (mutual-exclusion zone).
 * Works on a draft node-set the operator builds three ways: lasso a box on the
 * map (ADD FROM MAP), type a node id (themed combobox), or remove a chip. The
 * same editor edits an existing zone (draft.id set) so old zones aren't locked.
 */
import { useState } from 'react'
import { useStorageStore } from '@/store/storage.store'
import { useFleetStore } from '@/store/fleet.store'
import { NodePicker } from '@/components/NodePicker'
import { ApiError } from '@/services/api'

export interface TrafficDraft { id?: string; name: string; capacity: number; nodeIds: string[] }

export function TrafficAreaDialog({ draft, onChange, onAddFromMap, onClose }: {
  draft: TrafficDraft
  onChange: (d: TrafficDraft) => void
  onAddFromMap: () => void
  onClose: () => void
}) {
  const addTrafficArea = useStorageStore(s => s.addTrafficArea)
  const updateTrafficArea = useStorageStore(s => s.updateTrafficArea)
  const nodeIds = (useFleetStore(s => s.map)?.points ?? []).map(p => p.id)

  const [addQ, setAddQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const setNodes = (ids: string[]) => onChange({ ...draft, nodeIds: ids })
  const removeNode = (id: string) => setNodes(draft.nodeIds.filter(n => n !== id))
  const addNode = (id: string) => { if (id && !draft.nodeIds.includes(id)) setNodes([...draft.nodeIds, id]); setAddQ('') }

  const save = async () => {
    if (!draft.name.trim() || !draft.nodeIds.length) return
    setBusy(true); setErr('')
    try {
      if (draft.id) await updateTrafficArea(draft.id, { name: draft.name.trim(), capacity: draft.capacity, nodeIds: draft.nodeIds })
      else await addTrafficArea({ name: draft.name.trim(), nodeIds: draft.nodeIds, capacity: draft.capacity, enabled: true })
      onClose()
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'failed to save traffic area') }
    finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={ovl}>
      <div onClick={e => e.stopPropagation()} style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 11, letterSpacing: 2, color: '#dc2626' }}>⛒ {draft.id ? 'EDIT' : 'NEW'} TRAFFIC AREA</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
            Zone over <b style={{ color: '#dc2626' }}>{draft.nodeIds.length}</b> node(s). At most <b>{draft.capacity}</b> AMR(s) inside at once — others wait outside.
          </div>

          {/* node chips (click × to remove) */}
          <div>
            <Lbl>Nodes</Lbl>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 96, overflowY: 'auto',
              border: '1px solid var(--border)', borderRadius: 3, padding: 6, minHeight: 30, background: 'var(--surface-2)' }}>
              {draft.nodeIds.map(id => (
                <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontFamily: 'Roboto Mono', padding: '1px 3px 1px 6px', borderRadius: 2, color: '#dc2626', border: '1px solid rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.08)' }}>
                  {id}
                  <button onClick={() => removeNode(id)} title="remove" style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '0 1px' }}>×</button>
                </span>
              ))}
              {!draft.nodeIds.length && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>No nodes — add below or from the map.</span>}
            </div>
          </div>

          {/* add a node: type an id, or lasso a batch on the map */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
            <NodePicker value={addQ} nodeIds={nodeIds} placeholder="Type a node id to add (e.g. LM12)"
              onChange={v => { if (nodeIds.includes(v)) addNode(v); else setAddQ(v) }} />
            <button onClick={() => addNode(addQ)} disabled={!nodeIds.includes(addQ)}
              style={{ ...miniBtn, color: nodeIds.includes(addQ) ? 'var(--accent)' : 'var(--text-faint)', opacity: nodeIds.includes(addQ) ? 1 : 0.6 }}>+ ADD</button>
          </div>
          <button onClick={onAddFromMap}
            style={{ ...miniBtn, alignSelf: 'flex-start', color: '#dc2626', border: '1px solid rgba(220,38,38,0.4)', background: 'rgba(220,38,38,0.06)', padding: '4px 10px' }}>
            ▭ ADD FROM MAP (lasso)
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
            <div><Lbl>Name</Lbl><input value={draft.name} onChange={e => onChange({ ...draft, name: e.target.value })} style={inp} placeholder="TZ-1" /></div>
            <div><Lbl>Capacity</Lbl>
              <input type="number" min={1} max={9} value={draft.capacity} onChange={e => onChange({ ...draft, capacity: Math.max(1, +e.target.value || 1) })} style={inp} />
            </div>
          </div>

          {err && <div style={{ fontSize: 10, color: '#dc2626' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={busy || !draft.nodeIds.length || !draft.name.trim()} style={{ ...primaryBtn, opacity: busy || !draft.nodeIds.length || !draft.name.trim() ? 0.5 : 1 }}>
              {busy ? '… SAVING' : draft.id ? 'SAVE CHANGES' : '+ CREATE ZONE'}
            </button>
            <button onClick={onClose} style={cancelBtn}>CANCEL</button>
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>Changes take effect on the next START SIM.</div>
        </div>
      </div>
    </div>
  )
}

const Lbl = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 9, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>{children}</div>
)
const ovl: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
const panel: React.CSSProperties = { width: 460, maxHeight: '86vh', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter, "Noto Sans JP", sans-serif', color: 'var(--text)' }
const inp: React.CSSProperties = { background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 2, padding: '5px 7px', fontSize: 10, fontFamily: 'Roboto Mono', width: '100%', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer', color: '#dc2626', border: '1px solid rgba(220,38,38,0.4)', background: 'rgba(220,38,38,0.08)' }
const cancelBtn: React.CSSProperties = { padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer', color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'transparent' }
const miniBtn: React.CSSProperties = { fontSize: 10, padding: '5px 8px', borderRadius: 2, cursor: 'pointer', color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'transparent', fontFamily: 'Roboto Mono', whiteSpace: 'nowrap' }
