import { useRef, useState } from 'react'
import type { MapViewConfig } from '@/types'

interface Props {
  config: MapViewConfig
  zoom: number
  onChange: (patch: Partial<MapViewConfig>) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onManageFacilities?: () => void
  onOpenDashboard?: () => void
  onOpenHistory?: () => void
}

const SliderRow = ({ label, value, min, max, step, onChange, suffix = '' }:
  { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix?: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRight: '1px solid #d4dae3', whiteSpace: 'nowrap' }}>
    <span style={{ fontSize: 9, color: '#64748b', letterSpacing: '1.5px', textTransform: 'uppercase' }}>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: 68, height: 3, accentColor: '#2563eb', cursor: 'pointer' }} />
    <span style={{ fontFamily: 'Roboto Mono', fontSize: 10, color: '#2563eb', minWidth: 26, textAlign: 'right' }}>
      {value}{suffix}
    </span>
  </div>
)

// boolean (show/hide) layer toggles, collected under one "Display" dropdown
type BoolKey = 'showLM' | 'showAP' | 'showCH' | 'showEdges' | 'showPaths' | 'showTheta' | 'showStorage' | 'showHeatmap'
const DISPLAY_LAYERS: { key: BoolKey; label: string }[] = [
  { key: 'showLM',      label: 'Location Marks (LM)' },
  { key: 'showAP',      label: 'Action Points (AP)' },
  { key: 'showCH',      label: 'Charge Nodes' },
  { key: 'showEdges',   label: 'Edges / Lanes' },
  { key: 'showPaths',   label: 'Robot Paths' },
  { key: 'showTheta',   label: 'θ Direction' },
  { key: 'showStorage', label: 'Storage / Docks' },
  { key: 'showHeatmap', label: 'Traffic Heatmap' },
]

