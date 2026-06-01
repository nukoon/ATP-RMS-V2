import type { Alarm } from '@/types/fleet'
import { useFleetStore } from '@/store/fleet.store'

const LEVEL_COLOR: Record<Alarm['level'], string> = {
  INFO:    '#00d4ff',
  WARNING: '#ffb800',
  ERROR:   '#ff4444',
  FATAL:   '#ff2222',
}

const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

export function AlarmPanel({ onSelectRobot }: { onSelectRobot: (id: string) => void }) {
  const alarms = useFleetStore(s => s.alarms)
  const resolveAlarm = useFleetStore(s => s.resolveAlarm)
  const active = alarms.filter(a => a.status === 'ACTIVE')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: '#5a7080', textTransform: 'uppercase', padding: '8px 12px 6px' }}>
        Alarms — <span style={{ color: active.length ? '#ff4444' : '#3a7050', fontFamily: 'Share Tech Mono' }}>{active.length} active</span>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {alarms.length === 0 && <div style={{ fontSize: 10, color: '#3a5060', padding: '10px 12px' }}>No alarms</div>}
        {alarms.slice(0, 60).map(a => {
          const col = LEVEL_COLOR[a.level]
          const resolved = a.status === 'RESOLVED'
          return (
            <div key={a.id} style={{ padding: '6px 12px', borderBottom: '1px solid rgba(21,32,48,0.6)', opacity: resolved ? 0.45 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: col, boxShadow: resolved ? 'none' : `0 0 5px ${col}`, flexShrink: 0 }} />
                  <button onClick={() => a.agvId && onSelectRobot(a.agvId)}
                    style={{ background: 'transparent', border: 'none', padding: 0, cursor: a.agvId ? 'pointer' : 'default',
                      fontFamily: 'Share Tech Mono', fontSize: 10, color: '#00d4ff' }}>
                    {a.agvId ?? 'SYSTEM'}
                  </button>
                  <span style={{ fontSize: 8, color: col, fontWeight: 700, letterSpacing: 0.5 }}>{a.level}</span>
                </span>
                <span style={{ fontFamily: 'Share Tech Mono', fontSize: 9, color: '#5a7080', flexShrink: 0 }}>{ago(a.createdAt)}</span>
              </div>
              <div style={{ fontSize: 9, color: '#8a9aaa', marginTop: 2 }}>{a.message}</div>
              {!resolved && (
                <button onClick={() => resolveAlarm(a.id)}
                  style={{ marginTop: 3, fontSize: 8, padding: '1px 6px', borderRadius: 2, cursor: 'pointer',
                    color: '#5a7080', border: '1px solid #152030', background: 'transparent' }}>
                  ACK
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
