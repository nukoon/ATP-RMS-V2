import type { AgvModel, AgvStatus, VDA5050Topic } from '@/types'

// ── VDA5050 MQTT ──
export const VDA5050_VERSION = '2.0'
export const MQTT_BASE_TOPIC = 'uagv/v2'   // uagv/v2/{manufacturer}/{serial}/{topic}
export const MQTT_QOS = 1

export const VDA5050_TOPICS: VDA5050Topic[] = [
  'state', 'visualization', 'order', 'connection', 'factsheet'
]

// ── Map Rendering ──
export const MAP_COORD = {
  // Map Y-axis: +Y = North (up on screen)
  // Screen rotation from map theta: screenRot = PI/2 - theta_rad
  thetaToScreenRot: (deg: number) => Math.PI / 2 - (deg * Math.PI) / 180,
  calcTheta: (dx: number, dy: number) => Math.atan2(dy, dx) * (180 / Math.PI),
}

// ── AGV Models ──
export const AGV_MODELS: AgvModel[] = [
  'AM15', 'MP10S', 'AL02', 'APe15', 'AS15',
  'TP30', 'TP60', 'TT15', 'TT30', 'TT60',
]

// SVG asset path per model + status
export const AGV_ASSET_PATH = (model: AgvModel, status: AgvStatus) =>
  `/assets/agv/${model}/${model}_${status}.svg`

export const AGV_POSTER_PATH = (model: AgvModel) =>
  `/assets/agv/${model}/${model}_poster.png`

// ── Status Colors ──
export const STATUS_COLOR: Record<AgvStatus, string> = {
  EXECUTING:   '#16a34a',
  IDLE:        '#64748b',
  CHARGING:    '#f59e0b',
  ERROR:       '#dc2626',
  PAUSE:       '#7c8696',
  TRAFFIC:     '#ea7a00',
  UNAVAILABLE: '#b91c1c',
  UNKNOWN:     '#334155',
}

export const STATUS_LABEL: Record<AgvStatus, string> = {
  EXECUTING:   'Moving',
  IDLE:        'Idle',
  CHARGING:    'Charging',
  ERROR:       'Error',
  PAUSE:       'Paused',
  TRAFFIC:     'Traffic',
  UNAVAILABLE: 'Unavailable',
  UNKNOWN:     'Unknown',
}

// ── Default map view config ──
export const DEFAULT_MAP_CONFIG = {
  showLM: true,
  showAP: true,
  showCH: true,
  showEdges: true,
  showPaths: true,
  showTheta: false,
  showStorage: true,
  nodeSize: 1,
  labelSize: 12,
  labelZoomThreshold: 1.0,
  robotSize: 2.5,            // metres (true-to-scale footprint length)
  selectedModel: 'AM15' as AgvModel,
}
