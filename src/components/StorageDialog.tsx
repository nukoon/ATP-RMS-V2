/**
 * StorageDialog — full editor overlay for storages and their VDA5050 actions.
 * Tabs:
 *  • STORAGES — edit a storage and bind a per-stage (PICK/DROP) sequence of
 *    action templates, with param overrides + reordering.
 *  • ACTIONS  — manage reusable VDA5050 action templates (code, actionType,
 *    blockingType, default params).
 * Everything persists to the DB via storage.store / api.
 */
import { useEffect, useState } from 'react'
import { useStorageStore } from '@/store/storage.store'
import { useFleetStore } from '@/store/fleet.store'
import type { ActionStage, ActionParam, StorageActionBinding, VdaActionTemplate, StorageKind } from '@/types/fleet'

type Tab = 'storages' | 'areas' | 'actions'

export function StorageDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('storages')
  return (
    <div onClick={onClose} style={ovl}>
      <div onClick={e => e.stopPropagation()} style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 11, letterSpacing: 2, color: 'var(--accent)' }}>STORAGE · AREAS · ACTIONS</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {([['storages', 'STORAGES'], ['areas', 'AREAS'], ['actions', 'ACTIONS']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex: 1, padding: '8px 0', fontSize: 10, fontWeight: 600, letterSpacing: 1, cursor: 'pointer', fontFamily: 'Inter, "Noto Sans JP", sans-serif',
                background: tab === k ? 'rgba(37,99,235,0.08)' : 'transparent', color: tab === k ? 'var(--accent)' : 'var(--text-muted)',
                border: 'none', borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent' }}>{l}</button>
          ))}
        </div>
        <div style={{ overflowY: 'auto', padding: 14 }}>
          {tab === 'storages' && <StoragesTab />}
          {tab === 'areas'    && <AreasTab />}
          {tab === 'actions'  && <ActionsTab />}
        </div>
      </div>
    </div>
  )
}

// ── Storages tab: bind PICK/DROP action sequences ──────────
function StoragesTab() {
  const { storages, areas, templates, loadBindings, saveBindings, updateStorage } = useStorageStore()
  const map = useFleetStore(s => s.map)
  const nodes = (map?.points ?? []).filter(p => p.cls !== 'Charge')
  const [sel, setSel] = useState('')
  const storageId = sel || storages[0]?.id || ''
  const storage = storages.find(s => s.id === storageId)
  const [pick, setPick] = useState<StorageActionBinding[]>([])
  const [drop, setDrop] = useState<StorageActionBinding[]>([])
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!storageId) return
    loadBindings(storageId).then(bs => splitInto(bs)).catch(() => splitInto([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageId])

  const splitInto = (bs: StorageActionBinding[]) => {
    setPick(bs.filter(b => b.stage === 'PICK').sort((a, b) => a.seq - b.seq))
    setDrop(bs.filter(b => b.stage === 'DROP').sort((a, b) => a.seq - b.seq))
    setSaved(false)
  }

  const save = async () => {
    const all = [
      ...pick.map((b, i) => ({ ...b, stage: 'PICK' as ActionStage, seq: i, storageId })),
      ...drop.map((b, i) => ({ ...b, stage: 'DROP' as ActionStage, seq: i, storageId })),
    ]
    await saveBindings(storageId, all)
    setSaved(true)
  }

  if (!storages.length) return <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No storages yet — add some in the STORAGE tab first.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Lbl>Storage</Lbl>
        <select value={storageId} onChange={e => setSel(e.target.value)} style={inp}>
          {storages.map(s => <option key={s.id} value={s.id}>{s.name} ({s.state}) @{s.nodeId}</option>)}
        </select>
      </div>

      {storage && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <div><Lbl>Node</Lbl>
            {/* type to filter (e.g. "AP70") — the node list is long */}
            <input value={storage.nodeId} list="sd-node-list"
              onChange={e => { const v = e.target.value.toUpperCase(); if (!v || nodes.some(n => n.id === v)) updateStorage(storage.id, { nodeId: v }) }}
              style={inp} />
            <datalist id="sd-node-list">{nodes.map(n => <option key={n.id} value={n.id} />)}</datalist>
          </div>
          <div><Lbl>Kind</Lbl>
            <select value={storage.kind} onChange={e => updateStorage(storage.id, { kind: e.target.value as never })} style={inp}>
              <option>PICK</option><option>DROP</option><option>BOTH</option>
            </select>
          </div>
          <div><Lbl>State</Lbl>
            <select value={storage.state} onChange={e => updateStorage(storage.id, { state: e.target.value as never })} style={inp}>
              <option>EMPTY</option><option>FULL</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}><Lbl>Area (batch group)</Lbl>
            <select value={storage.areaId ?? ''} onChange={e => updateStorage(storage.id, { areaId: e.target.value || null })} style={inp}>
              <option value="">— none —</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}
            </select>
          </div>
        </div>
      )}

      <StageEditor title="PICK actions (run at pickup)" stage="PICK" list={pick} setList={setPick} templates={templates} />
      <StageEditor title="DROP actions (run at dropoff)" stage="DROP" list={drop} setList={setDrop} templates={templates} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={save} style={{ ...primaryBtn }}>SAVE BINDINGS</button>
        {saved && <span style={{ fontSize: 10, color: '#16a34a' }}>✓ saved</span>}
      </div>
    </div>
  )
}

