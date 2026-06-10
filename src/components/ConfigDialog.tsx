/**
 * ConfigDialog — operator setup for connecting to REAL robots.
 * Tabs: AMRs (register robot: model + serial + IP), Maps (upload/select),
 * Broker (WebSocket URL + auth). Persists via config.store.
 */
import { useEffect, useState } from 'react'
import type { AgvModel } from '@/types'
import type { AmrConfig, VdaBrandId } from '@/types/fleet'
import { VDA_BRANDS, VDA_BRAND_LIST } from '@/constants/vda-brands'
import { useConfigStore } from '@/store/config.store'
import { useAuthStore } from '@/store/auth.store'
import { useFleetStore } from '@/store/fleet.store'
import { ApiError } from '@/services/api'
import { AGV_SPECS } from '@/constants/agv-specs'
import { AGV_MODELS } from '@/constants'
import { UsersTab } from '@/components/UsersManager'

type Tab = 'amrs' | 'maps' | 'broker' | 'users'
const COLORS = ['var(--accent)', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#ea7a00', '#0891b2', '#db2777']

export function ConfigDialog({ onClose, initialTab = 'amrs' }: { onClose: () => void; initialTab?: Tab }) {
  const isAdmin = useAuthStore(s => s.user?.role === 'ADMIN')
  const [tab, setTab] = useState<Tab>(initialTab)
  const tabs: [Tab, string][] = [['amrs', 'AMRs'], ['maps', 'MAPS'], ['broker', 'BROKER'], ...(isAdmin ? [['users', 'USERS'] as [Tab, string]] : [])]
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 560, maxHeight: '82vh', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter, "Noto Sans JP", sans-serif', color: 'var(--text)' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 11, letterSpacing: 2, color: 'var(--accent)' }}>FLEET CONFIGURATION</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {/* tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex: 1, padding: '8px 0', fontSize: 10, fontWeight: 600, letterSpacing: 1, cursor: 'pointer', fontFamily: 'Inter, "Noto Sans JP", sans-serif',
                background: tab === k ? 'rgba(37,99,235,0.08)' : 'transparent', color: tab === k ? 'var(--accent)' : 'var(--text-muted)',
                border: 'none', borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent' }}>{l}</button>
          ))}
        </div>
        <div style={{ overflowY: 'auto', padding: 14 }}>
          {tab === 'amrs'   && <AmrTab />}
          {tab === 'maps'   && <MapTab />}
          {tab === 'broker' && <BrokerTab />}
          {tab === 'users'  && isAdmin && <UsersTab />}
        </div>
      </div>
    </div>
  )
}

// ── shared field styles ────────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 2,
  padding: '5px 7px', fontSize: 11, fontFamily: 'Roboto Mono', width: '100%',
}
const Label = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 9, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>{children}</div>
)
const primaryBtn: React.CSSProperties = {
  padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer',
  color: '#16a34a', border: '1px solid rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.08)',
}

