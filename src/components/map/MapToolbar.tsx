import { useRef, useState, type ReactNode } from 'react'
import type { MapViewConfig } from '@/types'

interface Props {
  config: MapViewConfig
  onChange: (patch: Partial<MapViewConfig>) => void
  onManageFacilities?: () => void
  onOpenDashboard?: () => void
  onOpenHistory?: () => void
}

const SliderRow = ({ label, value, min, max, step, onChange, suffix = '' }:
  { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix?: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
    <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: 68, height: 3, accentColor: 'var(--accent)', cursor: 'pointer' }} />
    <span style={{ fontFamily: 'Roboto Mono', fontSize: 10, color: 'var(--accent)', minWidth: 26, textAlign: 'right' }}>
      {value}{suffix}
    </span>
  </div>
)

// ── Inline line icons (feather-style, 15px) — one consistent family, no emoji ──
const iconProps = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

// Feather-style eye / eye-off icon — the show/hide affordance (no checkbox).
function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg {...iconProps} width={14} height={14}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg {...iconProps} width={14} height={14}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}
const DocksIcon = () => (
  <svg {...iconProps}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
)
const DashboardIcon = () => (
  <svg {...iconProps}>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
)
const HistoryIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15 14" />
  </svg>
)

// Shared toolbar action button: consistent radius + hover/focus/active states.
function ToolButton({ icon, label, onClick, title, accent = false, active = false }: {
  icon: ReactNode; label: string; onClick?: () => void; title?: string; accent?: boolean; active?: boolean
}) {
  const [hover, setHover] = useState(false)
  const [press, setPress] = useState(false)
  const on = hover || active
  return (
    <button type="button" onClick={onClick} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setPress(false) }}
      onFocus={() => setHover(true)} onBlur={() => setHover(false)}
      onMouseDown={() => setPress(true)} onMouseUp={() => setPress(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px',
        fontFamily: 'Roboto Mono, "Noto Sans JP", monospace', fontSize: 9, fontWeight: 600,
        letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 6,
        color: accent ? 'var(--accent)' : 'var(--text-2)',
        border: `1px solid ${on ? (accent ? 'rgba(37,99,235,0.45)' : '#c2cad6') : 'var(--border)'}`,
        background: press ? (accent ? 'rgba(37,99,235,0.18)' : '#e3e8ef')
          : on ? (accent ? 'rgba(37,99,235,0.12)' : 'var(--bg)')
          : (accent ? 'rgba(37,99,235,0.05)' : 'var(--surface)'),
        transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease',
        outline: 'none', whiteSpace: 'nowrap',
      }}>
      <span style={{ display: 'flex', color: accent ? 'var(--accent)' : (on ? 'var(--text-2)' : 'var(--text-muted)') }}>{icon}</span>
      {label}
    </button>
  )
}

// boolean (show/hide) layer toggles, collected under one "Display" dropdown
type BoolKey = 'showLM' | 'showAP' | 'showCH' | 'showEdges' | 'showPaths' | 'showTheta' | 'showStorage' | 'showHeatmap' | 'showGrid' | 'showRobots' | 'showTraffic' | 'showDevices'
const DISPLAY_LAYERS: { key: BoolKey; label: string }[] = [
  { key: 'showLM',      label: 'Location Marks (LM)' },
  { key: 'showAP',      label: 'Action Points (AP)' },
  { key: 'showCH',      label: 'Charge Nodes' },
  { key: 'showEdges',   label: 'Edges / Lanes' },
  { key: 'showRobots',  label: 'Robots' },
  { key: 'showPaths',   label: 'Robot Paths' },
  { key: 'showTheta',   label: 'θ Direction' },
  { key: 'showStorage', label: 'Storage / Docks' },
  { key: 'showTraffic', label: 'Traffic Zones' },
  { key: 'showDevices', label: 'Field Devices' },
  { key: 'showHeatmap', label: 'Traffic Heatmap' },
  { key: 'showGrid',    label: 'Grid' },
]