function StageEditor({ title, stage, list, setList, templates }:
  { title: string; stage: ActionStage; list: StorageActionBinding[]; setList: (v: StorageActionBinding[]) => void; templates: VdaActionTemplate[] }) {
  const add = () => {
    if (!templates.length) return
    setList([...list, { storageId: '', actionId: templates[0].id, stage, seq: list.length }])
  }
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= list.length) return
    const next = [...list];[next[i], next[j]] = [next[j], next[i]]; setList(next)
  }
  const upd = (i: number, patch: Partial<StorageActionBinding>) =>
    setList(list.map((b, k) => k === i ? { ...b, ...patch } : b))

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 3, padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 9, letterSpacing: 1, color: stage === 'PICK' ? 'var(--accent)' : '#f59e0b', textTransform: 'uppercase' }}>{title}</span>
        <button onClick={add} disabled={!templates.length} style={{ marginLeft: 'auto', ...miniBtn }}>+ add</button>
      </div>
      {list.length === 0 && <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>none</div>}
      {list.map((b, i) => {
        const tpl = templates.find(t => t.id === b.actionId)
        const params = b.params ?? tpl?.defaultParams ?? []
        return (
          <div key={i} style={{ borderTop: i ? '1px solid rgba(212,218,227,0.6)' : 'none', padding: '5px 0' }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontFamily: 'Roboto Mono', fontSize: 9, color: 'var(--text-muted)', width: 14 }}>{i + 1}</span>
              <select value={b.actionId} onChange={e => upd(i, { actionId: e.target.value, params: undefined })} style={{ ...inp, flex: 1 }}>
                {templates.map(t => <option key={t.id} value={t.id}>{t.code} ({t.actionType})</option>)}
              </select>
              <button onClick={() => move(i, -1)} style={miniBtn}>↑</button>
              <button onClick={() => move(i, 1)} style={miniBtn}>↓</button>
              <button onClick={() => setList(list.filter((_, k) => k !== i))} style={{ ...miniBtn, color: '#dc2626' }}>×</button>
            </div>
            {/* param overrides */}
            <div style={{ paddingLeft: 18, marginTop: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {params.map((p, pi) => (
                <div key={pi} style={{ display: 'flex', gap: 4 }}>
                  <input value={p.key} onChange={e => editParam(b, i, pi, { key: e.target.value }, params, upd)} placeholder="key" style={{ ...inp, width: 90 }} />
                  <input value={String(p.value)} onChange={e => editParam(b, i, pi, { value: e.target.value }, params, upd)} placeholder="value" style={{ ...inp, flex: 1 }} />
                  <button onClick={() => upd(i, { params: params.filter((_, k) => k !== pi) })} style={{ ...miniBtn, color: '#dc2626' }}>×</button>
                </div>
              ))}
              <button onClick={() => upd(i, { params: [...params, { key: '', value: '' }] })} style={{ ...miniBtn, alignSelf: 'flex-start' }}>+ param</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function editParam(_b: StorageActionBinding, i: number, pi: number, patch: Partial<ActionParam>, params: ActionParam[], upd: (i: number, patch: Partial<StorageActionBinding>) => void) {
  upd(i, { params: params.map((p, k) => k === pi ? { ...p, ...patch } : p) })
}

// ── Areas tab: group storages for batch pickup/drop ─────────
function AreasTab() {
  const { areas, storages, addArea, updateArea, removeArea, setAreaState } = useStorageStore()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<StorageKind>('BOTH')
  const [err, setErr] = useState('')

  const create = async () => {
    if (!name.trim()) return
    setErr('')
    try { await addArea({ name: name.trim(), kind, enabled: true }); setName('') }
    catch (e) { setErr(e instanceof Error ? e.message : 'failed') }
  }
  const memberCount = (areaId: string) => storages.filter(s => s.areaId === areaId).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px auto', gap: 6, alignItems: 'end' }}>
        <div><Lbl>Area name</Lbl><input value={name} onChange={e => setName(e.target.value)} placeholder="ZONE-A" style={inp} /></div>
        <div><Lbl>Kind</Lbl>
          <select value={kind} onChange={e => setKind(e.target.value as StorageKind)} style={inp}>
            <option>PICK</option><option>DROP</option><option>BOTH</option>
          </select>
        </div>
        <button onClick={create} style={primaryBtn}>+ ADD</button>
      </div>
      {err && <div style={{ fontSize: 10, color: '#dc2626' }}>{err}</div>}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <Lbl>Areas ({areas.length})</Lbl>
        {areas.length === 0 && <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>No areas yet — add one above, then assign storages to it in the STORAGES tab.</div>}
        {areas.map(a => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderBottom: '1px solid rgba(212,218,227,0.6)', fontSize: 11 }}>
            <span style={{ fontFamily: 'Roboto Mono', color: 'var(--accent)', flex: 1 }}>{a.name}</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{memberCount(a.id)}</span>
            {/* batch fill/empty all members in this area */}
            <button onClick={() => setAreaState(a.id, 'FULL').catch(() => {})} disabled={!memberCount(a.id)} title="Set all members FULL"
              style={{ ...miniBtn, color: '#16a34a', borderColor: 'rgba(22,163,74,0.4)' }}>ALL FULL</button>
            <button onClick={() => setAreaState(a.id, 'EMPTY').catch(() => {})} disabled={!memberCount(a.id)} title="Set all members EMPTY"
              style={{ ...miniBtn, color: 'var(--text-muted)' }}>ALL EMPTY</button>
            <select value={a.kind} onChange={e => updateArea(a.id, { kind: e.target.value as StorageKind }).catch(() => {})} style={{ ...inp, width: 72 }}>
              <option>PICK</option><option>DROP</option><option>BOTH</option>
            </select>
            <button onClick={() => updateArea(a.id, { enabled: !a.enabled }).catch(() => {})}
              style={{ ...miniBtn, color: a.enabled ? '#16a34a' : 'var(--text-faint)' }}>{a.enabled ? 'ON' : 'OFF'}</button>
            <button onClick={() => removeArea(a.id).catch(() => {})} style={{ ...miniBtn, color: '#dc2626' }}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Action templates tab ───────────────────────────────────
function ActionsTab() {
  const { templates, addTemplate, removeTemplate, updateTemplate } = useStorageStore()
  const [code, setCode] = useState('')
  const [actionType, setActionType] = useState('')
  const [blocking, setBlocking] = useState('HARD')
  const [err, setErr] = useState('')

  const create = async () => {
    if (!code.trim() || !actionType.trim()) return
    setErr('')
    try {
      await addTemplate({ code: code.trim(), actionType: actionType.trim(), name: code.trim(), blockingType: blocking as never, defaultParams: [] })
      setCode(''); setActionType('')
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px auto', gap: 6, alignItems: 'end' }}>
        <div><Lbl>Code</Lbl><input value={code} onChange={e => setCode(e.target.value)} placeholder="liftUp" style={inp} /></div>
        <div><Lbl>actionType</Lbl><input value={actionType} onChange={e => setActionType(e.target.value)} placeholder="liftUp" style={inp} /></div>
        <div><Lbl>Blocking</Lbl>
          <select value={blocking} onChange={e => setBlocking(e.target.value)} style={inp}><option>NONE</option><option>SOFT</option><option>HARD</option></select>
        </div>
        <button onClick={create} style={primaryBtn}>+ ADD</button>
      </div>
      {err && <div style={{ fontSize: 10, color: '#dc2626' }}>{err}</div>}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <Lbl>Templates ({templates.length})</Lbl>
        {templates.map(t => (
          <div key={t.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(212,218,227,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <span style={{ fontFamily: 'Roboto Mono', color: 'var(--accent)', width: 90 }}>{t.code}</span>
              <span style={{ color: 'var(--text-2)', flex: 1 }}>{t.actionType}</span>
              <select value={t.blockingType} onChange={e => updateTemplate(t.id, { blockingType: e.target.value as never }).catch(() => {})}
                style={{ ...inp, width: 80 }}><option>NONE</option><option>SOFT</option><option>HARD</option></select>
              <button onClick={() => removeTemplate(t.id).catch(() => {})} style={{ ...miniBtn, color: '#dc2626' }}>×</button>
            </div>
            {!!t.defaultParams.length && (
              <div style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'Roboto Mono', paddingLeft: 90, marginTop: 2 }}>
                {t.defaultParams.map(p => `${p.key}=${p.value}`).join(' · ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── shared styles ──────────────────────────────────────────
const Lbl = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 9, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>{children}</div>
)
const ovl: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
const panel: React.CSSProperties = { width: 600, maxHeight: '84vh', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter, "Noto Sans JP", sans-serif', color: 'var(--text)' }
const inp: React.CSSProperties = { background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 2, padding: '5px 7px', fontSize: 10, fontFamily: 'Roboto Mono', width: '100%', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer', color: '#16a34a', border: '1px solid rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.08)' }
const miniBtn: React.CSSProperties = { fontSize: 9, padding: '2px 6px', borderRadius: 2, cursor: 'pointer', color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'transparent', fontFamily: 'Roboto Mono' }
