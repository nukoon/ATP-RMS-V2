/**
 * DashboardDialog — fleet KPI overview. Aggregates the live store (robots,
 * missions, metrics) into operator KPIs: throughput, utilization, average task
 * time, mission status mix, and a per-AGV breakdown. Read-only, computed on the
 * fly from whatever is driving the store (SIM or LIVE).
 */
import { useMemo } from 'react'
import type { Mission } from '@/types/fleet'
import { useFleetStore } from '@/store/fleet.store'
import { STATUS_COLOR } from '@/constants'

const MISSION_COLOR: Record<Mission['status'], string> = {
  PENDING: 'var(--text-muted)', ASSIGNED: 'var(--accent)', EXECUTING: '#16a34a',
  FINISHED: '#15803d', FAILED: '#dc2626', CANCELLED: '#b45309',
}

function durationSec(m: Mission): number | null {
  if (!m.startedAt || !m.finishedAt) return null
  const d = (new Date(m.finishedAt).getTime() - new Date(m.startedAt).getTime()) / 1000
  return d >= 0 ? d : null
}
const fmtDur = (s: number | null) => s == null ? '—' : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`

export function DashboardDialog({ onClose }: { onClose: () => void }) {
  const robots = useFleetStore(s => s.robots)
  const missions = useFleetStore(s => s.missions)
  const metrics = useFleetStore(s => s.metrics)

  const robotList = useMemo(() => [...robots.values()], [robots])

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const m of missions) c[m.status] = (c[m.status] ?? 0) + 1
    return c
  }, [missions])

  const finished = missions.filter(m => m.status === 'FINISHED')
  const durations = finished.map(durationSec).filter((d): d is number => d != null)
  const avgTask = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null

  const perAgv = useMemo(() => robotList.map(r => {
    const mine = missions.filter(m => m.agvId === r.id)
    return {
      id: r.id,
      status: r.status,
      battery: Math.round(r.battery.batteryCharge),
      distance: r.totalDistance,
      done: mine.filter(m => m.status === 'FINISHED').length,
      active: mine.filter(m => m.status === 'EXECUTING' || m.status === 'ASSIGNED').length,
    }
  }), [robotList, missions])

  const totalMissions = missions.length || 1

  return (
    <div onClick={onClose} style={ovl}>
      <div onClick={e => e.stopPropagation()} style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 11, letterSpacing: 2, color: 'var(--accent)' }}>📊 FLEET DASHBOARD</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>

        <div style={{ overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <Kpi label="Throughput" value={`${metrics.throughputPerHour}`} unit="orders/hr" color="#16a34a" />
            <Kpi label="Utilization" value={`${Math.round(metrics.utilization * 100)}`} unit="%" color="var(--accent)" />
            <Kpi label="Avg Task Time" value={fmtDur(avgTask)} color="#7c3aed" />
            <Kpi label="Orders Done" value={`${statusCounts.FINISHED ?? 0}`} color="#15803d" />
            <Kpi label="Avg Battery" value={`${metrics.avgBattery}`} unit="%" color={metrics.avgBattery > 50 ? '#16a34a' : '#f59e0b'} />
            <Kpi label="Total Distance" value={metrics.totalDistance.toFixed(1)} unit="m" color="var(--text-2)" />
            <Kpi label="Active AGVs" value={`${metrics.activeCount}`} unit={`/ ${robotList.length}`} color="#16a34a" />
            <Kpi label="Errors" value={`${metrics.errorCount}`} color={metrics.errorCount > 0 ? '#dc2626' : '#16a34a'} />
          </div>

          {/* mission status mix */}
          <div>
            <SectionTitle>Mission Status ({missions.length})</SectionTitle>
            <div style={{ display: 'flex', height: 14, borderRadius: 3, overflow: 'hidden', border: '1px solid var(--border)' }}>
              {(Object.keys(MISSION_COLOR) as Mission['status'][]).map(s => {
                const n = statusCounts[s] ?? 0
                if (!n) return null
                return <div key={s} title={`${s}: ${n}`} style={{ width: `${(n / totalMissions) * 100}%`, background: MISSION_COLOR[s] }} />
              })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
              {(Object.keys(MISSION_COLOR) as Mission['status'][]).map(s => (
                <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-2)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: MISSION_COLOR[s] }} />
                  {s} <b style={{ fontFamily: 'Roboto Mono' }}>{statusCounts[s] ?? 0}</b>
                </span>
              ))}
            </div>
          </div>

          {/* per-AGV breakdown */}
          <div>
            <SectionTitle>Per-AGV</SectionTitle>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'Roboto Mono' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                  {['AGV', 'Status', 'Battery', 'Distance', 'Active', 'Done'].map(h => (
                    <th key={h} style={{ padding: '5px 8px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perAgv.map(a => (
                  <tr key={a.id} style={{ borderBottom: '1px solid rgba(212,218,227,0.6)' }}>
                    <td style={{ padding: '5px 8px', color: 'var(--text)', fontWeight: 600 }}>{a.id}</td>
                    <td style={{ padding: '5px 8px', color: STATUS_COLOR[a.status] ?? 'var(--text-muted)' }}>{a.status}</td>
                    <td style={{ padding: '5px 8px', color: a.battery > 30 ? '#16a34a' : '#dc2626' }}>{a.battery}%</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-2)' }}>{a.distance.toFixed(1)} m</td>
                    <td style={{ padding: '5px 8px', color: 'var(--accent)' }}>{a.active}</td>
                    <td style={{ padding: '5px 8px', color: '#15803d' }}>{a.done}</td>
                  </tr>
                ))}
                {!perAgv.length && (
                  <tr><td colSpan={6} style={{ padding: 14, color: 'var(--text-faint)', textAlign: 'center' }}>No robots — START SIM or CONNECT</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, unit, color }: { label: string; value: string; unit?: string; color: string }) {
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '10px 12px' }}>
      <div style={{ fontSize: 9, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'Roboto Mono', fontSize: 22, fontWeight: 700, color }}>{value}</span>
        {unit && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{unit}</span>}
      </div>
    </div>
  )
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>{children}</div>
)

const ovl: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
const panel: React.CSSProperties = { width: 'min(820px, 92vw)', maxHeight: '88vh', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter, "Noto Sans JP", sans-serif', color: 'var(--text)' }