function DisplayMenu({ cfg, onChange }: { cfg: MapViewConfig; onChange: (patch: Partial<MapViewConfig>) => void }) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const shown = DISPLAY_LAYERS.filter(l => cfg[l.key]).length
  const lit = open || hover

  const toggle = () => {
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ x: r.left, y: r.bottom + 6 })
    setOpen(true)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '5px 10px', borderRight: '1px solid var(--border)' }}>
      <button ref={btnRef} type="button" onClick={toggle} title="Show / hide map layers"
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)} onBlur={() => setHover(false)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', fontSize: 9,
          fontFamily: 'Roboto Mono, "Noto Sans JP", monospace', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase',
          borderRadius: 6, cursor: 'pointer', outline: 'none', whiteSpace: 'nowrap', color: 'var(--accent)',
          border: `1px solid ${lit ? 'rgba(37,99,235,0.45)' : 'var(--border)'}`,
          background: lit ? 'rgba(37,99,235,0.12)' : 'rgba(37,99,235,0.05)',
          transition: 'background 140ms ease, border-color 140ms ease' }}>
        <span style={{ display: 'flex' }}><EyeIcon open /></span>
        DISPLAY
        <span style={{ color: 'var(--text-faint)', fontWeight: 700 }}>{shown}/{DISPLAY_LAYERS.length}</span>
        <span style={{ fontSize: 8, color: 'var(--text-faint)', transition: 'transform 140ms ease', transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>

      {open && pos && (
        <div onClick={() => setOpen(false)} onContextMenu={e => { e.preventDefault(); setOpen(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 1200 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ position: 'absolute', left: Math.min(pos.x, window.innerWidth - 234), top: pos.y,
              minWidth: 222, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
              boxShadow: '0 10px 28px rgba(26,34,48,0.18)', overflow: 'hidden', padding: '5px 0',
              fontFamily: 'Inter, "Noto Sans JP", sans-serif' }}>
            <div style={{ padding: '5px 13px 7px', fontSize: 8, letterSpacing: 1.5, color: 'var(--text-faint)', textTransform: 'uppercase', borderBottom: '1px solid var(--bg)' }}>
              Map Layers
            </div>
            {DISPLAY_LAYERS.map(l => {
              const on = cfg[l.key]
              const hi = (e: React.SyntheticEvent) => ((e.currentTarget as HTMLElement).style.background = 'var(--surface-2)')
              const lo = (e: React.SyntheticEvent) => ((e.currentTarget as HTMLElement).style.background = 'transparent')
              return (
                <button key={l.key} type="button" onClick={() => onChange({ [l.key]: !on })}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                    padding: '7px 13px', fontSize: 11, cursor: 'pointer', border: 'none', background: 'transparent',
                    outline: 'none', color: on ? 'var(--text)' : 'var(--text-faint)', transition: 'background 120ms ease' }}
                  onMouseEnter={hi} onMouseLeave={lo} onFocus={hi} onBlur={lo}>
                  <span style={{ display: 'flex', color: on ? 'var(--accent)' : '#b6c0cd' }}><EyeIcon open={on} /></span>
                  <span style={{ flex: 1 }}>{l.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function MapToolbar({ config: cfg, onChange, onManageFacilities, onOpenDashboard, onOpenHistory }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', flexShrink: 0, overflowX: 'auto' }}>
      <SliderRow label="Robot m"    value={cfg.robotSize}          min={1}  max={6}  step={0.5} onChange={v => onChange({ robotSize: v })} suffix="m" />
      <SliderRow label="Node px"    value={cfg.nodeSize}           min={1}  max={10} step={0.5} onChange={v => onChange({ nodeSize: v })} />
      <SliderRow label="Label px"   value={cfg.labelSize}          min={6}  max={18} step={1}   onChange={v => onChange({ labelSize: v })} />
      <SliderRow label="Label@zoom" value={cfg.labelZoomThreshold} min={0.5} max={8} step={0.5} onChange={v => onChange({ labelZoomThreshold: v })} suffix="×" />
      {/* Display: show/hide map layers (eye-icon dropdown) */}
      <DisplayMenu cfg={cfg} onChange={onChange} />
      {/* Facilities (docks + traffic) */}
      {onManageFacilities && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '5px 10px', borderRight: '1px solid var(--border)' }}>
          <ToolButton accent icon={<DocksIcon />} label="Docks / Traffic" onClick={onManageFacilities} title="Manage parking/charging docks & traffic areas" />
        </div>
      )}
      {/* Analytics: KPI dashboard + task history */}
      {(onOpenDashboard || onOpenHistory) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px' }}>
          {onOpenDashboard && <ToolButton accent icon={<DashboardIcon />} label="Dashboard" onClick={onOpenDashboard} title="Fleet KPI dashboard" />}
          {onOpenHistory && <ToolButton icon={<HistoryIcon />} label="History" onClick={onOpenHistory} title="Task history + CSV export" />}
        </div>
      )}
    </div>
  )
}