// ── AMRs tab ───────────────────────────────────────────────
function AmrTab() {
  const { amrs, amrsLoaded, loadAmrs, addAmr, removeAmr, updateAmr, broker } = useConfigStore()
  const [serial, setSerial] = useState('')
  const [name, setName]     = useState('')
  const [model, setModel]   = useState<AgvModel>('AM15')
  const [brand, setBrand]   = useState<VdaBrandId>(broker.brand)   // default to the fleet brand
  const [ip, setIp]         = useState('')
  const [color, setColor]   = useState(COLORS[0])
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')
  const bp = VDA_BRANDS[brand] ?? VDA_BRANDS.aiten

  // Pull the live list from the DB the first time the tab is shown.
  useEffect(() => {
    if (!amrsLoaded) loadAmrs().catch(e => setErr(e instanceof ApiError ? e.message : 'failed to load AMRs'))
  }, [amrsLoaded, loadAmrs])

  const canAdd = !!serial.trim() && !amrs.some(a => a.serial === serial.trim()) && !busy

  const add = async () => {
    if (!canAdd) return
    setErr(''); setBusy(true)
    const a: AmrConfig = { serial: serial.trim(), name: name.trim() || serial.trim(), model, brand, ip: ip.trim(), color, enabled: true }
    try {
      await addAmr(a)
      setSerial(''); setName(''); setIp('')
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'failed to add AMR')
    } finally {
      setBusy(false)
    }
  }

  const onErr = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'request failed')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* form */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><Label>Serial Number *</Label><input style={inputStyle} value={serial} onChange={e => setSerial(e.target.value)} placeholder="AGV-56" /></div>
        <div><Label>Display Name</Label><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="(defaults to serial)" /></div>
        <div>
          <Label>Model</Label>
          <select style={inputStyle} value={model} onChange={e => setModel(e.target.value as AgvModel)}>
            {AGV_MODELS.map(m => <option key={m} value={m}>{m} — {AGV_SPECS[m].name}</option>)}
          </select>
        </div>
        <div>
          <Label>Brand</Label>
          <select style={inputStyle} value={brand} onChange={e => setBrand(e.target.value as VdaBrandId)}>
            {VDA_BRAND_LIST.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}><Label>IP Address</Label><input style={inputStyle} value={ip} onChange={e => setIp(e.target.value)} placeholder="192.168.1.56" /></div>
      </div>
      <div>
        <Label>Identity Colour</Label>
        <div style={{ display: 'flex', gap: 6 }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer',
                border: color === c ? '2px solid var(--text)' : '2px solid var(--border)' }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button style={{ ...primaryBtn, opacity: canAdd ? 1 : 0.4, cursor: canAdd ? 'pointer' : 'not-allowed' }} onClick={add}>{busy ? '… SAVING' : '+ ADD AMR'}</button>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Roboto Mono' }}>Topic: {bp.baseTopic}/{bp.manufacturer}/<b style={{ color: 'var(--accent)' }}>{serial || 'serial'}</b>/state</span>
      </div>
      {err && <div style={{ fontSize: 10, color: '#dc2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 3, padding: '5px 8px' }}>{err}</div>}

      {/* list */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <Label>Registered AMRs ({amrs.length}) · stored in DB</Label>
        {!amrsLoaded && <div style={{ fontSize: 10, color: 'var(--text-faint)', padding: '6px 0' }}>Loading…</div>}
        {amrsLoaded && amrs.length === 0 && <div style={{ fontSize: 10, color: 'var(--text-faint)', padding: '6px 0' }}>None yet — add a robot above to connect to it.</div>}
        {amrs.map(a => (
          <AmrRow key={a.serial} a={a} updateAmr={updateAmr} removeAmr={removeAmr} onErr={onErr} />
        ))}
      </div>
    </div>
  )
}

// One AMR row — view mode (toggle/colour/delete) with an inline EDIT mode for
// name / model / IP (serial is the key, so it stays read-only).
function AmrRow({ a, updateAmr, removeAmr, onErr }: {
  a: AmrConfig
  updateAmr: (serial: string, patch: Partial<AmrConfig>) => Promise<unknown>
  removeAmr: (serial: string) => Promise<unknown>
  onErr: (e: unknown) => void
}) {
  const nodes = useFleetStore(s => s.map)?.points ?? []
  const [editing, setEditing] = useState(false)
  const [name, setName]   = useState(a.name)
  const [model, setModel] = useState<AgvModel>(a.model)
  const [brand, setBrand] = useState<VdaBrandId>(a.brand)
  const [ip, setIp]       = useState(a.ip)
  const num = (v: number | null | undefined) => (v == null ? '' : String(v))
  const [lowB, setLowB]       = useState(num(a.lowBattery))
  const [resumeB, setResumeB] = useState(num(a.resumeBattery))
  const [chargeT, setChargeT] = useState(num(a.chargeTarget))
  const [parkN, setParkN]     = useState(a.parkNode ?? '')
  const [chargeN, setChargeN] = useState(a.chargeNode ?? '')

  const start = () => {
    setName(a.name); setModel(a.model); setBrand(a.brand); setIp(a.ip)
    setLowB(num(a.lowBattery)); setResumeB(num(a.resumeBattery)); setChargeT(num(a.chargeTarget))
    setParkN(a.parkNode ?? ''); setChargeN(a.chargeNode ?? ''); setEditing(true)
  }
  const save = async () => {
    const n = (s: string) => (s.trim() === '' ? null : Math.max(1, Math.min(100, Number(s) || 0)))
    try {
      await updateAmr(a.serial, {
        name: name.trim() || a.serial, model, brand, ip: ip.trim(),
        lowBattery: n(lowB), resumeBattery: n(resumeB), chargeTarget: n(chargeT),
        parkNode: parkN || null, chargeNode: chargeN || null,
      })
      setEditing(false)
    } catch (e) { onErr(e) }
  }

  if (editing) return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '8px 0', borderBottom: '1px solid rgba(212,218,227,0.5)' }}>
      <div style={{ gridColumn: '1 / -1', fontFamily: 'Roboto Mono', fontSize: 10, color: 'var(--text-muted)' }}>Editing {a.serial}</div>
      <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Display name" />
      <input style={inputStyle} value={ip} onChange={e => setIp(e.target.value)} placeholder="IP address" />
      <select style={inputStyle} value={model} onChange={e => setModel(e.target.value as AgvModel)}>
        {AGV_MODELS.map(m => <option key={m} value={m}>{m} — {AGV_SPECS[m].name}</option>)}
      </select>
      <select style={inputStyle} value={brand} onChange={e => setBrand(e.target.value as VdaBrandId)}>
        {VDA_BRAND_LIST.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
      </select>

      {/* battery thresholds (% — blank = fleet default) */}
      <div style={{ gridColumn: '1 / -1' }}><Label>Battery % — low / resume / charge-to (blank = default)</Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <input style={inputStyle} type="number" min={1} max={100} value={lowB}    onChange={e => setLowB(e.target.value)}    placeholder="low e.g.20" title="Go charge at/below this %" />
          <input style={inputStyle} type="number" min={1} max={100} value={resumeB} onChange={e => setResumeB(e.target.value)} placeholder="resume e.g.30" title="May take jobs again at/above this %" />
          <input style={inputStyle} type="number" min={1} max={100} value={chargeT} onChange={e => setChargeT(e.target.value)} placeholder="chargeTo e.g.90" title="Charge until this % then go park" />
        </div>
      </div>

      {/* park + charge map nodes */}
      <div><Label>Park node</Label>
        <select style={inputStyle} value={parkN} onChange={e => setParkN(e.target.value)}>
          <option value="">— default —</option>
          {nodes.map(p => <option key={p.id} value={p.id}>{p.id}{p.cls === 'Charge' ? ' ⚡' : ''}</option>)}
        </select>
      </div>
      <div><Label>Charge node</Label>
        <select style={inputStyle} value={chargeN} onChange={e => setChargeN(e.target.value)}>
          <option value="">— nearest —</option>
          {nodes.map(p => <option key={p.id} value={p.id}>{p.id}{p.cls === 'Charge' ? ' ⚡' : ''}</option>)}
        </select>
      </div>

      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6 }}>
        <button onClick={save} style={{ ...primaryBtn, flex: 1, padding: '4px 0' }}>SAVE</button>
        <button onClick={() => setEditing(false)}
          style={{ flex: 1, padding: '4px 0', fontSize: 10, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer', color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'transparent' }}>CANCEL</button>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(212,218,227,0.5)', fontSize: 11 }}>
      <input type="checkbox" checked={a.enabled} onChange={e => { updateAmr(a.serial, { enabled: e.target.checked }).catch(onErr) }} style={{ accentColor: 'var(--accent)' }} />
      <span style={{ fontFamily: 'Roboto Mono', color: 'var(--text)', width: 70 }} title={a.name}>{a.serial}</span>
      <span style={{ color: 'var(--text-muted)', width: 44 }}>{a.model}</span>
      <span title={`brand: ${a.brand}`} style={{ fontSize: 8, color: 'var(--accent)', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 2, padding: '0 4px', textTransform: 'uppercase' }}>{a.brand}</span>
      <span style={{ display: 'flex', gap: 2 }}>
        {COLORS.map(c => (
          <button key={c} title="set colour" onClick={() => { updateAmr(a.serial, { color: c }).catch(onErr) }}
            style={{ width: 13, height: 13, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
              border: a.color === c ? '2px solid var(--text)' : '1px solid var(--border)' }} />
        ))}
      </span>
      <span style={{ fontFamily: 'Roboto Mono', color: 'var(--text-2)', flex: 1, textAlign: 'right' }}>{a.ip || '—'}</span>
      <button onClick={start} title="Edit" style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>✎</button>
      <button onClick={() => { removeAmr(a.serial).catch(onErr) }} title="Delete" style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14 }}>×</button>
    </div>
  )
}

