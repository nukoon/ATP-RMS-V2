import type { MqttLogEntry } from '@/types'

export function VdaStream({ entries }: { entries: MqttLogEntry[] }) {
  return (
    <div>
      {entries.slice(0, 8).map(e => (
        <div key={e.id} style={{
          display: 'flex', justifyContent: 'space-between', gap: 4,
          padding: '3px 0', borderBottom: '1px solid rgba(21,32,48,0.6)',
          fontFamily: 'Share Tech Mono', fontSize: 9, color: '#3a5060',
        }}>
          <span style={{ color: '#00d4ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {e.robotId}/{e.topic}
          </span>
          <span style={{ color: 'rgba(90,112,128,0.7)', flexShrink: 0 }}>{e.timestamp}</span>
        </div>
      ))}
    </div>
  )
}
