import type { ReactNode } from 'react'
import type { Robot } from '@/types'
import { STATUS_COLOR, STATUS_LABEL, AGV_ASSET_PATH } from '@/constants'
import { AGV_SPECS } from '@/constants/agv-specs'
import { colorOf } from '@/constants/fleet-roster'

export type RobotAction = 'PAUSE' | 'RESUME' | 'CANCEL' | 'PARK' | 'CHARGE' | 'VIEW' | 'LEAVE' | 'RETURN' | 'CLEAR_ERR'

interface Props {
  robot: Robot
  onClose: () => void
  onAction: (action: RobotAction) => void
  live?: boolean   // connected to a real broker → hide sim-only actions (Park/Leave/Return)
}

const Field = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: 10, borderBottom: '1px solid rgba(212,218,227,0.5)' }}>
    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    <span style={{ fontFamily: 'Roboto Mono', fontWeight: 600, color: color ?? 'var(--text)' }}>{value}</span>
  </div>
)

export function RobotDetail({ robot: r, onClose, onAction, live }: Props) {
  const col    = STATUS_COLOR[r.status]
  const spec   = AGV_SPECS[r.model]
  const idCol  = colorOf(r.id)
  const batCol = r.battery.batteryCharge > 50 ? '#16a34a' : r.battery.batteryCharge > 20 ? '#f59e0b' : '#dc2626'
  const speed  = Math.hypot(r.velocity.vx, r.velocity.vy)
  const isPaused = r.status === 'PAUSE'
  const isAway   = r.status === 'UNAVAILABLE'   // pulled off the map via LEAVE

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'rgba(37,99,235,0.04)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: idCol, boxShadow: `0 0 6px ${idCol}`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Roboto Mono', fontSize: 12, color: 'var(--accent)' }}>{r.name || r.id}</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{r.model}{r.name && r.name !== r.id ? ` · ${r.id}` : ''}</div>
        </div>
        <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 2, fontWeight: 700, letterSpacing: 1, color: col, border: `1px solid ${col}40`, background: col + '12' }}>
          {STATUS_LABEL[r.status]}
        </span>
        <button onClick={onClose} title="Close"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px' }}>
        {/* Robot image + battery */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <img src={AGV_ASSET_PATH(r.model, r.status)} style={{ width: 52, height: 52, objectFit: 'contain', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
              <span style={{ color: 'var(--text-muted)' }}>Battery</span>
              <span style={{ fontFamily: 'Roboto Mono', color: batCol }}>{Math.round(r.battery.batteryCharge)}%{r.battery.charging ? ' ⚡' : ''}</span>
            </div>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '100%', background: batCol, transform: `scaleX(${r.battery.batteryCharge / 100})`, transformOrigin: 'left', transition: 'transform 0.5s' }} />
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
        <SectionTitle>Errors {r.errors.length > 0 && <span style={{ color: '#dc2626' }}>({r.errors.length})</span>}</SectionTitle>
        {r.errors.length === 0 ? (
          <div style={{ fontSize: 10, color: 'var(--text-faint)', padding: '4px 0' }}>No active errors</div>
        ) : r.errors.map((e, i) => (
          <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(212,218,227,0.5)' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 2, fontWeight: 700, color: e.errorLevel === 'FATAL' ? '#dc2626' : '#f59e0b', border: `1px solid ${e.errorLevel === 'FATAL' ? '#dc2626' : '#f59e0b'}40` }}>
                {e.errorLevel}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text)', fontFamily: 'Roboto Mono' }}>{e.errorType}</span>
            </div>
            {e.errorDescription && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{e.errorDescription}</div>}
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
        <ActionBtn icon={isPaused ? <PlayIcon /> : <PauseIcon />} label={isPaused ? 'Resume' : 'Pause'} color={isPaused ? '#16a34a' : '#f59e0b'}
          onClick={() => onAction(isPaused ? 'RESUME' : 'PAUSE')} />
        <ActionBtn icon={<ParkIcon />} label="Park" color="#2563eb" onClick={() => onAction('PARK')} title={live ? 'Drive to the park node' : 'Send to its park dock (simulation)'} />
        <ActionBtn icon={<BoltIcon />}   label="Charge" color="#ea7a00" onClick={() => onAction('CHARGE')} title={live ? 'startCharging (VDA5050 instantAction)' : 'Send to the nearest charge dock'} />
        <ActionBtn icon={<TargetIcon />} label="View"   color="#0891b2" onClick={() => onAction('VIEW')} title="Center the map on this robot" />
        {/* Leave/Return are sim-only (no VDA5050 equivalent) — hidden when live */}
        {!live && <ActionBtn icon={isAway ? <ReturnIcon /> : <ExitIcon />} label={isAway ? 'Return' : 'Leave'} color={isAway ? '#16a34a' : '#7c3aed'}
          onClick={() => onAction(isAway ? 'RETURN' : 'LEAVE')}
          title={isAway ? 'Bring the robot back onto the map' : 'Temporarily remove from the map so another AGV can pass a deadlock'} />}
        <ActionBtn icon={<CancelIcon />} label="Cancel" color="#dc2626" onClick={() => onAction('CANCEL')} title="cancelOrder — clear the robot's current task (VDA5050 instantAction)" />
        <ActionBtn icon={<ClearErrIcon />} label="Clear Err" color="#ea7a00" onClick={() => onAction('CLEAR_ERR')}
          title="Recover from a fault: sends cancelOrder to drop the failed task and clears this robot's alarms. A persistent hardware fault must be cleared at the robot HMI." />
      </div>
    </div>
  )
}

// ── action icons (16px, stroke = currentColor) ──────────────
const iconBase = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const PauseIcon  = () => <svg {...iconBase}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
const PlayIcon   = () => <svg {...iconBase} fill="currentColor" stroke="none"><path d="M7 5l12 7-12 7z" /></svg>
const ParkIcon   = () => <svg {...iconBase}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9.5 16V8.5h3a2.5 2.5 0 0 1 0 5h-3" /></svg>
const BoltIcon   = () => <svg {...iconBase} fill="currentColor" stroke="none"><path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z" /></svg>
const TargetIcon = () => <svg {...iconBase}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
const ExitIcon   = () => <svg {...iconBase}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8" /><path d="M19 12H10" /><path d="M16 9l3 3-3 3" /></svg>
const ReturnIcon = () => <svg {...iconBase}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v6" /></svg>
const CancelIcon = () => <svg {...iconBase}><path d="M6 6l12 12M18 6L6 18" /></svg>
const ClearErrIcon = () => <svg {...iconBase}><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '10px 0 4px' }}>{children}</div>
)

const ActionBtn = ({ icon, label, color, onClick, title }: { icon: ReactNode; label: string; color: string; onClick: () => void; title?: string }) => (
  <button onClick={onClick} title={title}
    style={{ flex: '1 1 28%', minWidth: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      padding: '6px 0', fontSize: 9, borderRadius: 4, cursor: 'pointer', fontFamily: 'Inter, "Noto Sans JP", sans-serif', fontWeight: 600, letterSpacing: 0.3,
      color, border: `1px solid ${color}55`, background: color + '10', transition: 'background 120ms ease' }}
    onMouseEnter={e => (e.currentTarget.style.background = color + '22')}
    onMouseLeave={e => (e.currentTarget.style.background = color + '10')}>
    {icon}
    {label}
  </button>
)
