/**
 * MultiStorageDialog — confirm bulk creation of storages from a group of map
 * nodes the operator lassoed on the canvas. Sets a shared name prefix, kind,
 * and optional area (existing or a new one created on the fly); creates one
 * storage per node (skipping nodes that already host a storage).
 */
import { useMemo, useState } from 'react'
import { useStorageStore } from '@/store/storage.store'
import type { StorageKind } from '@/types/fleet'
import { ApiError } from '@/services/api'

export function MultiStorageDialog({ nodeIds, onClose }: { nodeIds: string[]; onClose: () => void }) {
  const { storages, areas, addStorage, addArea } = useStorageStore()

  // drop nodes that already have a storage bound to them
  const taken = useMemo(() => new Set(storages.map(s => s.nodeId)), [storages])
  const fresh = nodeIds.filter(id => !taken.has(id))

  const [prefix, setPrefix] = useState('ST-')
  const [kind, setKind] = useState<StorageKind>('BOTH')
  const [areaSel, setAreaSel] = useState('')        // '' = none, '__new' = create, else area id
  const [newArea, setNewArea] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<number | null>(null)

  const create = async () => {
    if (!fresh.length) return
    setBusy(true); setErr('')
    try {
      let areaId: string | null = areaSel && areaSel !== '__new' ? areaSel : null
      if (areaSel === '__new' && newArea.trim()) {
        const a = await addArea({ name: newArea.trim(), kind, enabled: true })
        areaId = a.id
      }
      let n = 0
      for (const nodeId of fresh) {
        await addStorage({ name: `${prefix}${nodeId}`, nodeId, kind, state: 'EMPTY', enabled: true, areaId })
        n++
      }
      setDone(n)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'failed to create storages')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={ovl}>
      <div onClick={e => e.stopPropagation()} style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 11, letterSpacing: 2, color: 'var(--accent)' }}>MULTI-ADD STORAGE</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {done != null ? (
            <div style={{ fontSize: 12, color: '#16a34a' }}>✓ Created {done} storage(s).</div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                Selected <b>{nodeIds.length}</b> node(s){nodeIds.length !== fresh.length && <span style={{ color: 'var(--text-faint)' }}> · {nodeIds.length - fresh.length} already have storage (skipped)</span>}.
                Will create <b style={{ color: 'var(--accent)' }}>{fresh.length}</b>.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 90, overflowY: 'auto' }}>
                {fresh.map(id => (
                  <span key={id} style={{ fontSize: 9, fontFamily: 'Roboto Mono', padding: '1px 5px', borderRadius: 2, color: 'var(--accent)', border: '1px solid rgba(37,99,235,0.3)' }}>{prefix}{id}</span>
                ))}
                {!fresh.length && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>No free nodes in the selection.</span>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
                <div><Lbl>Name prefix</Lbl><input value={prefix} onChange={e => setPrefix(e.target.value)} style={inp} placeholder="ST-" /></div>
                <div><Lbl>Kind</Lbl>
                  <select value={kind} onChange={e => setKind(e.target.value as StorageKind)} style={inp}>
                    <option>PICK</option><option>DROP</option><option>BOTH</option>
                  </select>
                </div>
              </div>

              <div>
                <Lbl>Area (batch group)</Lbl>
                <select value={areaSel} onChange={e => setAreaSel(e.target.value)} style={inp}>
                  <option value="">— none —</option>
                  {areas.map(a => <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}
                  <option value="__new">+ new area…</option>
                </select>
                {areaSel === '__new' && (
                  <input value={newArea} onChange={e => setNewArea(e.target.value)} placeholder="New area name e.g. ZONE-A" style={{ ...inp, marginTop: 6 }} />
                )}
              </div>

              {err && <div style={{ fontSize: 10, color: '#dc2626' }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={create} disabled={busy || !fresh.length} style={{ ...primaryBtn, opacity: busy || !fresh.length ? 0.5 : 1 }}>
                  {busy ? '… CREATING' : `+ CREATE ${fresh.length}`}
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
  <div style={{ fontSize: 9, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>{children}</div>
)
const ovl: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
const panel: React.CSSProperties = { width: 440, maxHeight: '84vh', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter, "Noto Sans JP", sans-serif', color: 'var(--text)' }
const inp: React.CSSProperties = { background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 2, padding: '5px 7px', fontSize: 10, fontFamily: 'Roboto Mono', width: '100%', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer', color: '#16a34a', border: '1px solid rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.08)' }
const cancelBtn: React.CSSProperties = { padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer', color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'transparent' }
