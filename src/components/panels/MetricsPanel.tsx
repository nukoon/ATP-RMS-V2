import type { FleetMetrics } from '@/types'

const Row = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 11, borderBottom: '1px solid rgba(21,32,48,0.5)' }}>
    <span style={{ color: '#5a7080' }}>{label}</span>
    <span style={{ fontFamily: 'Share Tech Mono', fontWeight: 600, color: color ?? '#c8d8e8' }}>{value}</span>
  </div>
)

export function MetricsPanel({ metrics }: { metrics: FleetMetrics }) {
  return (
    <div>
      <Row label="Throughput"    value={`${metrics.throughputPerHour}/hr`}    color="#00ff88" />
      <Row label="Avg Battery"   value={`${metrics.avgBattery}%`}             color={metrics.avgBattery > 50 ? '#00ff88' : '#ffb800'} />
      <Row label="Orders Done"   value={`${metrics.ordersCompleted}`}          color="#00ff88" />
      <Row label="Utilization"   value={`${Math.round(metrics.utilization * 100)}%`} color="#00ff88" />
      <Row label="Total Dist"    value={`${metrics.totalDistance.toFixed(1)} m`} />
      <Row label="Errors"        value={`${metrics.errorCount}`}               color={metrics.errorCount > 0 ? '#ff4444' : '#00ff88'} />
    </div>
  )
}