// ── Maps tab ───────────────────────────────────────────────
function MapTab() {
  const { maps, activeMapId, addMap, updateMapData, removeMap, setActiveMap } = useConfigStore()
  const [name, setName] = useState('')
  const [err, setErr]   = useState('')
  const [note, setNote] = useState('')

  // validate an uploaded ATP/SEER map file, return its text or null (sets err)
  const readMap = async (file: File): Promise<string | null> => {
    setErr(''); setNote('')
    try {
      const text = await file.text()
      const obj = JSON.parse(text)
      if (!Array.isArray(obj.advancedPointList)) { setErr('Not an ATP/SEER map (missing advancedPointList)'); return null }
      return text
    } catch {
      setErr('Invalid map file (not valid JSON)')
      return null
    }
  }

  // Add = upsert-by-name: re-uploading a map with the SAME name replaces its data in
  // place (same mapId), so storages/docks/traffic bound to that map survive the update.
  const onFile = async (file: File) => {
    const text = await readMap(file)
    if (text === null) return
    const finalName = name.trim() || file.name.replace(/\.(json|smap)$/i, '')
    const existing = maps.find(m => m.source !== 'builtin' && m.name.toLowerCase() === finalName.toLowerCase())
    if (existing) {
      updateMapData(existing.id, text)
      setNote(`Updated "${existing.name}" — facility data (storages/docks/zones) kept`)
    } else {
      addMap({ id: `map-${Date.now()}`, name: finalName, source: 'uploaded', data: text })
    }
    setName('')
  }

  // per-row ⟳: replace this map's data explicitly, whatever the file is called
  const onReplace = async (id: string, file: File) => {
    const text = await readMap(file)
    if (text === null) return
    updateMapData(id, text)
    const m = maps.find(x => x.id === id)
    setNote(`Updated "${m?.name ?? id}" — facility data (storages/docks/zones) kept`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Label>Add Map (ATP .json / SEER .smap — advancedPointList / advancedCurveList)</Label>
        <input style={{ ...inputStyle, marginBottom: 6 }} value={name} onChange={e => setName(e.target.value)} placeholder="Map name (optional)" />
        <label style={{ ...primaryBtn, display: 'inline-block' }}>
          + UPLOAD MAP
          <input type="file" accept=".json,.smap,application/json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
        </label>
        {err && <span style={{ marginLeft: 10, fontSize: 10, color: '#dc2626' }}>{err}</span>}
        {note && <span style={{ marginLeft: 10, fontSize: 10, color: '#16a34a' }}>✓ {note}</span>}
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 5 }}>
          อัปโหลดชื่อเดิมซ้ำ = อัปเดตแมพเดิม (ข้อมูล storage/dock/zone ไม่หาย) · ตั้งชื่อใหม่ = เพิ่มแมพใหม่
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <Label>Maps ({maps.length})</Label>
        {maps.map(m => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(212,218,227,0.5)', fontSize: 11 }}>
            <input type="radio" checked={activeMapId === m.id} onChange={() => setActiveMap(m.id)} style={{ accentColor: 'var(--accent)' }} />
            <span style={{ flex: 1, color: activeMapId === m.id ? 'var(--accent)' : 'var(--text)' }}>{m.name}</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{m.source}</span>
            {m.source !== 'builtin' && (
              <label title="Replace this map's data with a new file (keeps storages/docks/zones)"
                style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>
                ⟳
                <input type="file" accept=".json,.smap,application/json" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) onReplace(m.id, f); e.target.value = '' }} />
              </label>
            )}
            {m.source !== 'builtin' && <button onClick={() => removeMap(m.id)} style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14 }}>×</button>}
          </div>
        ))}
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6 }}>Selecting a map reloads the canvas with it.</div>
      </div>
    </div>
  )
}

