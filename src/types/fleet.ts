// ============================================================
// ATP-RMS-V2 - Domain types adapted from the legacy AIPA RDS v2
// (C:\Aipa\System\Rds\sql\aipa_rds.sql). Mirrors db/schema.sql.
// Complements the VDA5050 wire types in ./index.ts.
// ============================================================
import type { AgvModel, AgvStatus } from './index'

// AGV Type / physical spec
export type AgvCategory = 'AMR' | 'Lifter' | 'Forklift' | 'Tug'

export interface AgvTypeSpec {
  code: AgvModel
  name: string
  category: AgvCategory
  loadKg: number
  speedMax: number       // m/s
  lengthMm: number
  widthMm: number
  heightMm: number
  turnRadiusMm: number   // 0 = spin in place
  batteryKwh: number
}

// Missions (jobs) - superset of the existing FleetOrder
export type MissionType   = 'TRANSPORT' | 'CHARGE' | 'MOVE'
export type MissionStatus =
  | 'PENDING' | 'ASSIGNED' | 'EXECUTING' | 'FINISHED' | 'FAILED' | 'CANCELLED'

export interface Mission {
  id: string
  missionNo: string
  agvId: string | null
  type: MissionType
  status: MissionStatus
  priority: number       // 1 = highest .. 9 = lowest
  startNode: string
  endNode: string
  progress: number       // 0..100
  payload?: string
  createdAt: string
  assignedAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

// Alarms / Events
export type AlarmLevel  = 'INFO' | 'WARNING' | 'ERROR' | 'FATAL'
export type AlarmStatus = 'ACTIVE' | 'RESOLVED'

export interface Alarm {
  id: string
  agvId: string | null
  code: string
  level: AlarmLevel
  message: string
  status: AlarmStatus
  createdAt: string
  resolvedAt?: string | null
}

// Telemetry history (time-series)
export interface RobotStatusRecord {
  agvId: string
  status: AgvStatus
  battery: number
  x: number
  y: number
  theta: number
  mileage: number        // cumulative meters
  recordedAt: string
}

// ── Fleet configuration (user-added, persisted) ────────────
// An AMR the operator registered to connect to a REAL robot over MQTT.
export interface AmrConfig {
  serial: string          // VDA5050 serialNumber — also the topic segment
  name: string            // display name
  model: AgvModel
  color: string
  ip: string              // robot IP (reference / per-robot broker host)
  enabled: boolean        // include when connecting
}

// A user-added map (ATP JSON), stored locally and switchable.
export interface MapConfig {
  id: string
  name: string
  source: 'builtin' | 'uploaded'
  url?: string            // for builtin/public maps
  data?: string           // raw ATP JSON for uploaded maps
}

// MQTT broker the browser connects to (WebSocket only — see note in
// mqtt.service). For real robots that speak TCP 1883, point this at a
// Mosquitto bridge exposing a WebSocket listener.
export interface BrokerConfig {
  wsUrl: string           // e.g. ws://localhost:9001
  username?: string
  password?: string
  manufacturer: string    // VDA5050 manufacturer segment, e.g. ATP
}

// RBAC
export type UserRole = 'ADMIN' | 'OPERATOR' | 'VIEWER'

export interface SysUser {
  id: string
  username: string
  realName: string
  role: UserRole
  enabled: boolean
  lastLogin?: string | null
}
