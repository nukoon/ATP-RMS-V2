import type { Robot } from '@/types'
import { STATUS_COLOR, STATUS_LABEL, AGV_ASSET_PATH } from '@/constants'

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
  const batCol  = r.battery.batteryCharge > 50 ? '#00ff88' : r.battery.batteryCharge > 20 ? '#ffb800' : '#ff4444'
  const imgSrc  = AGV_ASSET_PATH(r.model, r.status)

  return (
    <div
      onClick={onClick}
      style={{
        padding: selected ? '8px 10px 8px 10px' : '8px 12px',
        borderBottom: '1px solid rgba(21,32,48,0.9)',
        borderLeft: selected ? `2px solid #00d4ff` : '2px solid transparent',
        background: selected ? 'rgba(0,212,255,0.06)' : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontFamily: 'Share Tech Mono', fontSize: 11, color: '#00d4ff' }}>{r.id}</span>
        <span style={{
          fontSize: 8, padding: '1px 5px', borderRadius: 2, fontWeight: 700, letterSpacing: 1,
          color: col, border: `1px solid ${col}40`, background: col + '12',
        }}>
          {STATUS_LABEL[r.status]}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <img src={imgSrc} style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, fontSize: 9, color: '#5a7080' }}>
            <span>Bat: <b style={{ color: '#c8d8e8' }}>{Math.round(r.battery.batteryCharge)}%</b></span>
            <span>Spd: <b style={{ color: '#c8d8e8' }}>{r.velocity.vx.toFixed(1)}m/s</b></span>
            <span style={{ gridColumn: '1/-1' }}>
              θ: <b style={{ color: '#c8d8e8' }}>{r.pose.theta.toFixed(0)}°</b>
              &nbsp;&nbsp;{r.currentNodeId}
            </span>
          </div>
          <div style={{ height: 2, background: '#152030', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
            <div style={{ height: '100%', width: `${r.battery.batteryCharge}%`, background: batCol, borderRadius: 2, transition: 'width 0.5s' }} />
          </div>
        </div>
      </div>
    </div>
  )
}