// ── Broker tab ─────────────────────────────────────────────
function BrokerTab() {
  const { broker, setBroker } = useConfigStore()
  const brand = VDA_BRANDS[broker.brand] ?? VDA_BRANDS.aiten

  // switching brand pre-fills the topic scheme + manufacturer (still editable)
  const pickBrand = (id: VdaBrandId) => {
    const b = VDA_BRANDS[id]
    setBroker({ brand: id, baseTopic: b.baseTopic, manufacturer: b.manufacturer, wsUrl: broker.wsUrl || b.defaultWsUrl })
  }
  const sampleSerial = '102'
  const topicPreview = `${brand.baseTopic}/${brand.manufacturer}/${sampleSerial}/state`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* default brand for new AMRs (each AMR can override its own brand) */}
      <div>
        <Label>Default robot brand</Label>
        <select style={inputStyle} value={broker.brand} onChange={e => pickBrand(e.target.value as VdaBrandId)}>
          {VDA_BRAND_LIST.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </div>

      <div><Label>WebSocket URL *</Label><input style={inputStyle} value={broker.wsUrl} onChange={e => setBroker({ wsUrl: e.target.value })} placeholder={brand.defaultWsUrl} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><Label>Username</Label><input style={inputStyle} value={broker.username ?? ''} onChange={e => setBroker({ username: e.target.value })} /></div>
        <div><Label>Password</Label><input style={inputStyle} type="password" value={broker.password ?? ''} onChange={e => setBroker({ password: e.target.value })} /></div>
      </div>
      {/* topic scheme + manufacturer come from the brand preset (per-AMR brand wins) */}
      <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Roboto Mono' }}>
        Topic: <span style={{ color: 'var(--accent)' }}>{topicPreview}</span> <span style={{ color: 'var(--text-faint)' }}>· mfr {brand.manufacturer} · serial per robot</span>
      </div>

      {/* brand-specific guidance */}
      <div style={{ padding: 10, background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 3, fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5 }}>
        <b style={{ color: 'var(--accent)' }}>{brand.label}</b> — {brand.notes}
      </div>

      <div style={{ padding: 10, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 3, fontSize: 10, color: '#c9b890', lineHeight: 1.5 }}>
        <b style={{ color: '#f59e0b' }}>⚠ Real robots speak TCP 1883.</b> Browsers can only do MQTT over WebSocket,
        so point this at the controller's WebSocket listener (or a Mosquitto bridge):
        <pre style={{ margin: '6px 0 0', fontFamily: 'Roboto Mono', fontSize: 9, color: 'var(--text-2)' }}>{`listener 1883            # AGV publishes here
listener 9001
protocol websockets      # browser connects here`}</pre>
      </div>
    </div>
  )
}
