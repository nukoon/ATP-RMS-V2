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
  // Storage-based transport (pickup → dropoff), referenced by storage id/name
  pickupStorageId?: string | null
  dropoffStorageId?: string | null
  pickupStorageName?: string | null
  dropoffStorageName?: string | null
  actions?: MissionAction[]   // resolved VDA5050 action plan snapshot
  createdBy?: string | null   // operator who issued the command (display name)
  createdAt: string
  assignedAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

// One resolved action in a mission plan (snapshot of a template + overrides).
export interface MissionAction {
  stage: ActionStage          // PICK (at pickup node) / DROP (at dropoff node)
  actionType: string          // VDA5050 actionType
  blockingType: 'NONE' | 'SOFT' | 'HARD'
  description?: string
  params: ActionParam[]
}

// ── Storage areas (pickup / delivery points) ───────────────
export type StorageState = 'EMPTY' | 'FULL'
export type StorageKind  = 'PICK' | 'DROP' | 'BOTH'

export interface Storage {
  id: string
  name: string                // referenced by missions, e.g. ST-A1
  nodeId: string              // bound map location node id
  mapId?: string | null
  areaId?: string | null      // optional group for batch pickup/drop
  kind: StorageKind
  state: StorageState
  label?: string
  enabled: boolean
}

// ── Storage areas: a named group of storages handled as a batch ──
export interface StorageArea {
  id: string
  name: string
  kind: StorageKind           // PICK / DROP / BOTH
  mapId?: string | null
  enabled: boolean
}

// ── Traffic areas: operator-defined mutual-exclusion zones ──
// At most `capacity` AMRs may be inside the node set at once; others wait
// outside (no reversing). Used where automatic routing can't resolve a jam.
export interface TrafficArea {
  id: string
  name: string
  nodeIds: string[]
  capacity: number
  mapId?: string | null
  enabled: boolean
}

// ── Field devices: peripherals at a map node (doors, traffic lights, lifts…) ──
// Foundation only — the docking-signal handshake is not designed yet (→ config).
export type DeviceType = 'DOOR' | 'TRAFFIC_LIGHT' | 'LIFT' | 'CONVEYOR' | 'GENERIC'

export interface FieldDevice {
  id: string
  name: string
  type: DeviceType
  nodeId: string              // bound map node id
  state?: string | null       // device-dependent (OPEN/CLOSED, RED/GREEN, ON/OFF…)
  config?: Record<string, unknown> | null   // reserved: future signal integration
  mapId?: string | null
  enabled: boolean
}

// per-type two states (for the manual toggle + map colour); first = "clear/idle"
export const DEVICE_STATES: Record<DeviceType, [string, string]> = {
  DOOR:          ['CLOSED', 'OPEN'],
  TRAFFIC_LIGHT: ['RED', 'GREEN'],
  LIFT:          ['IDLE', 'BUSY'],
  CONVEYOR:      ['OFF', 'ON'],
  GENERIC:       ['OFF', 'ON'],
}

// ── Docks: parking & charging points (optionally bound to a robot) ──
export type DockType = 'PARK' | 'CHARGE'

export interface Dock {
  id: string
  name: string
  nodeId: string              // bound map node id
  type: DockType
  agvId?: string | null       // bound robot runtime id/serial (e.g. ATP-01)
  mapId?: string | null
  enabled: boolean
}

// ── VDA5050 action templates + per-storage bindings ────────
export type ActionStage = 'PICK' | 'DROP'

export interface ActionParam {
  key: string
  value: string | number | boolean
}

export interface VdaActionTemplate {
  id: string
  code: string                // liftUp, liftDown, trayRotate, ...
  actionType: string          // VDA5050 actionType on the wire
  name?: string
  blockingType: 'NONE' | 'SOFT' | 'HARD'
  description?: string
  defaultParams: ActionParam[]
}

export interface StorageActionBinding {
  id?: string
  storageId: string
  actionId: string            // vda_action template id
  stage: ActionStage
  seq: number
  params?: ActionParam[]      // override (else template default)
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
  brand: VdaBrandId       // robot vendor → its VDA5050 topic scheme + manufacturer
  // operational thresholds (null = use fleet defaults)
  lowBattery?: number | null     // % at/below which it must go charge
  resumeBattery?: number | null  // % at/above which it may take jobs again
  chargeTarget?: number | null   // charge until this % then return to park
  parkNode?: string | null       // map node it parks at (home)
  chargeNode?: string | null     // map node it charges at (else nearest charge dock)
}

// A user-added map (ATP JSON), stored locally and switchable.
export interface MapConfig {
  id: string
  name: string
  source: 'builtin' | 'uploaded'
  url?: string            // for builtin/public maps
  data?: string           // raw ATP JSON for uploaded maps
}

// Robot vendor / VDA5050 integration brand. Different brands use different
// topic prefixes + manufacturer segments (e.g. Aiten/SEER = robot/v2/SEER,
// generic VDA5050 = uagv/v2). Presets live in constants/vda-brands.ts.
export type VdaBrandId = 'aiten' | 'seer' | 'generic'

// MQTT broker the browser connects to (WebSocket only — see note in
// mqtt.service). For real robots that speak TCP 1883, point this at a
// Mosquitto bridge exposing a WebSocket listener.
export interface BrokerConfig {
  brand: VdaBrandId       // robot vendor preset (sets topic scheme + manufacturer)
  wsUrl: string           // e.g. ws://localhost:9001
  username?: string
  password?: string
  manufacturer: string    // VDA5050 manufacturer segment, e.g. SEER / ATP
  baseTopic: string       // topic prefix incl. version, e.g. robot/v2 or uagv/v2
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