// Feather-style eye / eye-off icon — the show/hide affordance (no checkbox).
function EyeIcon({ open }: { open: boolean }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return open ? (
    <svg {...common}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg {...common}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function DisplayMenu({ cfg, onChange }: { cfg: MapViewConfig; onChange: (patch: Partial<MapViewConfig>) => void }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const shown = DISPLAY_LAYERS.filter(l => cfg[l.key]).length

  const toggle = () => {
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ x: r.left, y: r.bottom + 4 })
    setOpen(true)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '5px 10px', borderRight: '1px solid #d4dae3' }}>
      <button ref={btnRef} onClick={toggle} title="Show / hide map layers"
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 9px', fontSize: 9, fontFamily: 'Roboto Mono', borderRadius: 2, cursor: 'pointer',
          border: `1px solid ${open ? 'rgba(37,99,235,0.5)' : '#d4dae3'}`, color: '#2563eb', background: open ? 'rgba(37,99,235,0.12)' : 'rgba(37,99,235,0.06)' }}>
        <span style={{ display: 'flex' }}><EyeIcon open /></span>
        DISPLAY
        <span style={{ color: '#94a3b4' }}>{shown}/{DISPLAY_LAYERS.length}</span>
        <span style={{ fontSize: 8, color: '#94a3b4' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && pos && (
        <div onClick={() => setOpen(false)} onContextMenu={e => { e.preventDefault(); setOpen(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 1200 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ position: 'absolute', left: Math.min(pos.x, window.innerWidth - 230), top: pos.y,
              minWidth: 218, background: '#ffffff', border: '1px solid #d4dae3', borderRadius: 5,
              boxShadow: '0 8px 22px rgba(26,34,48,0.18)', overflow: 'hidden', padding: '4px 0',
              fontFamily: 'Inter, "Noto Sans JP", sans-serif' }}>
            <div style={{ padding: '5px 12px 6px', fontSize: 8, letterSpacing: 1.5, color: '#94a3b4', textTransform: 'uppercase', borderBottom: '1px solid #eef1f5' }}>
              Map Layers
            </div>
            {DISPLAY_LAYERS.map(l => {
              const on = cfg[l.key]
              return (
                <button key={l.key} onClick={() => onChange({ [l.key]: !on })}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                    padding: '7px 12px', fontSize: 11, cursor: 'pointer', border: 'none', background: 'transparent',
                    color: on ? '#1a2230' : '#94a3b4' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f3f6fa')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ display: 'flex', color: on ? '#2563eb' : '#b6c0cd' }}><EyeIcon open={on} /></span>
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

export function MapToolbar({ config: cfg, zoom, onChange, onZoomIn, onZoomOut, onFit, onManageFacilities, onOpenDashboard, onOpenHistory }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', background: '#f3f6fa', borderBottom: '1px solid #d4dae3', flexShrink: 0, overflowX: 'auto' }}>
      <SliderRow label="Robot m"    value={cfg.robotSize}          min={1}  max={6}  step={0.5} onChange={v => onChange({ robotSize: v })} suffix="m" />
      <SliderRow label="Node px"    value={cfg.nodeSize}           min={1}  max={10} step={0.5} onChange={v => onChange({ nodeSize: v })} />
      <SliderRow label="Label px"   value={cfg.labelSize}          min={6}  max={18} step={1}   onChange={v => onChange({ labelSize: v })} />
      <SliderRow label="Label@zoom" value={cfg.labelZoomThreshold} min={0.5} max={8} step={0.5} onChange={v => onChange({ labelZoomThreshold: v })} suffix="×" />
      {/* Display: show/hide map layers (eye-icon dropdown) */}
      <DisplayMenu cfg={cfg} onChange={onChange} />
      {/* Facilities (docks + traffic) */}
      {onManageFacilities && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '5px 10px', borderRight: '1px solid #d4dae3' }}>
          <button onClick={onManageFacilities} title="Manage parking/charging docks & traffic areas"
            style={{ padding: '3px 9px', fontSize: 9, fontFamily: 'Roboto Mono', borderRadius: 2, cursor: 'pointer',
              border: '1px solid #d4dae3', color: '#2563eb', background: 'rgba(37,99,235,0.06)' }}>
            🅿 DOCKS / ⛒ TRAFFIC
          </button>
        </div>
      )}
      {/* Analytics: KPI dashboard + task history */}
      {(onOpenDashboard || onOpenHistory) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRight: '1px solid #d4dae3' }}>
          {onOpenDashboard && (
            <button onClick={onOpenDashboard} title="Fleet KPI dashboard"
              style={{ padding: '3px 9px', fontSize: 9, fontFamily: 'Roboto Mono', borderRadius: 2, cursor: 'pointer',
                border: '1px solid #d4dae3', color: '#2563eb', background: 'rgba(37,99,235,0.06)' }}>
              📊 DASHBOARD
            </button>
          )}
          {onOpenHistory && (
            <button onClick={onOpenHistory} title="Task history + CSV export"
              style={{ padding: '3px 9px', fontSize: 9, fontFamily: 'Roboto Mono', borderRadius: 2, cursor: 'pointer',
                border: '1px solid #d4dae3', color: '#64748b', background: 'transparent' }}>
              📋 HISTORY
            </button>
          )}
        </div>
      )}
      {/* Zoom buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', marginLeft: 'auto' }}>
        <span style={{ fontFamily: 'Roboto Mono', fontSize: 10, color: '#64748b' }}>{zoom.toFixed(2)}×</span>
        {[['＋', onZoomIn], ['－', onZoomOut], ['Fit', onFit]].map(([lbl, fn]) => (
          <button key={lbl as string} onClick={fn as () => void}
            style={{ padding: '3px 8px', fontSize: 10, borderRadius: 2, cursor: 'pointer', border: '1px solid #d4dae3', color: '#64748b', background: 'rgba(37,99,235,0.05)', fontFamily: 'Inter, "Noto Sans JP", sans-serif' }}>
            {lbl as string}
          </button>
        ))}
      </div>
    </div>
  )
}
