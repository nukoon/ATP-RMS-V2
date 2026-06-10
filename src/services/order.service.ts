/**
 * order.service — builds a VDA5050 v2.0 Order message from a storage mission so
 * the same resolved action plan (liftUp / trayRotate / liftDown / …) that the
 * simulator runs can be published to a real robot over MQTT.
 *
 * The mission's `actions` snapshot is produced by the backend from each
 * storage's PICK/DROP bindings (server/index.js → resolveStageActions).
 */
import type { FleetMap, MapCurve } from '@/types'
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
 * Directed shortest path over the map graph — mirrors the simulator's Dijkstra
 * (`simulation.service`): edges are `map.curves` traversed sNode→eNode, cost is the
 * straight-line segment length. Returns the edge sequence start→goal, or null if
 * unreachable. This is what lets a real robot follow a valid node-by-node route
 * instead of being asked to teleport straight from pickup to dropoff.
 */
function routeEdges(map: FleetMap, start: string, goal: string): MapCurve[] | null {
  if (start === goal) return []
  const adj = new Map<string, MapCurve[]>()
  for (const c of map.curves) {
    const l = adj.get(c.sNode) ?? []
    l.push(c); adj.set(c.sNode, l)
  }
  const cost = (c: MapCurve) => Math.hypot(c.ex - c.sx, c.ey - c.sy) || 0.5
  const dist = new Map<string, number>([[start, 0]])
  const prev = new Map<string, MapCurve>()
  const seen = new Set<string>()
  const pq: { n: string; d: number }[] = [{ n: start, d: 0 }]
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d)
    const { n } = pq.shift()!
    if (n === goal) break
    if (seen.has(n)) continue
    seen.add(n)
    for (const e of adj.get(n) ?? []) {
      const nd = (dist.get(n) ?? Infinity) + cost(e)
      if (nd < (dist.get(e.eNode) ?? Infinity)) {
        dist.set(e.eNode, nd); prev.set(e.eNode, e); pq.push({ n: e.eNode, d: nd })
      }
    }
  }
  if (!prev.has(goal)) return null
  const path: MapCurve[] = []
  let cur = goal
  while (cur !== start) { const e = prev.get(cur)!; path.unshift(e); cur = e.sNode }
  return path
}

/**
 * Build a VDA5050 Order from pickup → dropoff. When the map graph connects them,
 * the order carries the FULL routed node/edge sequence (PICK actions on the first
 * node, DROP on the last) so RoboVDA/SEER follows real, individually-routable hops.
 * Falls back to a direct 2-node order (start → edge → end) when there is no map or
 * no route — the robot then self-plans, as before.
 */
