/**
 * SimulationService — dev-mode fleet driver (no MQTT broker required).
 *
 * Models a small real fleet: 2 AGVs that PARK at the map's charge nodes.
 * While idle they wait at their parking spot. When a mission is created we
 * dispatch the NEAREST free AGV (by shortest-path distance), route it node→
 * node over the DIRECTED edge graph (one-way edges are respected because we
 * only ever traverse an edge start→end), run the job, then send it home.
 *
 * Feeds synthetic VDA5050 state through the real store pipeline.
 */
import type { FleetMap, MapPoint, MapCurve, AgvModel, AgvStatus, VDA5050State, VDA5050Error } from '@/types'
import { useFleetStore } from '@/store/fleet.store'
import { useStorageStore } from '@/store/storage.store'
import { calcTheta } from '@/utils/canvas'
import { speedMaxOf } from '@/constants/agv-specs'
import { FLEET_ROSTER } from '@/constants/fleet-roster'
import type { MissionAction } from '@/types/fleet'

// PARKED → (mission) TO_PICKUP → AT_PICKUP (run PICK actions) → TO_DROPOFF →
// AT_DROPOFF (run DROP actions) → TO_HOME → PARKED
// TO_CHARGE: a PARK-homed bot driving to the nearest CHARGE dock when low.
type Phase = 'PARKED' | 'TO_PICKUP' | 'AT_PICKUP' | 'TO_DROPOFF' | 'AT_DROPOFF' | 'TO_HOME' | 'TO_CHARGE'

// Operator commands from the robot detail panel.
export type SimCommand = 'PAUSE' | 'RESUME' | 'CANCEL' | 'PARK' | 'CHARGE' | 'LEAVE' | 'RETURN'

interface SimBot {
  id: string
  model: AgvModel
  mps: number              // top speed m/s
  homeNode: string         // parking (charge) node id
  node: string             // node the bot currently sits on / departed from
  route: MapCurve[]        // remaining edges to traverse
  edge: MapCurve | null    // current edge
  t: number                // 0..1 along current edge
  phase: Phase
  missionId: string | null
  // storage transport
  pickupNode: string
  dropoffNode: string
  pickupStorageId: string | null
  dropoffStorageId: string | null
  actions: MissionAction[] // resolved PICK/DROP plan (snapshot)
  dwellUntil: number       // while AT_PICKUP/AT_DROPOFF: run actions until this ms
  battery: number
  status: AgvStatus
  paused: boolean
  left: boolean            // operator pulled it off the map (deadlock relief) until RETURN
  fault: { until: number; error: VDA5050Error } | null
  lowBatt: boolean
  yielding: boolean
  waitTicks: number        // consecutive ticks blocked by traffic (deadlock detection)
  jamAlarmed: boolean      // raised the "consider a traffic area" warning already
  pos: { x: number; y: number }
  theta: number
  lastLog: number
}

const ACTION_DWELL_MS = 2500   // time spent running PICK/DROP actions at a station

const TICK_MS = 100
const LOW_BATTERY = 20
const FAULT_CHANCE = 0.0004
const TRAFFIC_RADIUS = 3.0         // m: separation zone (geometric backstop)
const DEADLOCK_TICKS = 25          // ~2.5s blocked → try to reroute around the blocker
const uid = () => Math.random().toString(36).slice(2, 9)

// ── geometry ───────────────────────────────────────────────
function pointOnCurve(c: MapCurve, t: number): { x: number; y: number } {
  if (c.type === 'bezier' && c.cp.length >= 2) {
    const u = 1 - t
    const a = u*u*u, b = 3*u*u*t, d = 3*u*t*t, e = t*t*t
    return { x: a*c.sx + b*c.cp[0].x + d*c.cp[1].x + e*c.ex, y: a*c.sy + b*c.cp[0].y + d*c.cp[1].y + e*c.ey }
  }
  if (c.type === 'bezier' && c.cp.length === 1) {
    const u = 1 - t
    return { x: u*u*c.sx + 2*u*t*c.cp[0].x + t*t*c.ex, y: u*u*c.sy + 2*u*t*c.cp[0].y + t*t*c.ey }
  }
  return { x: c.sx + (c.ex - c.sx) * t, y: c.sy + (c.ey - c.sy) * t }
}

/**
 * Tangent heading (deg) of a curve at parameter t, using a fixed-width
 * sampling window so it never collapses to a zero-length vector at the
 * endpoints (which would snap the heading to 0° / East). Returns null when
 * the segment is degenerate, so callers keep the previous heading.
 */
function curveHeading(c: MapCurve, t: number): number | null {
  const ahead  = Math.min(1, t + 0.06)
  const behind = Math.max(0, ahead - 0.06)
  const pa = pointOnCurve(c, ahead)
  const pb = pointOnCurve(c, behind)
  const dx = pa.x - pb.x, dy = pa.y - pb.y
  if (dx * dx + dy * dy < 1e-6) return null
  return calcTheta(dx, dy)
}

