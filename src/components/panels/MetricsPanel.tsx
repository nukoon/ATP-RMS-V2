import type { FleetMetrics } from '@/types'

const Row = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 11, borderBottom: '1px solid rgba(212,218,227,0.5)' }}>
    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    <span style={{ fontFamily: 'Roboto Mono', fontWeight: 600, color: color ?? 'var(--text)' }}>{value}</span>
  </div>
)

export function MetricsPanel({ metrics }: { metrics: FleetMetrics }) {
  return (
    <div>
      <Row label="Throughput"    value={`${metrics.throughputPerHour}/hr`}    color="#16a34a" />
      <Row label="Avg Battery"   value={`${metrics.avgBattery}%`}             color={metrics.avgBattery > 50 ? '#16a34a' : '#f59e0b'} />
      <Row label="Orders Done"   value={`${metrics.ordersCompleted}`}          color="#16a34a" />
      <Row label="Utilization"   value={`${Math.round(metrics.utilization * 100)}%`} color="#16a34a" />
      <Row label="Total Dist"    value={`${metrics.totalDistance.toFixed(1)} m`} />
      <Row label="Errors"        value={`${metrics.errorCount}`}               color={metrics.errorCount > 0 ? '#dc2626' : '#16a34a'} />
    </div>
  )
}