export function buildVda5050Order(
  robotId: string,
  manufacturer: string,
  mission: Mission,
  map: FleetMap | null,
  fromNode?: string,   // the robot's current node — VDA5050 requires the order's FIRST
                       // node to be where the AGV is, so we route currentNode→pickup→dropoff
): VDA5050Order {
  const pickActions = (mission.actions || []).filter(a => a.stage === 'PICK').map(toVdaAction)
  const dropActions = (mission.actions || []).filter(a => a.stage === 'DROP').map(toVdaAction)

  const pos = (nodeId: string) => {
    const p = map?.points.find(pt => pt.id === nodeId)
    return p ? { x: p.x, y: p.y, theta: p.theta, mapId: 'map' } : undefined
  }

  const start = mission.startNode, end = mission.endNode
  // leg1: robot's current node → pickup (skipped when already at pickup / unknown);
  // leg2: pickup → dropoff. PICK actions land on the pickup node, DROP on the dropoff.
  const leg1 = map && fromNode && fromNode !== start ? routeEdges(map, fromNode, start) : []
  const leg2 = map ? routeEdges(map, start, end) : null

  let nodes: VDA5050Node[]
  let edges: VDA5050Edge[]
  if (leg1 !== null && leg2 && (leg1.length || leg2.length)) {
    const all = [...leg1, ...leg2]
    const pickIdx = leg1.length        // node index of the pickup (startNode)
    const dropIdx = all.length         // node index of the dropoff (last node)
    // node-id sequence with PICK on the pickup node, DROP on the dropoff node
    const seq = [{ id: all.length ? all[0].sNode : start, acts: pickIdx === 0 ? pickActions : [] as VDA5050Action[] }]
    all.forEach((c, i) => {
      const idx = i + 1
      seq.push({ id: c.eNode, acts: idx === pickIdx ? pickActions : idx === dropIdx ? dropActions : [] })
    })
    // Collapse pure corridor loops: if a nodeId repeats and the detour between has NO
    // actions, drop it. The repeated node has the SAME outgoing edge so the shortened
    // route stays map-valid; action-bearing detours (e.g. a branch pickup) are kept.
    // This prevents revisited nodes that wedge RoboVDA's order-queue consumer.
    for (let i = 0; i < seq.length; i++) {
      let j = seq.length - 1
      while (j > i && seq[j].id !== seq[i].id) j--
      if (j > i && !seq.slice(i + 1, j + 1).some(n => n.acts.length)) seq.splice(i + 1, j - i)
    }
    // VDA5050 sequencing: nodes get even ids (0,2,4…), edges the odd id between them.
    nodes = seq.map((n, i) => ({ nodeId: n.id, sequenceId: i * 2, released: true, nodePosition: pos(n.id), actions: n.acts }))
    edges = []
    for (let i = 1; i < seq.length; i++)
      edges.push({ edgeId: `${seq[i - 1].id}-${seq[i].id}`, sequenceId: i * 2 - 1, released: true,
        startNodeId: seq[i - 1].id, endNodeId: seq[i].id, actions: [] })
  } else {
    // no map / unreachable → direct 2-node order; the robot self-plans pickup→dropoff
    nodes = [
      { nodeId: start, sequenceId: 0, released: true, nodePosition: pos(start), actions: pickActions },
      { nodeId: end,   sequenceId: 2, released: true, nodePosition: pos(end),   actions: dropActions },
    ]
    edges = [
      { edgeId: `${start}-${end}`, sequenceId: 1, released: true,
        startNodeId: start, endNodeId: end, actions: [] },
    ]
  }

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

/**
 * Build a plain navigation Order from the robot's current node to a target node
 * (no pick/drop actions) — used for "go to Park" and auto-park. Returns null when
 * there's no map or no routable path (so the caller can skip sending).
 */
export function buildNavOrder(
  robotId: string,
  manufacturer: string,
  map: FleetMap | null,
  fromNode: string,
  toNode: string,
): VDA5050Order | null {
  if (!map || !fromNode || !toNode || fromNode === toNode) return null
  const route = routeEdges(map, fromNode, toNode)
  if (!route || !route.length) return null
  const pos = (id: string) => {
    const p = map.points.find(pt => pt.id === id)
    return p ? { x: p.x, y: p.y, theta: p.theta, mapId: 'map' } : undefined
  }
  const nodes: VDA5050Node[] = [{ nodeId: fromNode, sequenceId: 0, released: true, nodePosition: pos(fromNode), actions: [] }]
  const edges: VDA5050Edge[] = []
  route.forEach((c, i) => {
    edges.push({ edgeId: `${c.sNode}-${c.eNode}`, sequenceId: (i + 1) * 2 - 1, released: true, startNodeId: c.sNode, endNodeId: c.eNode, actions: [] })
    nodes.push({ nodeId: c.eNode, sequenceId: (i + 1) * 2, released: true, nodePosition: pos(c.eNode), actions: [] })
  })
  return {
    headerId: headerCounter++, timestamp: new Date().toISOString(), version: VDA5050_VERSION,
    manufacturer, serialNumber: robotId, orderId: `PARK-${uid()}`, orderUpdateId: 0, nodes, edges,
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