/** Ease `cur` toward `target` along the shortest arc (degrees). */
function smoothAngleDeg(cur: number, target: number, f: number): number {
  const d = ((target - cur + 540) % 360) - 180
  return cur + d * f
}

/**
 * Body heading (deg) on edge `e` at param `t`. On REVERSE segments the robot
 * drives backwards, so its body faces 180° from the direction of travel — the
 * robot keeps its nose pointed the same way and backs along the path.
 */
function bodyFacing(e: MapCurve, t: number): number | null {
  const h = curveHeading(e, t)
  return h === null ? null : (e.reverse ? (h + 180) % 360 : h)
}

function curveLength(c: MapCurve): number {
  let len = 0, prev = pointOnCurve(c, 0)
  for (let i = 1; i <= 10; i++) { const p = pointOnCurve(c, i / 10); len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p }
  return len || 0.5
}

export class SimulationService {
  private bots: SimBot[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private nodes = new Map<string, MapPoint>()
  /** directed adjacency: nodeId → outgoing edges */
  private adj = new Map<string, MapCurve[]>()
  private edgeLen = new Map<string, number>()
  /** traffic reservations: nodeId → botId currently occupying / driving toward it */
  private reserved = new Map<string, string>()
  /** node ids that can recharge a robot (CHARGE docks, or fallback Charge nodes) */
  private chargeNodes = new Set<string>()
  /** undirected neighbour set per node — junctions have ≠2 neighbours */
  private neighbors = new Map<string, Set<string>>()
  /** directed edge pairs "a>b" present, to detect two-way (bidirectional) lanes */
  private dirPairs = new Set<string>()
  /** operator-defined mutual-exclusion zones (loaded from the DB on start) */
  private zones: { id: string; name: string; nodes: Set<string>; capacity: number }[] = []

  get running() { return this.timer !== null }

  // ── graph ────────────────────────────────────────────────
  private buildGraph(map: FleetMap) {
    this.nodes = new Map(map.points.map(p => [p.id, p]))
    this.adj.clear(); this.edgeLen.clear(); this.neighbors.clear(); this.dirPairs.clear()
    for (const c of map.curves) {
      const list = this.adj.get(c.sNode) ?? []
      list.push(c); this.adj.set(c.sNode, list)
      this.edgeLen.set(c.id, curveLength(c))
      this.dirPairs.add(`${c.sNode}>${c.eNode}`)
      for (const [a, b] of [[c.sNode, c.eNode], [c.eNode, c.sNode]]) {
        const s = this.neighbors.get(a) ?? new Set<string>()
        s.add(b); this.neighbors.set(a, s)
      }
    }
  }

  /** A junction (safe to wait at): a branch (≥3 neighbours) or a dead-end (1). */
  private isJunction(nodeId: string): boolean {
    const n = this.neighbors.get(nodeId)?.size ?? 0
    return n !== 2
  }

  /** True if the lane this edge runs along is bidirectional (head-on possible). */
  private edgeTwoWay(e: MapCurve): boolean {
    return this.dirPairs.has(`${e.eNode}>${e.sNode}`)
  }

  /**
   * Nodes a bot must hold to safely enter its current edge: the target node,
   * plus — on a TWO-WAY lane — every following corridor node up to and
   * including the next junction (so an oncoming AGV can't enter the run).
   * One-way lanes only need the single target (same-direction following is OK).
   */
  private runAhead(b: SimBot): string[] {
    if (!b.edge) return []
    const out = [b.edge.eNode]
    if (!this.edgeTwoWay(b.edge)) return out          // one-way: just the next node
    if (this.isJunction(b.edge.eNode)) return out      // target already a junction
    for (let i = 1; i < b.route.length; i++) {
      const n = b.route[i].eNode
      out.push(n)
      if (this.isJunction(n)) break
    }
    return out
  }

  /** Dijkstra over directed edges: returns the edge sequence start→goal, or null. */
  private shortestPath(start: string, goal: string): MapCurve[] | null {
    if (start === goal) return []
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
      for (const e of this.adj.get(n) ?? []) {
        const nd = (dist.get(n) ?? Infinity) + (this.edgeLen.get(e.id) ?? 1)
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

  private pathCost(path: MapCurve[]): number {
    return path.reduce((s, e) => s + (this.edgeLen.get(e.id) ?? 1), 0)
  }

  /** Dijkstra that refuses to route THROUGH a set of blocked nodes (goal allowed). */
  private shortestPathAvoiding(start: string, goal: string, blocked: Set<string>): MapCurve[] | null {
    if (start === goal) return []
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
      for (const e of this.adj.get(n) ?? []) {
        if (blocked.has(e.eNode) && e.eNode !== goal) continue
        const nd = (dist.get(n) ?? Infinity) + (this.edgeLen.get(e.id) ?? 1)
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

  /** Nearest CHARGE node reachable from `from` (by path cost), or null. */
  private nearestChargeNode(from: string): string | null {
    let best: { node: string; cost: number } | null = null
    for (const node of this.chargeNodes) {
      const path = this.shortestPath(from, node)
      if (!path) continue
      const cost = this.pathCost(path)
      if (!best || cost < best.cost) best = { node, cost }
    }
    return best?.node ?? null
  }

  nodeById(id: string): MapPoint | undefined { return this.nodes.get(id) }

  /**
   * Heading (deg) for a robot parked at `nodeId`. Charge-node theta in the
   * ATP map is a sentinel (999), so we align to the connecting lane via
   * `bodyFacing` (which respects REVERSE segments). Prefer the incoming
   * edge (the body heading on arrival), else an outgoing edge at its start,
   * else a sane map theta, else North.
   */
  private parkHeading(nodeId: string): number {
    for (const list of this.adj.values())
      for (const e of list)
        if (e.eNode === nodeId) { const h = bodyFacing(e, 1); if (h !== null) return h }
    const out = this.adj.get(nodeId)
    if (out && out.length) { const h = bodyFacing(out[0], 0); if (h !== null) return h }
    const t = this.nodeById(nodeId)?.theta
    return (t != null && Math.abs(t) <= 360) ? t : 90
  }

  // ── lifecycle ────────────────────────────────────────────
  start(map: FleetMap) {
    if (this.timer) return
    if (!map.curves.length) { console.warn('[SIM] map has no edges'); return }
    this.buildGraph(map)
    this.reserved.clear()

    // Operator-defined mutual-exclusion zones (only nodes present on this map).
    this.zones = useStorageStore.getState().trafficAreas
      .filter(z => z.enabled)
      .map(z => ({ id: z.id, name: z.name, capacity: Math.max(1, z.capacity || 1), nodes: new Set(z.nodeIds.filter(n => this.nodes.has(n))) }))
      .filter(z => z.nodes.size > 0)

    // Docks (DB-backed parking/charging points) drive where robots live and
    // recharge; fall back to the map's Charge nodes when none are configured.
    const docks = useStorageStore.getState().docks.filter(d => d.enabled && this.nodes.has(d.nodeId))
    const chargeNodeFallback = map.points.filter(p => p.cls === 'Charge')

    // CHARGE-able nodes: CHARGE docks (or every Charge node if no docks at all).
    this.chargeNodes = new Set(
      docks.length ? docks.filter(d => d.type === 'CHARGE').map(d => d.nodeId)
                   : chargeNodeFallback.map(p => p.id),
    )
    if (this.chargeNodes.size === 0 && chargeNodeFallback.length)
      for (const p of chargeNodeFallback) this.chargeNodes.add(p.id)

    // Decide the fleet: a bot per dock that BINDS a robot id; otherwise the
    // default 2-robot demo fleet, homed at docks / charge nodes / first nodes.
    const bound = docks.filter(d => d.agvId)
    let plan: { id: string; model: AgvModel; color: string; homeNode: string }[]
    if (bound.length) {
      plan = bound.map(d => {
        const f = FLEET_ROSTER.find(r => r.id === d.agvId) ?? FLEET_ROSTER[0]
        return { id: d.agvId!, model: f.model, color: f.color, homeNode: d.nodeId }
      })
    } else {
      const homes = (docks.length ? docks.map(d => d.nodeId)
                    : chargeNodeFallback.length >= 2 ? chargeNodeFallback.map(p => p.id)
                    : map.points.map(p => p.id))
      plan = FLEET_ROSTER.slice(0, 2).map((f, i) => ({
        id: f.id, model: f.model, color: f.color, homeNode: homes[i] ?? homes[0],
      }))
    }

    const store = useFleetStore.getState()
    this.bots = plan.map((p) => {
      const home = this.nodes.get(p.homeNode) ?? map.points[0]
      const bot: SimBot = {
        id: p.id, model: p.model, mps: speedMaxOf(p.model),
        homeNode: home.id, node: home.id,
        route: [], edge: null, t: 0, phase: 'PARKED', missionId: null,
        pickupNode: '', dropoffNode: '', pickupStorageId: null, dropoffStorageId: null,
        actions: [], dwellUntil: 0,
        battery: 70 + Math.random() * 30, status: 'IDLE',
        paused: false, left: false, fault: null, lowBatt: false, yielding: false, waitTicks: 0, jamAlarmed: false,
        pos: { x: home.x, y: home.y }, theta: this.parkHeading(home.id), lastLog: 0,
      }
      this.reserved.set(home.id, bot.id)   // parked bots hold their node
      store.upsertRobot({
        id: p.id, model: p.model, color: p.color, status: 'IDLE',
        pose: { x: home.x, y: home.y, theta: bot.theta, mapId: 'sim' },
        battery: { batteryCharge: bot.battery, charging: false },
        velocity: { vx: 0, vy: 0, omega: 0 },
        currentNodeId: home.id, currentOrderId: null, path: [], pathIndex: 0,
        errors: [], totalDistance: 0, lastUpdated: Date.now(), mqttConnected: true,
      })
      return bot
    })

    store.setMqttConnected(true)
    this.timer = setInterval(() => this.tick(), TICK_MS)
    console.log('[SIM] started', this.bots.length, 'AGVs homed at', this.bots.map(b => b.homeNode).join(', '))
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.reserved.clear()
    useFleetStore.getState().setMqttConnected(false)
  }

  command(robotId: string, action: SimCommand) {
    const b = this.bots.find(x => x.id === robotId)
    if (!b) return
    const store = useFleetStore.getState()
    switch (action) {
      case 'PAUSE':  b.paused = true;  b.status = 'PAUSE'; break
      case 'RESUME': b.paused = false; b.left = false; b.status = b.edge ? 'EXECUTING' : 'IDLE'; break
      case 'CANCEL':
        b.paused = false
        if (b.missionId) { store.cancelMission(b.missionId); b.missionId = null }
        store.setRobotCarrying(b.id, false)
        this.sendHome(b)
        break
      case 'PARK':            // drop the job back in the queue and return to the park dock
        b.paused = false; b.left = false
        this.requeueMission(store, b)
        this.sendHome(b)
        break
      case 'CHARGE': {        // requeue the job and drive to the nearest charge dock
        b.paused = false; b.left = false
        this.requeueMission(store, b)
        this.releaseReservationsExcept(b, new Set([b.node]))
        const cn = this.nearestChargeNode(b.node)
        const path = cn ? this.shortestPath(b.node, cn) : null
        if (path && path.length) { b.route = path; b.edge = path[0]; b.t = 0; b.phase = 'TO_CHARGE'; b.status = 'EXECUTING' }
        else { b.route = []; b.edge = null; b.phase = 'PARKED'; b.status = 'CHARGING' }   // already on a charge node
        break
      }
      case 'LEAVE':           // pull off the map: free ALL nodes so another AGV can pass a real deadlock
        b.paused = false
        this.requeueMission(store, b)
        this.releaseReservationsExcept(b, new Set())
        b.left = true; b.edge = null; b.route = []; b.phase = 'PARKED'; b.status = 'UNAVAILABLE'
        break
      case 'RETURN': {        // bring it back onto the map at its home dock (if free)
        b.left = false
        const home = this.nodes.get(b.homeNode)
        const owner = home ? this.reserved.get(home.id) : undefined
        if (home && (owner === undefined || owner === b.id)) {
          b.node = home.id; b.pos = { x: home.x, y: home.y }; b.theta = this.parkHeading(home.id)
          this.reserved.set(home.id, b.id)
        }
        b.edge = null; b.route = []; b.phase = 'PARKED'; b.status = 'IDLE'
        break
      }
    }
  }

  // Put a bot's in-flight mission back on the queue (re-dispatchable) and clear
  // its carry/station state — used by PARK / CHARGE / LEAVE so the job isn't lost.
  private requeueMission(store: ReturnType<typeof useFleetStore.getState>, b: SimBot) {
    if (b.missionId) { store.updateMission(b.missionId, { status: 'PENDING', agvId: null, progress: 0 }); b.missionId = null }
    b.pickupStorageId = null; b.dropoffStorageId = null; b.actions = []
    store.setRobotCarrying(b.id, false)
  }

  // ── dispatch: nearest free bot by route to the PICKUP node ──
  private dispatch(store: ReturnType<typeof useFleetStore.getState>) {
    // Highest priority first (1 = most urgent .. 9 = least); ties broken by age
    // (oldest createdAt first, FIFO) so an "urgent" mission jumps the queue.
    const pending = store.missions
      .filter(m => m.status === 'PENDING')
      .sort((a, b) => (a.priority - b.priority) || (a.createdAt < b.createdAt ? -1 : 1))

    // Locations (storages + nodes) already reserved by an in-flight job. A
    // pending mission whose pickup/dropoff collides with these is NOT executed —
    // it stays PENDING (queued) until the location frees. Accumulates as we
    // dispatch so two pendings can't grab the same point in one pass.
    const busyStore = new Set<string>()
    const busyNode = new Set<string>()
    for (const m of store.missions) {
      if (m.status !== 'EXECUTING' && m.status !== 'ASSIGNED') continue
      if (m.pickupStorageId)  busyStore.add(m.pickupStorageId)
      if (m.dropoffStorageId) busyStore.add(m.dropoffStorageId)
      busyNode.add(m.startNode); busyNode.add(m.endNode)
    }

    for (const m of pending) {
      // pickup = startNode, dropoff = endNode (both resolved from storages)
      const pickup = this.nodeById(m.startNode)
      const dropoff = this.nodeById(m.endNode)
      if (!pickup || !dropoff) { store.updateMission(m.id, { status: 'FAILED' }); continue }
      // queue behind any job already using this pickup/dropoff location
      const occupied =
        (m.pickupStorageId && busyStore.has(m.pickupStorageId)) ||
        (m.dropoffStorageId && busyStore.has(m.dropoffStorageId)) ||
        busyNode.has(m.startNode) || busyNode.has(m.endNode)
      if (occupied) continue  // leave PENDING — wait for the location to free
      // Free = idle parked bots AND bots already heading home (no job, charged
      // enough). A returning bot is grabbed mid-trip without reversing: it
      // finishes the edge it's on, then turns toward the pickup.
      const free = this.bots.filter(b =>
        (b.phase === 'PARKED' || b.phase === 'TO_HOME') && !b.missionId && !b.fault && b.battery > LOW_BATTERY)
      if (!free.length) return  // all busy → leave PENDING for later

      // choose the free bot with the cheapest route to the pickup, measured from
      // the node it will next reach (its current edge's end if mid-trip).
      let pick: { b: SimBot; from: string; path: MapCurve[]; cost: number } | null = null
      for (const b of free) {
        const from = b.edge ? b.edge.eNode : b.node
        const path = this.shortestPath(from, m.startNode)
        if (!path) continue
        const remain = b.edge ? (this.edgeLen.get(b.edge.id) ?? 0) * (1 - b.t) : 0
        const cost = this.pathCost(path) + remain
        if (!pick || cost < pick.cost) pick = { b, from, path, cost }
      }
      if (!pick) { continue } // no reachable bot right now

      const { b, from, path } = pick
      // drop the now-stale home-route reservations, keep what we're physically on
      this.releaseReservationsExcept(b, new Set([b.node, from]))
      if (b.edge) {
        b.route = [b.edge, ...path]   // finish current edge first (no reversing), then divert
      } else {
        b.route = path
        b.edge = path[0] ?? null
        b.t = 0
      }
      b.phase = 'TO_PICKUP'
      b.missionId = m.id
      b.pickupNode = m.startNode
      b.dropoffNode = m.endNode
      b.pickupStorageId = m.pickupStorageId ?? null
      b.dropoffStorageId = m.dropoffStorageId ?? null
      b.actions = m.actions ?? []
      b.status = 'EXECUTING'
      const ts = new Date().toISOString()
      store.updateMission(m.id, { status: 'EXECUTING', agvId: b.id, assignedAt: ts, startedAt: ts })
      // mark this job's locations busy so other pendings queue behind it
      if (m.pickupStorageId)  busyStore.add(m.pickupStorageId)
      if (m.dropoffStorageId) busyStore.add(m.dropoffStorageId)
      busyNode.add(m.startNode); busyNode.add(m.endNode)
      // if the pickup is where the bot already sits, arrive immediately next tick
      if (!b.edge) this.onArrive(store, b)
    }
  }

  private sendHome(b: SimBot) {
    const path = this.shortestPath(b.node, b.homeNode)
    if (path && path.length) { b.route = path; b.edge = path[0]; b.t = 0; b.phase = 'TO_HOME'; b.status = 'EXECUTING' }
    else { b.route = []; b.edge = null; b.phase = 'PARKED'; b.status = b.battery < LOW_BATTERY ? 'CHARGING' : 'IDLE' }
  }

  // ── traffic: node reservation + deadlock reroute ─────────
  // Higher = wins arbitration. On-job > heading-to-charge > returning home >
  // idle; ties broken by fleet index so the order is deterministic.
  private priority(b: SimBot): number {
    const base =
      b.phase === 'TO_PICKUP' || b.phase === 'TO_DROPOFF' || b.phase === 'AT_PICKUP' || b.phase === 'AT_DROPOFF' ? 3000 :
      b.phase === 'TO_CHARGE' ? 2000 :
      b.phase === 'TO_HOME'   ? 1000 : 0
    return base - this.bots.indexOf(b)
  }

  /** Geometric backstop: a higher-priority bot physically sits in our path. */
  private blockedByProximity(b: SimBot): boolean {
    if (!b.edge) return false
    const ahead = pointOnCurve(b.edge, Math.min(1, b.t + 0.12))
    for (const o of this.bots) {
      if (o === b || o.phase === 'PARKED') continue
      const d = Math.hypot(ahead.x - o.pos.x, ahead.y - o.pos.y)
      if (d < TRAFFIC_RADIUS && this.priority(o) > this.priority(b)) return true
    }
    return false
  }

  /** The node a bot is ultimately routing toward, for deadlock rerouting. */
  private goalNode(b: SimBot): string | null {
    switch (b.phase) {
      case 'TO_PICKUP':  return b.pickupNode || null
      case 'TO_DROPOFF': return b.dropoffNode || null
      case 'TO_HOME':    return b.homeNode || null
      case 'TO_CHARGE':  return b.route.length ? b.route[b.route.length - 1].eNode : null
      default:           return null
    }
  }

  // ── run + zone reservation (no reversing) ────────────────
  // Distinct bots currently inside `zone` (by reserved node ownership), minus b.
  private zoneOccupants(zone: { nodes: Set<string> }, excludeBotId: string): Set<string> {
    const set = new Set<string>()
    for (const n of zone.nodes) { const o = this.reserved.get(n); if (o && o !== excludeBotId) set.add(o) }
    return set
  }

  /** Would entering `run` exceed any traffic-area capacity bot b isn't already in? */
  private zonesAllow(b: SimBot, run: string[]): boolean {
    for (const zone of this.zones) {
      if (!run.some(n => zone.nodes.has(n))) continue            // run doesn't enter this zone
      if (this.zoneOccupants(zone, b.id).size >= zone.capacity) return false
    }
    return true
  }

  /**
   * Try to claim the whole run ahead (target + two-way corridor to the next
   * junction) plus honour traffic-area capacity. All-or-nothing: returns false
   * (claiming nothing) if any node is taken or a zone is full, so the bot WAITS
   * where it is — which is a junction / outside the zone, i.e. never reversing.
   */
  private tryReserveRun(b: SimBot): boolean {
    const run = this.runAhead(b)
    if (!run.length) return true
    for (const n of run) { const o = this.reserved.get(n); if (o !== undefined && o !== b.id) return false }
    if (!this.zonesAllow(b, run)) return false
    for (const n of run) this.reserved.set(n, b.id)
    return true
  }

  /** Drop all of bot b's reservations except the given nodes (used on re-route). */
  private releaseReservationsExcept(b: SimBot, keep: Set<string>) {
    for (const [node, owner] of this.reserved)
      if (owner === b.id && !keep.has(node)) this.reserved.delete(node)
  }

  /**
   * Blocked too long and we never reverse: try a forward detour around the
   * blocked node; if there's genuinely no other way, raise a one-shot warning
   * so the operator can define a Traffic Area to sequence the spot.
   */
  private resolveDeadlock(store: ReturnType<typeof useFleetStore.getState>, b: SimBot, target: string) {
    if (b.waitTicks < DEADLOCK_TICKS) return
    const goal = this.goalNode(b)
    if (goal) {
      const alt = this.shortestPathAvoiding(b.node, goal, new Set([target]))
      if (alt && alt.length) { b.route = alt; b.edge = alt[0]; b.t = 0; b.waitTicks = 0; return }
    }
    if (b.waitTicks >= DEADLOCK_TICKS * 4 && !b.jamAlarmed) {
      b.jamAlarmed = true
      store.pushAlarm({ id: uid(), agvId: b.id, code: 'TRAFFIC_JAM', level: 'WARNING',
        message: `${b.id} blocked at ${target} — consider adding a Traffic Area`, status: 'ACTIVE', createdAt: new Date().toISOString() })
    }
  }

  // ── main loop ────────────────────────────────────────────
  private tick() {
    const store = useFleetStore.getState()
    const now = Date.now()
    this.dispatch(store)

    // Process bots high-priority first so reservation claims arbitrate cleanly.
    const order = [...this.bots].sort((a, b) => this.priority(b) - this.priority(a))
    for (const b of order) {
      // fault lifecycle
      if (b.fault && now >= b.fault.until) { this.resolveAlarmFor(store, b.id, b.fault.error.errorType); b.fault = null; b.status = b.edge ? 'EXECUTING' : 'IDLE' }
      if (!b.fault && !b.paused && b.status === 'EXECUTING' && Math.random() < FAULT_CHANCE) this.raiseFault(store, b, now)

      if (b.paused || b.fault) { this.report(store, b, now); continue }

      // pulled off the map (deadlock relief): hold ALL nodes free so others pass,
      // sit out until the operator hits RETURN
      if (b.left) { this.releaseReservationsExcept(b, new Set()); b.status = 'UNAVAILABLE'; this.report(store, b, now); continue }

      // parked: charge only on a CHARGE node; a PARK-homed bot that runs low
      // drives to the nearest charge node, tops up, then returns home.
      if (b.phase === 'PARKED') {
        const onCharge = this.chargeNodes.has(b.node)
        if (onCharge) {
          b.battery = Math.min(100, b.battery + 0.15)
          b.status = b.battery < 99 ? 'CHARGING' : 'IDLE'
          if (b.battery >= 99 && b.node !== b.homeNode) this.sendHome(b)  // done charging → go park
        } else if (b.battery < LOW_BATTERY) {
          const cn = this.nearestChargeNode(b.node)
          const path = cn ? this.shortestPath(b.node, cn) : null
          if (path && path.length) { b.route = path; b.edge = path[0]; b.t = 0; b.phase = 'TO_CHARGE'; b.status = 'EXECUTING' }
          else b.status = 'IDLE'
        } else {
          b.status = 'IDLE'
        }
        this.report(store, b, now)
        continue
      }

      // running PICK/DROP actions at a station: dwell, then move to next leg
      if (b.phase === 'AT_PICKUP' || b.phase === 'AT_DROPOFF') {
        b.status = 'EXECUTING'
        if (now >= b.dwellUntil) this.afterDwell(store, b)
        this.report(store, b, now)
        continue
      }

      // advance along current edge, gated by run + traffic-area reservations
      if (b.edge) {
        const target = b.edge.eNode
        const haveRun = this.reserved.get(target) === b.id   // already hold the run ahead
        // A bot waits in place (a junction / outside any full zone) if it can't
        // claim the run ahead or a higher-priority bot is physically in the way.
        // It NEVER reverses; resolveDeadlock only detours forward or warns.
        if (this.blockedByProximity(b) || (!haveRun && !this.tryReserveRun(b))) {
          b.status = 'TRAFFIC'; b.yielding = true; b.waitTicks++
          this.resolveDeadlock(store, b, target)
          this.report(store, b, now)
          continue
        }
        b.yielding = false; b.waitTicks = 0; b.status = 'EXECUTING'
        if (b.jamAlarmed) { this.resolveAlarmFor(store, b.id, 'TRAFFIC_JAM'); b.jamAlarmed = false }

        const len = this.edgeLen.get(b.edge.id) ?? 1
        b.t += (b.mps * (TICK_MS / 1000)) / len
        const p = pointOnCurve(b.edge, Math.min(1, b.t))
        const heading = bodyFacing(b.edge, b.t)
        // Ease toward the body heading so turns are smooth, the heading never
        // snaps to East at edge ends (degenerate window → keep current), and
        // REVERSE segments are driven backwards (nose stays put).
        if (heading !== null) b.theta = smoothAngleDeg(b.theta, heading, 0.3)
        b.battery = Math.max(2, b.battery - 0.02)
        b.pos = p

        if (b.t >= 1) {
          // arrived at this node → release only the node we LEFT (free the lane
          // behind us); we keep everything still ahead in the locked run.
          const left = b.node
          b.node = target
          if (left !== target && this.reserved.get(left) === b.id) this.reserved.delete(left)
          if (b.edge) store.bumpEdgeHeat(b.edge.id)   // traffic density for the heatmap
          b.route.shift()
          b.edge = b.route[0] ?? null
          b.t = 0
          if (!b.edge) this.onArrive(store, b)
        }
      } else {
        this.onArrive(store, b)
      }

      // low-battery alarm
      if (b.battery < LOW_BATTERY && !b.lowBatt) {
        b.lowBatt = true
        store.pushAlarm({ id: uid(), agvId: b.id, code: 'BAT_LOW', level: 'WARNING', message: `Battery low (${Math.round(b.battery)}%)`, status: 'ACTIVE', createdAt: new Date().toISOString() })
      } else if (b.battery >= LOW_BATTERY && b.lowBatt) { b.lowBatt = false; this.resolveAlarmFor(store, b.id, 'BAT_LOW') }

      this.report(store, b, now)
    }
    store.setMqttLatency(20 + Math.round(Math.random() * 30))
  }

  /** Reached the end of a route. */
  private onArrive(store: ReturnType<typeof useFleetStore.getState>, b: SimBot) {
    const now = Date.now()
    if (b.phase === 'TO_PICKUP') {
      // arrived at pickup → run PICK actions (dwell), then head to dropoff
      b.phase = 'AT_PICKUP'
      b.dwellUntil = now + ACTION_DWELL_MS
      this.runStageActions(store, b, 'PICK')
    } else if (b.phase === 'TO_DROPOFF') {
      // arrived at dropoff → run DROP actions (dwell), finish handled afterDwell
      b.phase = 'AT_DROPOFF'
      b.dwellUntil = now + ACTION_DWELL_MS
      this.runStageActions(store, b, 'DROP')
    } else { // TO_HOME / TO_CHARGE / stray → settle on the node we arrived at
      b.phase = 'PARKED'
      const node = this.nodeById(b.node)
      if (node) { b.pos = { x: node.x, y: node.y }; b.theta = this.parkHeading(node.id) }
      b.status = this.chargeNodes.has(b.node) && b.battery < 99 ? 'CHARGING' : 'IDLE'
    }
  }

  /** Dwell finished at a station → advance to the next leg of the mission. */
  private afterDwell(store: ReturnType<typeof useFleetStore.getState>, b: SimBot) {
    if (b.phase === 'AT_PICKUP') {
      // load picked up → now carrying; the pickup storage empties right away so
      // the box leaves the rack and rides on the forks only (not in both places)
      store.setRobotCarrying(b.id, true)
      if (b.pickupStorageId) useStorageStore.getState().setState(b.pickupStorageId, 'EMPTY').catch(() => {})
      const path = this.shortestPath(b.node, b.dropoffNode)
      if (path) { b.route = path; b.edge = path[0] ?? null; b.t = 0; b.phase = 'TO_DROPOFF'; b.status = 'EXECUTING'; if (!b.edge) this.onArrive(store, b) }
      else { if (b.missionId) store.updateMission(b.missionId, { status: 'FAILED' }); b.missionId = null; store.setRobotCarrying(b.id, false); this.sendHome(b) }
    } else if (b.phase === 'AT_DROPOFF') {
      // delivery complete → drop the load, fill the dropoff (pickup already
      // emptied at pick time), finish, go home
      store.setRobotCarrying(b.id, false)
      if (b.dropoffStorageId) useStorageStore.getState().setState(b.dropoffStorageId, 'FULL').catch(() => {})
      if (b.missionId) { store.updateMission(b.missionId, { status: 'FINISHED', progress: 100, finishedAt: new Date().toISOString() }); store.recordOrderCompleted() }
      b.missionId = null; b.actions = []; b.pickupStorageId = null; b.dropoffStorageId = null
      this.sendHome(b)
    }
  }

  /** Emit the PICK/DROP VDA5050 actions for a bot to the MQTT stream log. */
  private runStageActions(store: ReturnType<typeof useFleetStore.getState>, b: SimBot, stage: 'PICK' | 'DROP') {
    const acts = b.actions.filter(a => a.stage === stage)
    if (!acts.length) return
    store.pushMqttLog({
      id: uid(), robotId: b.id, topic: 'order', timestamp: new Date().toISOString(),
      payload: { node: stage === 'PICK' ? b.pickupNode : b.dropoffNode, actions: acts.map(a => ({ actionType: a.actionType, blockingType: a.blockingType, params: a.params })) },
    })
  }

  private raiseFault(store: ReturnType<typeof useFleetStore.getState>, b: SimBot, now: number) {
    const faults = [
      { type: 'OBSTACLE_DETECTED', desc: 'Obstacle blocking path' },
      { type: 'LOCALIZATION_LOST', desc: 'Localization score below threshold' },
      { type: 'MOTOR_OVERCURRENT',  desc: 'Drive motor over-current' },
    ]
    const f = faults[Math.floor(Math.random() * faults.length)]
    const error: VDA5050Error = { errorType: f.type, errorLevel: 'FATAL', errorDescription: f.desc, errorReferences: [] }
    b.fault = { until: now + 3000 + Math.random() * 4000, error }
    b.status = 'ERROR'
    store.pushAlarm({ id: uid(), agvId: b.id, code: f.type, level: 'ERROR', message: f.desc, status: 'ACTIVE', createdAt: new Date().toISOString() })
  }

  private resolveAlarmFor(store: ReturnType<typeof useFleetStore.getState>, agvId: string, code: string) {
    const a = store.alarms.find(x => x.status === 'ACTIVE' && x.agvId === agvId && x.code === code)
    if (a) store.resolveAlarm(a.id)
  }

  private report(store: ReturnType<typeof useFleetStore.getState>, b: SimBot, now: number) {
    // live mission progress across the pickup→dropoff legs (best-effort)
    if (b.missionId) {
      const legPct = () => { const rem = b.route.length, tot = rem + 1; return 1 - rem / Math.max(tot, 1) }
      let pct = 0
      if (b.phase === 'TO_PICKUP')       pct = 5 + legPct() * 40       // 5..45
      else if (b.phase === 'AT_PICKUP')  pct = 50
      else if (b.phase === 'TO_DROPOFF') pct = 50 + legPct() * 45      // 50..95
      else if (b.phase === 'AT_DROPOFF') pct = 98
      if (pct) store.updateMission(b.missionId, { progress: Math.max(1, Math.min(99, Math.round(pct))) })
    }

    const state: VDA5050State = {
      headerId: now, timestamp: new Date().toISOString(), version: '2.0.0',
      manufacturer: 'ATP', serialNumber: b.id,
      orderId: b.missionId ?? '', orderUpdateId: 0,
      lastNodeId: b.node, lastNodeSequenceId: 0,
      driving: b.status === 'EXECUTING',
      agvPosition: { x: b.pos.x, y: b.pos.y, theta: b.theta, mapId: 'sim' },
      velocity: { vx: b.status === 'EXECUTING' ? b.mps : 0, vy: 0, omega: 0 },
      batteryState: { batteryCharge: Math.round(b.battery), charging: b.status === 'CHARGING' },
      operatingMode: b.status,
      errors: b.fault ? [b.fault.error] : [],
      warnings: [],
      safetyState: { fieldViolation: false, eStop: 'NONE' },
    }
    store.updateFromVDA5050(b.id, state)

    // publish the upcoming route (current node → remaining edge ends) so the
    // map can highlight the path the robot is about to drive
    const path = b.edge ? [b.node, ...b.route.map(e => e.eNode)] : []
    store.setRobotPath(b.id, path)

    if (now - b.lastLog > 1000) {
      b.lastLog = now
      store.pushMqttLog({ id: `${b.id}-${now}`, robotId: b.id, topic: 'state', timestamp: new Date().toLocaleTimeString('en-GB') })
    }
  }
}

export const simulationService = new SimulationService()
