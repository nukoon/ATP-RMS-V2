/**
 * ConfigDialog — operator setup for connecting to REAL robots.
 * Tabs: AMRs (register robot: model + serial + IP), Maps (upload/select),
 * Broker (WebSocket URL + auth). Persists via config.store.
 */
import { useState } from 'react'
import type { AgvModel } from '@/types'
import type { AmrConfig } from '@/types/fleet'
import { useConfigStore } from '@/store/config.store'
import { AGV_SPECS } from '@/constants/agv-specs'
import { AGV_MODELS } from '@/constants'

type Tab = 'amrs' | 'maps' | 'broker'
const COLORS = ['#00d4ff', '#00ff88', '#ffb800', '#ff6b6b', '#a78bfa', '#ff8c00', '#08d26e', '#c90bfe']

export function ConfigDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('amrs')
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 560, maxHeight: '82vh', background: '#0a1520', border: '1px solid #152030', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Rajdhani, sans-serif', color: '#c8d8e8' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #152030' }}>
          <span style={{ fontFamily: 'Share Tech Mono', fontSize: 11, letterSpacing: 2, color: '#00d4ff' }}>FLEET CONFIGURATION</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#5a7080', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {/* tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #152030', flexShrink: 0 }}>
          {([['amrs', 'AMRs'], ['maps', 'MAPS'], ['broker', 'BROKER']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex: 1, padding: '8px 0', fontSize: 10, fontWeight: 600, letterSpacing: 1, cursor: 'pointer', fontFamily: 'Rajdhani, sans-serif',
                background: tab === k ? 'rgba(0,212,255,0.08)' : 'transparent', color: tab === k ? '#00d4ff' : '#5a7080',
                border: 'none', borderBottom: tab === k ? '2px solid #00d4ff' : '2px solid transparent' }}>{l}</button>
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
  background: '#0c1a28', color: '#c8d8e8', border: '1px solid #152030', borderRadius: 2,
  padding: '5px 7px', fontSize: 11, fontFamily: 'Share Tech Mono', width: '100%',
}
const Label = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 9, letterSpacing: 1, color: '#5a7080', textTransform: 'uppercase', marginBottom: 3 }}>{children}</div>
)
const primaryBtn: React.CSSProperties = {
  padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer',
  color: '#00ff88', border: '1px solid rgba(0,255,136,0.4)', background: 'rgba(0,255,136,0.08)',
}

// ── AMRs tab ───────────────────────────────────────────────
function AmrTab() {
  const { amrs, addAmr, removeAmr, updateAmr } = useConfigStore()
  const [serial, setSerial] = useState('')
  const [name, setName]     = useState('')
  const [model, setModel]   = useState<AgvModel>('AM15')
  const [ip, setIp]         = useState('')
  const [color, setColor]   = useState(COLORS[0])

  const canAdd = serial.trim() && !amrs.some(a => a.serial === serial.trim())

  const add = () => {
    if (!canAdd) return
    const a: AmrConfig = { serial: serial.trim(), name: name.trim() || serial.trim(), model, ip: ip.trim(), color, enabled: true }
    addAmr(a)
    setSerial(''); setName(''); setIp('')
  }

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
                border: color === c ? '2px solid #fff' : '2px solid transparent' }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button style={{ ...primaryBtn, opacity: canAdd ? 1 : 0.4, cursor: canAdd ? 'pointer' : 'not-allowed' }} onClick={add}>+ ADD AMR</button>
        <span style={{ fontSize: 9, color: '#5a7080' }}>Topic: uagv/v2/&lt;mfr&gt;/<b style={{ color: '#00d4ff' }}>{serial || 'serial'}</b>/state</span>
      </div>

      {/* list */}
      <div style={{ borderTop: '1px solid #152030', paddingTop: 8 }}>
        <Label>Registered AMRs ({amrs.length})</Label>
        {amrs.length === 0 && <div style={{ fontSize: 10, color: '#3a5060', padding: '6px 0' }}>None yet — add a robot above to connect to it.</div>}
        {amrs.map(a => (
          <div key={a.serial} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(21,32,48,0.5)', fontSize: 11 }}>
            <input type="checkbox" checked={a.enabled} onChange={e => updateAmr(a.serial, { enabled: e.target.checked })} style={{ accentColor: '#00d4ff' }} />
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.color }} />
            <span style={{ fontFamily: 'Share Tech Mono', color: '#00d4ff', width: 80 }}>{a.serial}</span>
            <span style={{ color: '#5a7080', width: 54 }}>{a.model}</span>
            <span style={{ fontFamily: 'Share Tech Mono', color: '#8a9aaa', flex: 1 }}>{a.ip || '—'}</span>
            <button onClick={() => removeAmr(a.serial)} style={{ background: 'transparent', border: 'none', color: '#ff4444', cursor: 'pointer', fontSize: 14 }}>×</button>
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
        {err && <span style={{ marginLeft: 10, fontSize: 10, color: '#ff4444' }}>{err}</span>}
      </div>
      <div style={{ borderTop: '1px solid #152030', paddingTop: 8 }}>
        <Label>Maps ({maps.length})</Label>
        {maps.map(m => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(21,32,48,0.5)', fontSize: 11 }}>
            <input type="radio" checked={activeMapId === m.id} onChange={() => setActiveMap(m.id)} style={{ accentColor: '#00d4ff' }} />
            <span style={{ flex: 1, color: activeMapId === m.id ? '#00d4ff' : '#c8d8e8' }}>{m.name}</span>
            <span style={{ fontSize: 9, color: '#5a7080' }}>{m.source}</span>
            {m.source !== 'builtin' && <button onClick={() => removeMap(m.id)} style={{ background: 'transparent', border: 'none', color: '#ff4444', cursor: 'pointer', fontSize: 14 }}>×</button>}
          </div>
        ))}
        <div style={{ fontSize: 9, color: '#5a7080', marginTop: 6 }}>Selecting a map reloads the canvas with it.</div>
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

      <div style={{ marginTop: 4, padding: 10, background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.25)', borderRadius: 3, fontSize: 10, color: '#c9b890', lineHeight: 1.5 }}>
        <b style={{ color: '#ffb800' }}>⚠ Real robots speak TCP 1883.</b> Browsers can only do MQTT over WebSocket,
        so point this at a Mosquitto bridge:
        <pre style={{ margin: '6px 0 0', fontFamily: 'Share Tech Mono', fontSize: 9, color: '#8a9aaa' }}>{`listener 1883            # AGV publishes here
listener 9001
protocol websockets      # browser connects here`}</pre>
      </div>
    </div>
  )
}
