/**
 * order.service — builds a VDA5050 v2.0 Order message from a storage mission so
 * the same resolved action plan (liftUp / trayRotate / liftDown / …) that the
 * simulator runs can be published to a real robot over MQTT.
 *
 * The mission's `actions` snapshot is produced by the backend from each
 * storage's PICK/DROP bindings (server/index.js → resolveStageActions).
 */
import type { FleetMap } from '@/types'
import type { VDA5050Order, VDA5050Node, VDA5050Edge, VDA5050Action } from '@/types'
import type { Mission, MissionAction } from '@/types/fleet'
import { VDA5050_VERSION } from '@/constants'

let headerCounter = 0
const uid = () => Math.random().toString(36).slice(2, 10)

function toVdaAction(a: MissionAction): VDA5050Action {
  return {
    actionType: a.actionType,
    actionId: uid(),
    blockingType: a.blockingType,
    actionDescription: a.description,
    actionParameters: (a.params || []).map(p => ({ key: p.key, value: p.value })),
  }
}

/**
 * Build a 2-node Order: pickup node (PICK actions) → edge → dropoff node
 * (DROP actions). Node positions come from the map; missing nodes are still
 * emitted (released) so a robot that knows the node id can resolve them.
 */
export function buildVda5050Order(
  robotId: string,
  manufacturer: string,
  mission: Mission,
  map: FleetMap | null,
): VDA5050Order {
  const pickActions = (mission.actions || []).filter(a => a.stage === 'PICK').map(toVdaAction)
  const dropActions = (mission.actions || []).filter(a => a.stage === 'DROP').map(toVdaAction)

  const pos = (nodeId: string) => {
    const p = map?.points.find(pt => pt.id === nodeId)
    return p ? { x: p.x, y: p.y, theta: p.theta, mapId: 'map' } : undefined
  }

  const nodes: VDA5050Node[] = [
    { nodeId: mission.startNode, sequenceId: 0, released: true, nodePosition: pos(mission.startNode), actions: pickActions },
    { nodeId: mission.endNode,   sequenceId: 2, released: true, nodePosition: pos(mission.endNode),   actions: dropActions },
  ]
  const edges: VDA5050Edge[] = [
    { edgeId: `${mission.startNode}-${mission.endNode}`, sequenceId: 1, released: true,
      startNodeId: mission.startNode, endNodeId: mission.endNode, actions: [] },
  ]

  return {
    headerId: headerCounter++,
    timestamp: new Date().toISOString(),
    version: VDA5050_VERSION,
    manufacturer,
    serialNumber: robotId,
    orderId: mission.missionNo || uid(),
    orderUpdateId: 0,
    nodes,
    edges,
  }
}

export interface InstantActionSpec {
  actionType: string
  blockingType?: 'NONE' | 'SOFT' | 'HARD'
  actionParameters?: { key: string; value: unknown }[]
}

/**
 * Build a VDA5050 v2.0 instantActions message (topic `…/instantActions`). Used for
 * out-of-order commands the AITEN-S / SEER RoboVDA gateway maps to RBK calls:
 * cancelOrder→CLEARTARGETLIST, startPause/stopPause→TASK_PAUSE/RESUME,
 * startCharging/stopCharging→SetDO (manual §5). v2.0 carries them under `actions`.
 */
export function buildInstantActions(
  robotId: string,
  manufacturer: string,
  actions: InstantActionSpec[],
) {
  return {
    headerId: headerCounter++,
    timestamp: new Date().toISOString(),
    version: VDA5050_VERSION,
    manufacturer,
    serialNumber: robotId,
    actions: actions.map(a => ({
      actionType: a.actionType,
      actionId: uid(),
      blockingType: a.blockingType ?? 'NONE',
      actionParameters: a.actionParameters ?? [],
    })),
  }
}
