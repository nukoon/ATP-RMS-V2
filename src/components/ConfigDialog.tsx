/**
 * ConfigDialog — operator setup for connecting to REAL robots.
 * Tabs: AMRs (register robot: model + serial + IP), Maps (upload/select),
 * Broker (WebSocket URL + auth). Persists via config.store.
 */
import { useEffect, useState } from 'react'
import type { AgvModel } from '@/types'
import type { AmrConfig } from '@/types/fleet'
import { useConfigStore } from '@/store/config.store'
import { ApiError } from '@/services/api'
import { AGV_SPECS } from '@/constants/agv-specs'
import { AGV_MODELS } from '@/constants'

type Tab = 'amrs' | 'maps' | 'broker'
const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#ea7a00', '#0891b2', '#db2777']

export function ConfigDialog({ onClose, initialTab = 'amrs' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 560, maxHeight: '82vh', background: '#ffffff', border: '1px solid #d4dae3', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter, "Noto Sans JP", sans-serif', color: '#1a2230' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #d4dae3' }}>
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 11, letterSpacing: 2, color: '#2563eb' }}>FLEET CONFIGURATION</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {/* tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #d4dae3', flexShrink: 0 }}>
          {([['amrs', 'AMRs'], ['maps', 'MAPS'], ['broker', 'BROKER']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex: 1, padding: '8px 0', fontSize: 10, fontWeight: 600, letterSpacing: 1, cursor: 'pointer', fontFamily: 'Inter, "Noto Sans JP", sans-serif',
                background: tab === k ? 'rgba(37,99,235,0.08)' : 'transparent', color: tab === k ? '#2563eb' : '#64748b',
                border: 'none', borderBottom: tab === k ? '2px solid #2563eb' : '2px solid transparent' }}>{l}</button>
          ))}
        </div>
        <div style={{ overflowY: 'auto', padding: 14 }}>
          {tab === 'amrs'   && <AmrTab />}
          {tab === 'maps'   && <MapTab />}
          {tab === 'broker' && <BrokerTab />}
        </div>
      </div>
    </div>
  )
}

// ── shared field styles ────────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: '#f3f6fa', color: '#1a2230', border: '1px solid #d4dae3', borderRadius: 2,
  padding: '5px 7px', fontSize: 11, fontFamily: 'Roboto Mono', width: '100%',
}
const Label = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 9, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', marginBottom: 3 }}>{children}</div>
)
const primaryBtn: React.CSSProperties = {
  padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer',
  color: '#16a34a', border: '1px solid rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.08)',
}

// ── AMRs tab ───────────────────────────────────────────────
function AmrTab() {
  const { amrs, amrsLoaded, loadAmrs, addAmr, removeAmr, updateAmr } = useConfigStore()
  const [serial, setSerial] = useState('')
  const [name, setName]     = useState('')
  const [model, setModel]   = useState<AgvModel>('AM15')
  const [ip, setIp]         = useState('')
  const [color, setColor]   = useState(COLORS[0])
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')

  // Pull the live list from the DB the first time the tab is shown.
  useEffect(() => {
    if (!amrsLoaded) loadAmrs().catch(e => setErr(e instanceof ApiError ? e.message : 'failed to load AMRs'))
  }, [amrsLoaded, loadAmrs])

  const canAdd = !!serial.trim() && !amrs.some(a => a.serial === serial.trim()) && !busy

  const add = async () => {
    if (!canAdd) return
    setErr(''); setBusy(true)
    const a: AmrConfig = { serial: serial.trim(), name: name.trim() || serial.trim(), model, ip: ip.trim(), color, enabled: true }
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
        <div><Label>IP Address</Label><input style={inputStyle} value={ip} onChange={e => setIp(e.target.value)} placeholder="192.168.1.56" /></div>
      </div>
      <div>
        <Label>Identity Colour</Label>
        <div style={{ display: 'flex', gap: 6 }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer',
                border: color === c ? '2px solid #1a2230' : '2px solid #d4dae3' }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button style={{ ...primaryBtn, opacity: canAdd ? 1 : 0.4, cursor: canAdd ? 'pointer' : 'not-allowed' }} onClick={add}>{busy ? '… SAVING' : '+ ADD AMR'}</button>
        <span style={{ fontSize: 9, color: '#64748b' }}>Topic: uagv/v2/&lt;mfr&gt;/<b style={{ color: '#2563eb' }}>{serial || 'serial'}</b>/state</span>
      </div>
      {err && <div style={{ fontSize: 10, color: '#dc2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 3, padding: '5px 8px' }}>{err}</div>}

      {/* list */}
      <div style={{ borderTop: '1px solid #d4dae3', paddingTop: 8 }}>
        <Label>Registered AMRs ({amrs.length}) · stored in DB</Label>
        {!amrsLoaded && <div style={{ fontSize: 10, color: '#94a3b4', padding: '6px 0' }}>Loading…</div>}
        {amrsLoaded && amrs.length === 0 && <div style={{ fontSize: 10, color: '#94a3b4', padding: '6px 0' }}>None yet — add a robot above to connect to it.</div>}
        {amrs.map(a => (
          <div key={a.serial} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(212,218,227,0.5)', fontSize: 11 }}>
            <input type="checkbox" checked={a.enabled} onChange={e => { updateAmr(a.serial, { enabled: e.target.checked }).catch(onErr) }} style={{ accentColor: '#2563eb' }} />
            <span style={{ fontFamily: 'Roboto Mono', color: '#1a2230', width: 70 }}>{a.serial}</span>
            <span style={{ color: '#64748b', width: 48 }}>{a.model}</span>
            {/* per-AMR identity colour — click a swatch to change it */}
            <span style={{ display: 'flex', gap: 2 }}>
              {COLORS.map(c => (
                <button key={c} title="set colour" onClick={() => { updateAmr(a.serial, { color: c }).catch(onErr) }}
                  style={{ width: 13, height: 13, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                    border: a.color === c ? '2px solid #1a2230' : '1px solid #d4dae3' }} />
              ))}
            </span>
            <span style={{ fontFamily: 'Roboto Mono', color: '#4a5568', flex: 1, textAlign: 'right' }}>{a.ip || '—'}</span>
            <button onClick={() => { removeAmr(a.serial).catch(onErr) }} style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14 }}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Maps tab ───────────────────────────────────────────────
function MapTab() {
  const { maps, activeMapId, addMap, removeMap, setActiveMap } = useConfigStore()
  const [name, setName] = useState('')
  const [err, setErr]   = useState('')

  const onFile = async (file: File) => {
    setErr('')
    try {
      const text = await file.text()
      JSON.parse(text) // validate
      addMap({ id: `map-${Date.now()}`, name: name.trim() || file.name.replace(/\.json$/i, ''), source: 'uploaded', data: text })
      setName('')
    } catch {
      setErr('Invalid JSON file')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Label>Add Map (ATP JSON — advancedPointList / advancedCurveList)</Label>
        <input style={{ ...inputStyle, marginBottom: 6 }} value={name} onChange={e => setName(e.target.value)} placeholder="Map name (optional)" />
        <label style={{ ...primaryBtn, display: 'inline-block' }}>
          + UPLOAD JSON
          <input type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
        </label>
        {err && <span style={{ marginLeft: 10, fontSize: 10, color: '#dc2626' }}>{err}</span>}
      </div>
      <div style={{ borderTop: '1px solid #d4dae3', paddingTop: 8 }}>
        <Label>Maps ({maps.length})</Label>
        {maps.map(m => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(212,218,227,0.5)', fontSize: 11 }}>
            <input type="radio" checked={activeMapId === m.id} onChange={() => setActiveMap(m.id)} style={{ accentColor: '#2563eb' }} />
            <span style={{ flex: 1, color: activeMapId === m.id ? '#2563eb' : '#1a2230' }}>{m.name}</span>
            <span style={{ fontSize: 9, color: '#64748b' }}>{m.source}</span>
            {m.source !== 'builtin' && <button onClick={() => removeMap(m.id)} style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14 }}>×</button>}
          </div>
        ))}
        <div style={{ fontSize: 9, color: '#64748b', marginTop: 6 }}>Selecting a map reloads the canvas with it.</div>
      </div>
    </div>
  )
}

