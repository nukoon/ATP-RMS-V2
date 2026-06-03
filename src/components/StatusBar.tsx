/**
 * StatusBar — bottom bar inspired by the legacy RDS :12200 layout.
 * Left: per-state fleet counts (operational + connection) and mission
 * counts. Right: live cursor world coords / heading / zoom.
 * Keeps our dark cyber-HUD theme (legacy is light AntD).
 */
import type { Robot, FleetMap } from '@/types'
import type { Mission } from '@/types/fleet'

interface Props {
  robots: Robot[]
  missions: Mission[]
  map: FleetMap | null
  mqttConnected: boolean
  cursor: { x: number; y: number } | null
  zoom: number
  heading: number  // selected robot heading, or 0
}

const Stat = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: value > 0 ? `0 0 5px ${color}` : 'none', opacity: value > 0 ? 1 : 0.4 }} />
    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    <span style={{ color: value > 0 ? 'var(--text)' : 'var(--text-faint)', fontWeight: 600 }}>{value}</span>
  </span>
)

const Div = () => <span style={{ width: 1, height: 11, background: 'var(--border)', flexShrink: 0 }} />

export function StatusBar({ robots, missions, map, mqttConnected, cursor, zoom, heading }: Props) {
  // operational states
  const count = (s: Robot['status']) => robots.filter(r => r.status === s).length
  const online  = robots.filter(r => r.mqttConnected).length
  const offline = robots.length - online

  // mission states
  const m = (s: Mission['status']) => missions.filter(x => x.status === s).length

  return (
    <div style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: '3px 10px', display: 'flex', gap: 10,
      fontFamily: 'Roboto Mono', fontSize: 9, color: 'var(--text-muted)', alignItems: 'center', flexShrink: 0, overflowX: 'auto', whiteSpace: 'nowrap' }}>
      {/* Operational */}
      <Stat label="Operating"   value={count('EXECUTING')}   color="#16a34a" />
      <Stat label="Charging"    value={count('CHARGING')}    color="#f59e0b" />
      <Stat label="Idle"        value={count('IDLE')}        color="var(--text-muted)" />
      <Stat label="Pause"       value={count('PAUSE')}       color="#aaaaaa" />
      <Stat label="Traffic"     value={count('TRAFFIC')}     color="#ea7a00" />
      <Stat label="Error"       value={count('ERROR')}       color="#dc2626" />
      <Div />
      {/* Connection */}
      <Stat label="Online"      value={online}               color="var(--accent)" />
      <Stat label="Offline"     value={offline}              color="#cc4444" />
      <Div />
      {/* Missions */}
      <Stat label="Running"     value={m('EXECUTING')}       color="#16a34a" />
      <Stat label="Pending"     value={m('PENDING')}         color="var(--text-muted)" />
      <Stat label="Done"        value={m('FINISHED')}        color="#15803d" />
      <Stat label="Failed"      value={m('FAILED') + m('CANCELLED')} color="#dc2626" />

      {/* Right cluster — cursor readout */}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
        <span>MQTT <span style={{ color: mqttConnected ? '#16a34a' : '#dc2626' }}>{mqttConnected ? 'UP' : 'DOWN'}</span></span>
        <Div />
        <span>A:<span style={{ color: 'var(--accent)' }}> {heading.toFixed(0)}°</span></span>
        <span>X:<span style={{ color: 'var(--accent)' }}> {cursor ? cursor.x.toFixed(2) : '—'}</span></span>
        <span>Y:<span style={{ color: 'var(--accent)' }}> {cursor ? cursor.y.toFixed(2) : '—'}</span></span>
        <span>Zoom:<span style={{ color: 'var(--accent)' }}> {Math.round(zoom * 100)}%</span></span>
        <Div />
        <span>{map ? `${map.points.length}N · ${map.curves.length}E` : '—'}</span>
      </div>
    </div>
  )
}
