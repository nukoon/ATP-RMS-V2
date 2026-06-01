// ============================================================
// ATP-RMS-V2 — Fleet roster
// The REAL fleet, verified live from aipa_rds.agv_info (2026-06-01).
// Three APe15 auto-pallet AGVs, each with its own identity colour.
//   length 1516mm (loaded 1200mm), max_velocity 1000 mm/s = 1.0 m/s
//   energy_level: critical 30 / good 50 / interrupt 70 / fullyRecharged 90 (%)
// ============================================================
import type { AgvModel } from '@/types'

export interface FleetMember {
  id: string          // agv_info.agv_name
  agvId: number       // agv_info.agv_id
  model: AgvModel     // agv_info.agv_type
  color: string       // agv_info.agv_color (identity colour, status-independent)
  maxVelocity: number // m/s (max_velocity mm/s ÷ 1000)
  lengthMm: number
}

export const ENERGY_LEVELS = {
  critical: 30,           // must charge below this
  good: 50,               // idle-charge target
  interrupt: 70,          // charge interruptible above this
  fullyRecharged: 90,
} as const

export const FLEET_ROSTER: FleetMember[] = [
  { id: 'AGV-56', agvId: 56, model: 'APe15', color: '#08D26E', maxVelocity: 1.0, lengthMm: 1516 },
  { id: 'AGV-58', agvId: 58, model: 'APe15', color: '#3dcfff', maxVelocity: 1.0, lengthMm: 1516 },
  { id: 'AGV-60', agvId: 60, model: 'APe15', color: '#c90bfe', maxVelocity: 1.0, lengthMm: 1516 },
]

export const memberOf = (id: string): FleetMember | undefined =>
  FLEET_ROSTER.find(f => f.id === id)

export const colorOf = (id: string): string => memberOf(id)?.color ?? '#00d4ff'
