// ============================================================
// VDA5050 brand presets — per-vendor topic scheme + manufacturer + the
// actionTypes that vendor's gateway implements. Selecting a brand in the Broker
// config pre-fills the topic prefix / manufacturer so the dashboard talks to a
// real robot on the right topics.
//
// Topic layout (VDA5050): {baseTopic}/{manufacturer}/{serialNumber}/{topic}
//   Aiten / SEER  → robot/v2/SEER/<serial>/<order|state|...>   (RoboVDA gateway)
//   Generic       → uagv/v2/<manufacturer>/<serial>/<...>      (VDA5050 default)
// Source: "VDA5050 AITEN-S User Manual" v1.0.1 (AITEN-S is built on the SEER
// controller; topics use robot/v2/SEER, configurable via the controller's
// config.ini [topic]/[mqtt] sections).
// ============================================================
import type { VdaBrandId } from '@/types/fleet'

export interface VdaBrand {
  id: VdaBrandId
  label: string
  baseTopic: string        // prefix incl. protocol version, e.g. robot/v2
  manufacturer: string     // default VDA5050 manufacturer segment
  defaultWsUrl: string
  actions: string[]        // VDA5050 actionTypes the brand's gateway supports
  notes: string            // operator guidance shown in the Broker tab
}

// Actions the AITEN-S / SEER RoboVDA gateway implements (manual §5).
const AITEN_ACTIONS = [
  'pick', 'drop', 'forklift', 'startCharging', 'stopCharging', 'initPosition',
  'cancelOrder', 'startPause', 'stopPause', 'setDO', 'startMusic', 'stopMusic',
  'detectObject', 'addError', 'motorCalib', 'goPGV',
]

export const VDA_BRANDS: Record<VdaBrandId, VdaBrand> = {
  aiten: {
    id: 'aiten',
    label: 'Aiten (AITEN-S)',
    baseTopic: 'robot/v2',
    manufacturer: 'AITEN',
    defaultWsUrl: 'ws://localhost:9001',
    actions: AITEN_ACTIONS,
    notes:
      'AITEN-S runs the RoboVDA gateway on the controller (web UI at http://<robot-ip>:5050). ' +
      'Topics: robot/v2/<manufacturer>/<serial>/<topic>. The controller speaks MQTT — set ' +
      'mqtt_transport=websockets (port 9001) in its config.ini, or bridge TCP 1883→WS, so the browser ' +
      'can connect. manufacturer (AITEN) + serialNumber must match the controller config.',
  },
  seer: {
    id: 'seer',
    label: 'SEER (SeerRobotics)',
    baseTopic: 'robot/v2',
    manufacturer: 'SEER',
    defaultWsUrl: 'ws://localhost:9001',
    actions: AITEN_ACTIONS,
    notes:
      'SEER RoboVDA gateway — same topic scheme as AITEN-S (robot/v2/<manufacturer>/<serial>). ' +
      'Adjust manufacturer / base topic to match your controller. (Refine with the SEER doc when available.)',
  },
  generic: {
    id: 'generic',
    label: 'Generic VDA5050',
    baseTopic: 'uagv/v2',
    manufacturer: 'ATP',
    defaultWsUrl: 'ws://localhost:9001',
    actions: ['pick', 'drop', 'startCharging', 'stopCharging', 'initPosition', 'cancelOrder', 'startPause', 'stopPause'],
    notes:
      'Standard VDA5050 v2.0 scheme: uagv/v2/<manufacturer>/<serial>/<topic>. Use for any compliant fleet/robot.',
  },
}

export const VDA_BRAND_LIST = Object.values(VDA_BRANDS)
