import type { Robot } from '@/types'
import { STATUS_COLOR, STATUS_LABEL, AGV_ASSET_PATH } from '@/constants'
import { AGV_SPECS } from '@/constants/agv-specs'
import { colorOf } from '@/constants/fleet-roster'

interface Props {
  robot: Robot
  onClose: () => void
  onAction: (action: 'PAUSE' | 'RESUME' | 'CANCEL') => void
}

const Field = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: 10, borderBottom: '1px solid rgba(21,32,48,0.5)' }}>
    <span style={{ color: '#5a7080' }}>{label}</span>
    <span style={{ fontFamily: 'Share Tech Mono', fontWeight: 600, color: color ?? '#c8d8e8' }}>{value}</span>
  </div>
)

export function RobotDetail({ robot: r, onClose, onAction }: Props) {
  const col    = STATUS_COLOR[r.status]
  const spec   = AGV_SPECS[r.model]
  const idCol  = colorOf(r.id)
  const batCol = r.battery.batteryCharge > 50 ? '#00ff88' : r.battery.batteryCharge > 20 ? '#ffb800' : '#ff4444'
  const speed  = Math.hypot(r.velocity.vx, r.velocity.vy)
  const isPaused = r.status === 'PAUSE'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #152030', background: 'rgba(0,212,255,0.04)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: idCol, boxShadow: `0 0 6px ${idCol}`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Share Tech Mono', fontSize: 12, color: '#00d4ff' }}>{r.id}</div>
          <div style={{ fontSize: 9, color: '#5a7080' }}>{spec?.name ?? r.model}</div>
        </div>
        <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 2, fontWeight: 700, letterSpacing: 1, color: col, border: `1px solid ${col}40`, background: col + '12' }}>
          {STATUS_LABEL[r.status]}
        </span>
        <button onClick={onClose} title="Close"
          style={{ background: 'transparent', border: 'none', color: '#5a7080', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px' }}>
        {/* Robot image + battery */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <img src={AGV_ASSET_PATH(r.model, r.status)} style={{ width: 52, height: 52, objectFit: 'contain', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
              <span style={{ color: '#5a7080' }}>Battery</span>
              <span style={{ fontFamily: 'Share Tech Mono', color: batCol }}>{Math.round(r.battery.batteryCharge)}%{r.battery.charging ? ' ⚡' : ''}</span>
            </div>
            <div style={{ height: 4, background: '#152030', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${r.battery.batteryCharge}%`, background: batCol, transition: 'width 0.5s' }} />
            </div>
          </div>
        </div>

        {/* Live telemetry */}
        <SectionTitle>Telemetry</SectionTitle>
        <Field label="Status"   value={STATUS_LABEL[r.status]} color={col} />
        <Field label="Position" value={`${r.pose.x.toFixed(2)}, ${r.pose.y.toFixed(2)}`} />
        <Field label="Heading"  value={`${r.pose.theta.toFixed(0)}°`} />
        <Field label="Speed"    value={`${speed.toFixed(2)} m/s`} />
        <Field label="Node"     value={r.currentNodeId || '—'} />
        <Field label="Order"    value={r.currentOrderId || '—'} />
        <Field label="Distance" value={`${r.totalDistance.toFixed(1)} m`} />

        {/* Spec */}
        {spec && <>
          <SectionTitle>Spec — {spec.category}</SectionTitle>
          <Field label="Max load"  value={`${spec.loadKg} kg`} />
          <Field label="Max speed" value={`${spec.speedMax} m/s`} />
          <Field label="Footprint" value={`${spec.lengthMm}×${spec.widthMm} mm`} />
          <Field label="Battery"   value={`${spec.batteryKwh} kWh`} />
        </>}

        {/* Errors */}
        <SectionTitle>Errors {r.errors.length > 0 && <span style={{ color: '#ff4444' }}>({r.errors.length})</span>}</SectionTitle>
        {r.errors.length === 0 ? (
          <div style={{ fontSize: 10, color: '#3a5060', padding: '4px 0' }}>No active errors</div>
        ) : r.errors.map((e, i) => (
          <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(21,32,48,0.5)' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 2, fontWeight: 700, color: e.errorLevel === 'FATAL' ? '#ff4444' : '#ffb800', border: `1px solid ${e.errorLevel === 'FATAL' ? '#ff4444' : '#ffb800'}40` }}>
                {e.errorLevel}
              </span>
              <span style={{ fontSize: 10, color: '#c8d8e8', fontFamily: 'Share Tech Mono' }}>{e.errorType}</span>
            </div>
            {e.errorDescription && <div style={{ fontSize: 9, color: '#5a7080', marginTop: 2 }}>{e.errorDescription}</div>}
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: '1px solid #152030' }}>
        <ActionBtn label={isPaused ? 'Resume' : 'Pause'} color={isPaused ? '#00ff88' : '#ffb800'}
          onClick={() => onAction(isPaused ? 'RESUME' : 'PAUSE')} />
        <ActionBtn label="Cancel" color="#ff4444" onClick={() => onAction('CANCEL')} />
      </div>
    </div>
  )
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 9, letterSpacing: 2, color: '#5a7080', textTransform: 'uppercase', margin: '10px 0 4px' }}>{children}</div>
)

const ActionBtn = ({ label, color, onClick }: { label: string; color: string; onClick: () => void }) => (
  <button onClick={onClick}
    style={{ flex: 1, padding: '5px 0', fontSize: 10, borderRadius: 2, cursor: 'pointer', fontFamily: 'Rajdhani, sans-serif', fontWeight: 600, letterSpacing: 1,
      color, border: `1px solid ${color}55`, background: color + '10' }}>
    {label}
  </button>
)
