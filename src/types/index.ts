// ============================================================
// ATP-RMS-V2 — Core Type Definitions
// VDA5050 v2.0 compliant
//
// Domain types adapted from the legacy AIPA RDS v2 live in ./fleet.ts
// (import them from '@/types/fleet'). They are kept in a separate module
// to avoid a circular re-export with the base types declared here.
// ============================================================

// ── Map Types ──────────────────────────────────────────────
export type NodeClass = 'LocationMark' | 'ActionPoint' | 'Charge'

export interface MapPoint {
  id: string
  name: string
  cls: NodeClass
  x: number
  y: number
  theta: number
}

export interface MapCurve {
  id: string
  type: 'line' | 'bezier'
  sx: number; sy: number
  ex: number; ey: number
  cp: { x: number; y: number }[]
}

export interface MapArea {
  id: string
  type: string
  poly: { x: number; y: number }[]
}

export interface FleetMap {
  points: MapPoint[]
  curves: MapCurve[]
  areas:  MapArea[]
}

// ── VDA5050 Types ──────────────────────────────────────────
export type AgvStatus =
  | 'EXECUTING'
  | 'IDLE'
  | 'CHARGING'
  | 'ERROR'
  | 'PAUSE'
  | 'TRAFFIC'
  | 'UNAVAILABLE'
  | 'UNKNOWN'

export type AgvModel = 'AM15' | 'MP10S' | 'AL02' | 'APe15' | 'AS15' | 'TP30' | 'TP60' | 'TT15' | 'TT30' | 'TT60'

export interface AgvPose {
  x: number
  y: number
  theta: number     // degrees, 0=East, 90=North (standard math)
  mapId: string
}

export interface AgvBattery {
  batteryCharge: number    // 0–100 %
  charging: boolean
  reach?: number           // estimated remaining range (m)
}

export interface AgvVelocity {
  vx: number               // m/s
  vy: number
  omega: number            // rad/s angular velocity
}

// VDA5050 State message (simplified)
export interface VDA5050State {
  headerId: number
  timestamp: string
  version: string
  manufacturer: string
  serialNumber: string
  orderId: string
  orderUpdateId: number
  lastNodeId: string
  lastNodeSequenceId: number
  driving: boolean
  agvPosition: AgvPose
  velocity: AgvVelocity
  batteryState: AgvBattery
  operatingMode: string
  errors: VDA5050Error[]
  warnings: VDA5050Warning[]
  safetyState: { fieldViolation: boolean; eStop: string }
}

export interface VDA5050Error {
  errorType: string
  errorLevel: 'WARNING' | 'FATAL'
  errorDescription: string
  errorReferences: { referenceKey: string; referenceValue: string }[]
}

export interface VDA5050Warning {
  warningType: string
  warningLevel: 'WARNING' | 'FATAL'
  warningDescription: string
}

// ── Robot (UI model) ──────────────────────────────────────
export interface Robot {
  id: string                   // e.g. "AMR-001"
  model: AgvModel
  status: AgvStatus
  pose: AgvPose
  battery: AgvBattery
  velocity: AgvVelocity
  currentNodeId: string
  currentOrderId: string | null
  path: string[]               // node IDs of current route
  pathIndex: number
  errors: VDA5050Error[]
  totalDistance: number        // meters travelled (session)
  lastUpdated: number          // Date.now()
  // MQTT connection
  mqttConnected: boolean
}

// ── Order Types ────────────────────────────────────────────
export type OrderStatus = 'PENDING' | 'ASSIGNED' | 'EXECUTING' | 'FINISHED' | 'FAILED'

export interface FleetOrder {
  id: string
  robotId: string | null
  fromNode: string
  toNode: string
  status: OrderStatus
  progress: number             // 0–100
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

// ── MQTT Log ───────────────────────────────────────────────
export type VDA5050Topic = 'state' | 'visualization' | 'order' | 'connection' | 'factsheet'

export interface MqttLogEntry {
  id: string
  robotId: string
  topic: VDA5050Topic
  timestamp: string
  payload?: unknown
}

// ── UI / Config ────────────────────────────────────────────
export interface MapViewConfig {
  showLM: boolean
  showAP: boolean
  showCH: boolean
  showZones: boolean
  showEdges: boolean
  showPaths: boolean
  showTheta: boolean
  nodeSize: number             // px
  labelSize: number            // px
  labelZoomThreshold: number   // show labels when zoom >= this
  robotSize: number            // px
  selectedModel: AgvModel
}

export interface FleetMetrics {
  activeCount: number
  chargingCount: number
  errorCount: number
  idleCount: number
  avgBattery: number
  throughputPerHour: number
  ordersCompleted: number
  utilization: number          // 0–1
  totalDistance: number        // meters (all robots, session)
}