// ── Broker tab ─────────────────────────────────────────────
function BrokerTab() {
  const { broker, setBroker } = useConfigStore()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div><Label>WebSocket URL *</Label><input style={inputStyle} value={broker.wsUrl} onChange={e => setBroker({ wsUrl: e.target.value })} placeholder="ws://localhost:9001" /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><Label>Username</Label><input style={inputStyle} value={broker.username ?? ''} onChange={e => setBroker({ username: e.target.value })} /></div>
        <div><Label>Password</Label><input style={inputStyle} type="password" value={broker.password ?? ''} onChange={e => setBroker({ password: e.target.value })} /></div>
      </div>
      <div><Label>VDA5050 Manufacturer</Label><input style={inputStyle} value={broker.manufacturer} onChange={e => setBroker({ manufacturer: e.target.value })} placeholder="ATP" /></div>

      <div style={{ marginTop: 4, padding: 10, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 3, fontSize: 10, color: '#c9b890', lineHeight: 1.5 }}>
        <b style={{ color: '#f59e0b' }}>⚠ Real robots speak TCP 1883.</b> Browsers can only do MQTT over WebSocket,
        so point this at a Mosquitto bridge:
        <pre style={{ margin: '6px 0 0', fontFamily: 'Roboto Mono', fontSize: 9, color: '#4a5568' }}>{`listener 1883            # AGV publishes here
listener 9001
protocol websockets      # browser connects here`}</pre>
      </div>
    </div>
  )
}
