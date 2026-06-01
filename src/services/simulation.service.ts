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
import { calcTheta } from '@/utils/canvas'
import { speedMaxOf } from '@/constants/agv-specs'
import { FLEET_ROSTER } from '@/constants/fleet-roster'

type Phase = 'PARKED' | 'TO_TARGET' | 'TO_HOME'

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
  battery: number
  status: AgvStatus
  paused: boolean
  fault: { until: number; error: VDA5050Error } | null
  lowBatt: boolean
  yielding: boolean
  pos: { x: number; y: number }
  theta: number
  lastLog: number
}

const TICK_MS = 100
const LOW_BATTERY = 20
const FAULT_CHANCE = 0.0004
const TRAFFIC_RADIUS = 3.0         // m: separation zone
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

  get running() { return this.timer !== null }

  // ── graph ────────────────────────────────────────────────
  private buildGraph(map: FleetMap) {
    this.nodes = new Map(map.points.map(p => [p.id, p]))
    this.adj.clear(); this.edgeLen.clear()
    for (const c of map.curves) {
      const list = this.adj.get(c.sNode) ?? []
      list.push(c); this.adj.set(c.sNode, list)
      this.edgeLen.set(c.id, curveLength(c))
    }
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

  nodeById(id: string): MapPoint | undefined { return this.nodes.get(id) }

  // ── lifecycle ────────────────────────────────────────────
  start(map: FleetMap) {
    if (this.timer) return
    if (!map.curves.length) { console.warn('[SIM] map has no edges'); return }
    this.buildGraph(map)

    // parking = charge nodes (fallback to first nodes). Use 2 robots.
    const charge = map.points.filter(p => p.cls === 'Charge')
    const parks = (charge.length >= 2 ? charge : map.points).slice(0, 2)
    const roster = FLEET_ROSTER.slice(0, 2)

    const store = useFleetStore.getState()
    this.bots = roster.map((f, i) => {
      const home = parks[i] ?? parks[0]
      const bot: SimBot = {
        id: f.id, model: f.model, mps: speedMaxOf(f.model),
        homeNode: home.id, node: home.id,
        route: [], edge: null, t: 0, phase: 'PARKED', missionId: null,
        battery: 70 + Math.random() * 30, status: 'IDLE',
        paused: false, fault: null, lowBatt: false, yielding: false,
        pos: { x: home.x, y: home.y }, theta: home.theta ?? 0, lastLog: 0,
      }
      store.upsertRobot({
        id: f.id, model: f.model, status: 'IDLE',
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
    console.log('[SIM] started', this.bots.length, 'AGVs parked at', parks.map(p => p.id).join(', '))
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    useFleetStore.getState().setMqttConnected(false)
  }

  command(robotId: string, action: 'PAUSE' | 'RESUME' | 'CANCEL') {
    const b = this.bots.find(x => x.id === robotId)
    if (!b) return
    if (action === 'PAUSE')  { b.paused = true;  b.status = 'PAUSE' }
    if (action === 'RESUME') { b.paused = false; b.status = b.edge ? 'EXECUTING' : 'IDLE' }
    if (action === 'CANCEL') {
      b.paused = false
      if (b.missionId) { useFleetStore.getState().cancelMission(b.missionId); b.missionId = null }
      this.sendHome(b)
    }
  }

  // ── dispatch: nearest free bot by path distance ──────────
  private dispatch(store: ReturnType<typeof useFleetStore.getState>) {
    const pending = store.missions.filter(m => m.status === 'PENDING')
    for (const m of pending) {
      const target = this.nodeById(m.endNode)
      if (!target) { store.updateMission(m.id, { status: 'FAILED' }); continue }
      const free = this.bots.filter(b => b.phase === 'PARKED' && !b.missionId && !b.fault && b.battery > LOW_BATTERY)
      if (!free.length) return  // all busy → leave PENDING for later

      // choose the bot with the cheapest route to the target
      let pick: { b: SimBot; path: MapCurve[]; cost: number } | null = null
      for (const b of free) {
        const path = this.shortestPath(b.node, m.endNode)
        if (!path) continue
        const cost = this.pathCost(path)
        if (!pick || cost < pick.cost) pick = { b, path, cost }
      }
      if (!pick) { continue } // no reachable bot right now

      const { b, path } = pick
      b.route = path
      b.edge = path[0] ?? null
      b.t = 0
      b.phase = 'TO_TARGET'
      b.missionId = m.id
      b.status = 'EXECUTING'
      store.updateMission(m.id, { status: 'EXECUTING', agvId: b.id, assignedAt: new Date().toISOString(), startedAt: new Date().toISOString() })
    }
  }

  private sendHome(b: SimBot) {
    const path = this.shortestPath(b.node, b.homeNode)
    if (path && path.length) { b.route = path; b.edge = path[0]; b.t = 0; b.phase = 'TO_HOME'; b.status = 'EXECUTING' }
    else { b.route = []; b.edge = null; b.phase = 'PARKED'; b.status = b.battery < LOW_BATTERY ? 'CHARGING' : 'IDLE' }
  }

  // ── traffic: reserve the node a bot is approaching ───────
  private resolveTraffic() {
    for (const b of this.bots) {
      b.yielding = false
      if (b.phase === 'PARKED' || b.paused || b.fault || !b.edge) continue
      const ahead = pointOnCurve(b.edge, Math.min(1, b.t + 0.12))
      for (const o of this.bots) {
        if (o === b || o.phase === 'PARKED') continue
        const d = Math.hypot(ahead.x - o.pos.x, ahead.y - o.pos.y)
        if (d < TRAFFIC_RADIUS && this.priority(o) > this.priority(b)) { b.yielding = true; break }
      }
    }
  }
  private priority(b: SimBot): number {
    // bots heading to a job outrank bots returning home; tiebreak stable by index
    const base = b.phase === 'TO_TARGET' ? 1000 : 500
    return base - this.bots.indexOf(b)
  }

  // ── main loop ────────────────────────────────────────────
  private tick() {
    const store = useFleetStore.getState()
    const now = Date.now()
    this.dispatch(store)
    this.resolveTraffic()

    for (const b of this.bots) {
      // fault lifecycle
      if (b.fault && now >= b.fault.until) { this.resolveAlarmFor(store, b.id, b.fault.error.errorType); b.fault = null; b.status = b.edge ? 'EXECUTING' : 'IDLE' }
      if (!b.fault && !b.paused && b.status === 'EXECUTING' && Math.random() < FAULT_CHANCE) this.raiseFault(store, b, now)

      if (b.paused || b.fault) { this.report(store, b, now); continue }

      // parked & idle: charge slowly, wait for a mission
      if (b.phase === 'PARKED') {
        b.status = b.battery < 99 ? 'CHARGING' : 'IDLE'
        b.battery = Math.min(100, b.battery + 0.15)
        this.report(store, b, now)
        continue
      }

      if (b.yielding) { b.status = 'TRAFFIC'; this.report(store, b, now); continue }
      if (b.status === 'TRAFFIC') b.status = 'EXECUTING'

      // advance along current edge
      if (b.edge) {
        const len = this.edgeLen.get(b.edge.id) ?? 1
        b.t += (b.mps * (TICK_MS / 1000)) / len
        const p = pointOnCurve(b.edge, Math.min(1, b.t))
        const look = pointOnCurve(b.edge, Math.min(1, b.t + 0.05))
        b.theta = calcTheta(look.x - p.x, look.y - p.y)
        b.battery = Math.max(2, b.battery - 0.02)
        b.pos = p

        if (b.t >= 1) {
          // arrived at edge end node
          b.node = b.edge.eNode
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
    if (b.phase === 'TO_TARGET') {
      if (b.missionId) { store.updateMission(b.missionId, { status: 'FINISHED', progress: 100, finishedAt: new Date().toISOString() }); store.recordOrderCompleted() }
      b.missionId = null
      this.sendHome(b)
    } else { // TO_HOME or stray
      b.phase = 'PARKED'
      b.status = b.battery < 99 ? 'CHARGING' : 'IDLE'
      const home = this.nodeById(b.homeNode)
      if (home) { b.pos = { x: home.x, y: home.y }; b.node = home.id }
    }
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
    // live mission progress = edges done / total (best-effort)
    if (b.missionId && b.phase === 'TO_TARGET') {
      const remaining = b.route.length
      const total = remaining + 1
      const pct = Math.max(1, Math.min(99, Math.round((1 - remaining / Math.max(total, 1)) * 100)))
      store.updateMission(b.missionId, { progress: pct })
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

    if (now - b.lastLog > 1000) {
      b.lastLog = now
      store.pushMqttLog({ id: `${b.id}-${now}`, robotId: b.id, topic: 'state', timestamp: new Date().toLocaleTimeString('en-GB') })
    }
  }
}

export const simulationService = new SimulationService()
