import type { Robot } from '@/types'
import { STATUS_COLOR, STATUS_LABEL, AGV_POSTER_PATH } from '@/constants'

interface Props {
  robots: Robot[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function RobotList({ robots, selectedId, onSelect }: Props) {
  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {robots.map(r => (
        <RobotCard
          key={r.id}
          robot={r}
          selected={selectedId === r.id}
          onClick={() => onSelect(selectedId === r.id ? null : r.id)}
        />
      ))}
    </div>
  )
}

function RobotCard({ robot: r, selected, onClick }: { robot: Robot; selected: boolean; onClick: () => void }) {
  const col     = STATUS_COLOR[r.status]
  const batCol  = r.battery.batteryCharge > 50 ? '#16a34a' : r.battery.batteryCharge > 20 ? '#f59e0b' : '#dc2626'
  const imgSrc  = AGV_POSTER_PATH(r.model)

  return (
    <div
      onClick={onClick}
      style={{
        padding: selected ? '8px 10px 8px 10px' : '8px 12px',
        borderBottom: '1px solid rgba(212,218,227,0.9)',
        borderLeft: selected ? `2px solid var(--accent)` : '2px solid transparent',
        background: selected ? 'rgba(37,99,235,0.06)' : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.color ?? 'var(--text-faint)', flexShrink: 0, border: '1px solid rgba(0,0,0,0.15)' }} />
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 11, color: 'var(--text)' }}>{r.id}</span>
        </span>
        <span style={{
          fontSize: 8, padding: '1px 5px', borderRadius: 2, fontWeight: 700, letterSpacing: 1,
          color: col, border: `1px solid ${col}40`, background: col + '12',
        }}>
          {STATUS_LABEL[r.status]}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <img src={imgSrc} style={{ width: 60, height: 60, objectFit: 'contain', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, fontSize: 9, color: 'var(--text-muted)' }}>
            <span>Bat: <b style={{ color: 'var(--text)' }}>{Math.round(r.battery.batteryCharge)}%</b></span>
            <span>Spd: <b style={{ color: 'var(--text)' }}>{r.velocity.vx.toFixed(1)}m/s</b></span>
            <span style={{ gridColumn: '1/-1' }}>
              θ: <b style={{ color: 'var(--text)' }}>{r.pose.theta.toFixed(0)}°</b>
              &nbsp;&nbsp;{r.currentNodeId}
            </span>
          </div>
          <div style={{ height: 2, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
            <div style={{ height: '100%', width: '100%', background: batCol, borderRadius: 2, transform: `scaleX(${r.battery.batteryCharge / 100})`, transformOrigin: 'left', transition: 'transform 0.5s' }} />
          </div>
        </div>
      </div>
    </div>
  )
}
