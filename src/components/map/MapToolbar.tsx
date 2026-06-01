import type { MapViewConfig } from '@/types'

interface Props {
  config: MapViewConfig
  zoom: number
  onChange: (patch: Partial<MapViewConfig>) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
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

const ChkRow = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, cursor: 'pointer', color: '#64748b' }}>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ accentColor: '#2563eb', cursor: 'pointer' }} />
    {label}
  </label>
)

export function MapToolbar({ config: cfg, zoom, onChange, onZoomIn, onZoomOut, onFit }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', background: '#f3f6fa', borderBottom: '1px solid #d4dae3', flexShrink: 0, overflowX: 'auto' }}>
      <SliderRow label="Robot m"    value={cfg.robotSize}          min={1}  max={6}  step={0.5} onChange={v => onChange({ robotSize: v })} suffix="m" />
      <SliderRow label="Node px"    value={cfg.nodeSize}           min={1}  max={10} step={0.5} onChange={v => onChange({ nodeSize: v })} />
      <SliderRow label="Label px"   value={cfg.labelSize}          min={6}  max={18} step={1}   onChange={v => onChange({ labelSize: v })} />
      <SliderRow label="Label@zoom" value={cfg.labelZoomThreshold} min={0.5} max={8} step={0.5} onChange={v => onChange({ labelZoomThreshold: v })} suffix="×" />
      {/* Checkboxes */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRight: '1px solid #d4dae3' }}>
        <ChkRow label="LM"    checked={cfg.showLM}     onChange={v => onChange({ showLM: v })} />
        <ChkRow label="AP"    checked={cfg.showAP}     onChange={v => onChange({ showAP: v })} />
        <ChkRow label="CHG"   checked={cfg.showCH}     onChange={v => onChange({ showCH: v })} />
        <ChkRow label="Zones" checked={cfg.showZones}  onChange={v => onChange({ showZones: v })} />
        <ChkRow label="Edges" checked={cfg.showEdges}  onChange={v => onChange({ showEdges: v })} />
        <ChkRow label="Path"  checked={cfg.showPaths}  onChange={v => onChange({ showPaths: v })} />
        <ChkRow label="θ Dir" checked={cfg.showTheta}  onChange={v => onChange({ showTheta: v })} />
        <ChkRow label="Store" checked={cfg.showStorage} onChange={v => onChange({ showStorage: v })} />
      </div>
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
