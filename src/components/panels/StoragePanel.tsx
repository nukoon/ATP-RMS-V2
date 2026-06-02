/**
 * StoragePanel — right-panel STORAGE tab. Live view of storage areas with a
 * one-click EMPTY/FULL toggle, a compact quick-add, and a MANAGE button that
 * opens the full editor (StorageDialog) for action bindings / templates.
 */
import { useEffect, useState } from 'react'
import { useStorageStore } from '@/store/storage.store'
import { useFleetStore } from '@/store/fleet.store'
import type { StorageKind } from '@/types/fleet'
import { ApiError } from '@/services/api'

export function StoragePanel({ onManage, onMultiAdd }: { onManage: () => void; onMultiAdd?: () => void }) {
  const { storages, loaded, loadAll, addStorage, removeStorage, setState } = useStorageStore()
  const map = useFleetStore(s => s.map)
  const nodes = (map?.points ?? []).filter(p => p.cls !== 'Charge')

  const [adding, setAdding] = useState(false)
  const [name, setName]   = useState('')
  const [node, setNode]   = useState('')
  const [kind, setKind]   = useState<StorageKind>('BOTH')
  const [err, setErr]     = useState('')

  useEffect(() => { if (!loaded) loadAll().catch(() => {}) }, [loaded, loadAll])

  const add = async () => {
    const nodeId = node || nodes[0]?.id
    if (!name.trim() || !nodeId) return
    setErr('')
    try {
      await addStorage({ name: name.trim(), nodeId, kind, state: 'EMPTY', enabled: true })
      setName(''); setAdding(false)
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'failed') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px 6px' }}>
        <span style={{ fontSize: 9, letterSpacing: 2, color: '#64748b', textTransform: 'uppercase' }}>
          Storage — <span style={{ color: '#2563eb', fontFamily: 'Roboto Mono' }}>{storages.filter(s => s.state === 'FULL').length}/{storages.length} full</span>
        </span>
        {onMultiAdd && (
          <button onClick={onMultiAdd} title="Lasso nodes on the map to add many storages at once"
            style={{ marginLeft: 'auto', fontSize: 8, color: '#7c3aed', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 2, cursor: 'pointer', padding: '2px 6px', fontFamily: 'Roboto Mono' }}>▭ MULTI-ADD</button>
        )}
        <button onClick={onManage} title="Manage storages & actions"
          style={{ marginLeft: onMultiAdd ? 6 : 'auto', fontSize: 8, color: '#2563eb', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 2, cursor: 'pointer', padding: '2px 6px', fontFamily: 'Roboto Mono' }}>⚙ MANAGE</button>
      </div>

      {/* quick add */}
      <div style={{ padding: '0 12px 8px', borderBottom: '1px solid #d4dae3' }}>
        {adding ? (
          <div style={{ display: 'grid', gap: 4 }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name e.g. ST-A1" style={inp} />
            <select value={node || nodes[0]?.id || ''} onChange={e => setNode(e.target.value)} style={inp}>
              {nodes.map(n => <option key={n.id} value={n.id}>{n.id}{n.name && n.name !== n.id ? ` (${n.name})` : ''}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['PICK', 'DROP', 'BOTH'] as StorageKind[]).map(k => (
                <button key={k} onClick={() => setKind(k)}
                  style={{ flex: 1, fontSize: 9, padding: '3px 0', borderRadius: 2, cursor: 'pointer', fontFamily: 'Roboto Mono',
                    color: kind === k ? '#2563eb' : '#64748b', border: `1px solid ${kind === k ? 'rgba(37,99,235,0.4)' : '#d4dae3'}`,
                    background: kind === k ? 'rgba(37,99,235,0.08)' : 'transparent' }}>{k}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={add} style={{ ...btn, color: '#16a34a', borderColor: 'rgba(22,163,74,0.4)' }}>SAVE</button>
              <button onClick={() => { setAdding(false); setErr('') }} style={{ ...btn, color: '#64748b' }}>CANCEL</button>
            </div>
            {err && <div style={{ fontSize: 9, color: '#dc2626' }}>{err}</div>}
          </div>
        ) : (
          <button onClick={() => setAdding(true)} disabled={!nodes.length}
            style={{ ...btn, width: '100%', color: '#2563eb', borderColor: '#d4dae3', opacity: nodes.length ? 1 : 0.4 }}>+ ADD STORAGE</button>
        )}
      </div>

      {/* list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loaded && storages.length === 0 && <div style={{ fontSize: 10, color: '#94a3b4', padding: '10px 12px' }}>No storages yet</div>}
        {storages.map(s => (
          <div key={s.id} style={{ padding: '6px 12px', borderBottom: '1px solid rgba(212,218,227,0.6)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setState(s.id, s.state === 'FULL' ? 'EMPTY' : 'FULL').catch(() => {})}
              title="Toggle EMPTY/FULL"
              style={{ width: 44, fontSize: 8, fontWeight: 700, letterSpacing: 0.5, padding: '2px 0', borderRadius: 2, cursor: 'pointer', fontFamily: 'Roboto Mono',
                color: s.state === 'FULL' ? '#16a34a' : '#64748b',
                border: `1px solid ${s.state === 'FULL' ? 'rgba(22,163,74,0.4)' : '#d4dae3'}`,
                background: s.state === 'FULL' ? 'rgba(22,163,74,0.1)' : 'transparent' }}>
              {s.state}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Roboto Mono', fontSize: 10, color: '#1a2230' }}>{s.name}</div>
              <div style={{ fontSize: 8, color: '#64748b' }}>{s.kind} · @{s.nodeId}</div>
            </div>
            <button onClick={() => removeStorage(s.id).catch(() => {})} title="Delete"
              style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

const inp: React.CSSProperties = {
  background: '#f3f6fa', color: '#1a2230', border: '1px solid #d4dae3', borderRadius: 2,
  padding: '4px 6px', fontSize: 10, fontFamily: 'Roboto Mono', width: '100%', boxSizing: 'border-box',
}
const btn: React.CSSProperties = {
  padding: '4px 8px', fontSize: 9, fontWeight: 600, letterSpacing: 0.5, borderRadius: 2, cursor: 'pointer',
  border: '1px solid #d4dae3', background: 'transparent', fontFamily: 'Roboto Mono', flex: 1,
}
