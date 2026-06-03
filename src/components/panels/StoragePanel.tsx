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
  const { storages, areas, loaded, loadAll, addStorage, removeStorage, setState } = useStorageStore()
  const map = useFleetStore(s => s.map)
  const nodes = (map?.points ?? []).filter(p => p.cls !== 'Charge')

  const [adding, setAdding] = useState(false)
  const [name, setName]   = useState('')
  const [node, setNode]   = useState('')
  const [kind, setKind]   = useState<StorageKind>('BOTH')
  const [err, setErr]     = useState('')
  const [opened, setOpened] = useState<Set<string>>(new Set())   // groups collapsed by default
  const toggleGroup = (id: string) => setOpened(c => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n })

  // group storages by their area (areaId), with an "Ungrouped" bucket last
  const areaName = new Map(areas.map(a => [a.id, `${a.name} · ${a.kind}`]))
  const groups = new Map<string, typeof storages>()
  for (const s of storages) {
    const key = (s.areaId && areaName.has(s.areaId)) ? s.areaId : '__none__'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  }
  const groupKeys = [...groups.keys()].sort((a, b) => (a === '__none__' ? 1 : b === '__none__' ? -1 : 0))

  useEffect(() => { if (!loaded) loadAll().catch(() => {}) }, [loaded, loadAll])

  const add = async () => {
    const nodeId = node ? nodes.find(n => n.id === node)?.id : nodes[0]?.id
    if (node && !nodeId) { setErr('unknown node id'); return }
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
        <span style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          Storage — <span style={{ color: 'var(--accent)', fontFamily: 'Roboto Mono' }}>{storages.filter(s => s.state === 'FULL').length}/{storages.length} full</span>
        </span>
        {onMultiAdd && (
          <button onClick={onMultiAdd} title="Lasso nodes on the map to add many storages at once"
            style={{ marginLeft: 'auto', fontSize: 8, color: '#7c3aed', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 2, cursor: 'pointer', padding: '2px 6px', fontFamily: 'Roboto Mono' }}>▭ MULTI-ADD</button>
        )}
        <button onClick={onManage} title="Manage storages & actions"
          style={{ marginLeft: onMultiAdd ? 6 : 'auto', fontSize: 8, color: 'var(--accent)', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 2, cursor: 'pointer', padding: '2px 6px', fontFamily: 'Roboto Mono' }}>⚙ MANAGE</button>
      </div>

      {/* quick add */}
      <div style={{ padding: '0 12px 8px', borderBottom: '1px solid var(--border)' }}>
        {adding ? (
          <div style={{ display: 'grid', gap: 4 }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name e.g. ST-A1" style={inp} />
            {/* type to filter the node (e.g. "LM12" / "AP70") — faster than scrolling */}
            <input value={node} onChange={e => setNode(e.target.value.toUpperCase())} list="sp-node-list"
              placeholder={`Node e.g. ${nodes[0]?.id ?? 'LM1'}`} style={inp} />
            <datalist id="sp-node-list">
              {nodes.map(n => <option key={n.id} value={n.id}>{n.name && n.name !== n.id ? n.name : ''}</option>)}
            </datalist>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['PICK', 'DROP', 'BOTH'] as StorageKind[]).map(k => (
                <button key={k} onClick={() => setKind(k)}
                  style={{ flex: 1, fontSize: 9, padding: '3px 0', borderRadius: 2, cursor: 'pointer', fontFamily: 'Roboto Mono',
                    color: kind === k ? 'var(--accent)' : 'var(--text-muted)', border: `1px solid ${kind === k ? 'rgba(37,99,235,0.4)' : 'var(--border)'}`,
                    background: kind === k ? 'rgba(37,99,235,0.08)' : 'transparent' }}>{k}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={add} style={{ ...btn, color: '#16a34a', borderColor: 'rgba(22,163,74,0.4)' }}>SAVE</button>
              <button onClick={() => { setAdding(false); setErr('') }} style={{ ...btn, color: 'var(--text-muted)' }}>CANCEL</button>
            </div>
            {err && <div style={{ fontSize: 9, color: '#dc2626' }}>{err}</div>}
          </div>
        ) : (
          <button onClick={() => setAdding(true)} disabled={!nodes.length}
            style={{ ...btn, width: '100%', color: 'var(--accent)', borderColor: 'var(--border)', opacity: nodes.length ? 1 : 0.4 }}>+ ADD STORAGE</button>
        )}
      </div>

      {/* list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loaded && storages.length === 0 && <div style={{ fontSize: 10, color: 'var(--text-faint)', padding: '10px 12px' }}>No storages yet</div>}
        {groupKeys.map(gk => {
          const items = groups.get(gk)!
          const label = gk === '__none__' ? 'Ungrouped' : (areaName.get(gk) ?? gk)
          const full = items.filter(s => s.state === 'FULL').length
          const open = opened.has(gk)
          return (
            <div key={gk}>
              <button onClick={() => toggleGroup(gk)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: '5px 12px', background: 'var(--surface-2)', border: 'none', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 8, color: 'var(--text-faint)', transition: 'transform 120ms ease', transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
                <span style={{ flex: 1, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-2)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                <span style={{ fontSize: 9, fontFamily: 'Roboto Mono', color: full ? '#16a34a' : 'var(--text-muted)' }}>{full}/{items.length}</span>
              </button>
              {open && items.map(s => (
                <div key={s.id} style={{ padding: '6px 12px', borderBottom: '1px solid rgba(212,218,227,0.6)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => setState(s.id, s.state === 'FULL' ? 'EMPTY' : 'FULL').catch(() => {})}
                    title="Toggle EMPTY/FULL"
                    style={{ width: 44, fontSize: 8, fontWeight: 700, letterSpacing: 0.5, padding: '2px 0', borderRadius: 2, cursor: 'pointer', fontFamily: 'Roboto Mono',
                      color: s.state === 'FULL' ? '#16a34a' : 'var(--text-muted)',
                      border: `1px solid ${s.state === 'FULL' ? 'rgba(22,163,74,0.4)' : 'var(--border)'}`,
                      background: s.state === 'FULL' ? 'rgba(22,163,74,0.1)' : 'transparent' }}>
                    {s.state}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'Roboto Mono', fontSize: 10, color: 'var(--text)' }}>{s.name}</div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>{s.kind} · @{s.nodeId}</div>
                  </div>
                  <button onClick={() => removeStorage(s.id).catch(() => {})} title="Delete"
                    style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>×</button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const inp: React.CSSProperties = {
  background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 2,
  padding: '4px 6px', fontSize: 10, fontFamily: 'Roboto Mono', width: '100%', boxSizing: 'border-box',
}
const btn: React.CSSProperties = {
  padding: '4px 8px', fontSize: 9, fontWeight: 600, letterSpacing: 0.5, borderRadius: 2, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'transparent', fontFamily: 'Roboto Mono', flex: 1,
}
