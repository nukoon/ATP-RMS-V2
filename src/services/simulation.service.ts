/**
 * SimulationService — dev-mode fleet driver (no MQTT broker required)
 * Walks robots along the map's real route edges (curves), following
 * bezier/line geometry, and feeds synthetic VDA5050 state through the
 * real store pipeline. Also acts as a lightweight dispatcher: it picks
 * up PENDING missions, drives bots toward the target, and raises alarms.
 */
import type { FleetMap, MapPoint, MapCurve, AgvModel, AgvStatus, VDA5050State, VDA5050Error } from '@/types'
import { useFleetStore } from '@/store/fleet.store'
import { calcTheta } from '@/utils/canvas'
import { speedMaxOf } from '@/constants/agv-specs'
import { FLEET_ROSTER } from '@/constants/fleet-roster'

interface BotMission {
  id: string
  tx: number; ty: number      // target node coords
  initialDist: number
  ticks: number
}

interface SimBot {
  id: string
  model: AgvModel
  curve: MapCurve
  t: number            // 0..1 progress along current edge
  speed: number        // progress per tick (scaled by edge length)
  mps: number          // this model's real top speed (m/s)
  battery: number
  status: AgvStatus
  paused: boolean      // operator paused via quick action
  mission: BotMission | null
  fault: { until: number; error: VDA5050Error } | null
  lowBatt: boolean     // whether a LOW_BATTERY alarm is currently raised
  yielding: boolean    // currently yielding to traffic this tick
  lastLog: number      // ms timestamp of last VDA stream entry
}

const FLEET: { id: string; model: AgvModel }[] =
  FLEET_ROSTER.map(m => ({ id: m.id, model: m.model }))

const TICK_MS = 100
const ARRIVE_DIST = 1.0           // map units: close enough to the target node
const MISSION_TIMEOUT_TICKS = 2000
const LOW_BATTERY = 20            // % — raise a warning below this
const FAULT_CHANCE = 0.0006       // per bot per tick — random transient fault
const TRAFFIC_RADIUS = 2.2        // map units: separation zone between AGVs
const LOOKAHEAD = 0.06            // fraction of edge to look ahead for conflicts
const KEY = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`
const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const uid = () => Math.random().toString(36).slice(2, 9)

/** Point on an edge at parameter t (0..1), respecting line / quad / cubic bezier */
function pointOnCurve(c: MapCurve, t: number): { x: number; y: number } {
  if (c.type === 'bezier' && c.cp.length >= 2) {
    const u = 1 - t
    const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t
    return {
      x: a * c.sx + b * c.cp[0].x + d * c.cp[1].x + e * c.ex,
      y: a * c.sy + b * c.cp[0].y + d * c.cp[1].y + e * c.ey,
    }
  }
  if (c.type === 'bezier' && c.cp.length === 1) {
    const u = 1 - t
    return {
      x: u * u * c.sx + 2 * u * t * c.cp[0].x + t * t * c.ex,
      y: u * u * c.sy + 2 * u * t * c.cp[0].y + t * t * c.ey,
    }
  }
  return { x: c.sx + (c.ex - c.sx) * t, y: c.sy + (c.ey - c.sy) * t }
}

function curveLength(c: MapCurve): number {
  let len = 0
  let prev = pointOnCurve(c, 0)
  for (let i = 1; i <= 12; i++) {
    const p = pointOnCurve(c, i / 12)
    len += Math.hypot(p.x - prev.x, p.y - prev.y)
    prev = p
  }
  return len || 0.5
}

export class SimulationService {
  private bots: SimBot[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  /** adjacency: node coord key → edges leaving that node */
  private graph = new Map<string, MapCurve[]>()
  private nodes: MapPoint[] = []

  get running() { return this.timer !== null }

  private buildGraph(map: FleetMap) {
    this.graph.clear()
    for (const c of map.curves) {
      const k = KEY(c.sx, c.sy)
      const list = this.graph.get(k) ?? []
      list.push(c)
      this.graph.set(k, list)
    }
  }

  /** Pick the next edge: greedy toward a target if the bot is on a mission, else random. */
  private nextCurve(b: SimBot, all: MapCurve[]): MapCurve {
    const out = this.graph.get(KEY(b.curve.ex, b.curve.ey))
    if (!out || !out.length) return rand(all)
    if (!b.mission) return rand(out)
    // choose the outgoing edge whose endpoint is closest to the target
    const { tx, ty } = b.mission
    return out.reduce((best, c) =>
      Math.hypot(c.ex - tx, c.ey - ty) < Math.hypot(best.ex - tx, best.ey - ty) ? c : best
    )
  }

  /** Nearest map node to a world point — used to resolve mission start/end. */
  nodeById(id: string): MapPoint | undefined {
    return this.nodes.find(n => n.id === id)
  }

  start(map: FleetMap) {
    if (this.timer) return
    if (map.curves.length < 1) {
      console.warn('[SIM] map has no edges to drive on')
      return
    }
    this.buildGraph(map)
    this.nodes = map.points
    const all = map.curves

    const store = useFleetStore.getState()
    this.bots = FLEET.map(f => {
      const curve = rand(all)
      const start = pointOnCurve(curve, 0)
      const mps = speedMaxOf(f.model)
      const bot: SimBot = {
        id: f.id, model: f.model, curve, t: 0,
        mps,
        speed: (mps * (TICK_MS / 1000)) / curveLength(curve),
        battery: 60 + Math.random() * 40,
        status: 'EXECUTING',
        paused: false,
        mission: null,
        fault: null,
        lowBatt: false,
        yielding: false,
        lastLog: 0,
      }
      store.upsertRobot({
        id: f.id, model: f.model, status: 'IDLE',
        pose: { x: start.x, y: start.y, theta: 0, mapId: 'sim' },
        battery: { batteryCharge: bot.battery, charging: false },
        velocity: { vx: 0, vy: 0, omega: 0 },
        currentNodeId: '', currentOrderId: null,
        path: [], pathIndex: 0, errors: [],
        totalDistance: 0, lastUpdated: Date.now(),
        mqttConnected: true,
      })
      return bot
    })

    store.setMqttConnected(true)
    this.timer = setInterval(() => this.tick(all), TICK_MS)
    console.log('[SIM] started with', this.bots.length, 'robots on', all.length, 'edges')
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    useFleetStore.getState().setMqttConnected(false)
  }

  /** Operator quick action from the Robot Detail panel. */
  command(robotId: string, action: 'PAUSE' | 'RESUME' | 'CANCEL') {
    const b = this.bots.find(x => x.id === robotId)
    if (!b) return
    if (action === 'PAUSE')  { b.paused = true;  b.status = 'PAUSE' }
    if (action === 'RESUME') { b.paused = false; b.status = 'EXECUTING' }
    if (action === 'CANCEL') {
      b.paused = false
      if (b.mission) { useFleetStore.getState().cancelMission(b.mission.id); b.mission = null }
      b.status = 'IDLE'
    }
  }

  /** Assign PENDING missions to free bots (nearest-first). */
  private dispatch(store: ReturnType<typeof useFleetStore.getState>) {
    const pending = store.missions.filter(m => m.status === 'PENDING')
    if (!pending.length) return
    for (const m of pending) {
      const target = this.nodeById(m.endNode)
      if (!target) { store.updateMission(m.id, { status: 'FAILED' }); continue }
      const free = this.bots.filter(b => !b.mission && !b.fault && b.status !== 'CHARGING')
      if (!free.length) return
      // pick the bot currently closest to the mission target
      const pos = (b: SimBot) => pointOnCurve(b.curve, b.t)
      const bot = free.reduce((best, b) =>
        Math.hypot(pos(b).x - target.x, pos(b).y - target.y) <
        Math.hypot(pos(best).x - target.x, pos(best).y - target.y) ? b : best)
      const p = pos(bot)
      bot.mission = { id: m.id, tx: target.x, ty: target.y, initialDist: Math.hypot(p.x - target.x, p.y - target.y) || 1, ticks: 0 }
      bot.status = 'EXECUTING'
      store.updateMission(m.id, { status: 'EXECUTING', agvId: bot.id, assignedAt: new Date().toISOString(), startedAt: new Date().toISOString() })
    }
  }

  /** Priority used to decide who yields at a conflict (higher = right of way). */
  private priority(b: SimBot): number {
    // on-mission bots outrank free-roamers; stable tiebreak by serial
    const base = b.mission ? 1000 : 0
    return base - this.bots.indexOf(b)
  }

  /**
   * Traffic control: a moving bot reserves a look-ahead zone. If another
   * active bot already sits in that zone and has higher priority, this bot
   * yields (holds position, status TRAFFIC) for this tick.
   */
  private resolveTraffic() {
    // current positions of bots that physically occupy the floor
    const occ = this.bots
      .filter(b => b.status !== 'IDLE' && b.status !== 'UNKNOWN')
      .map(b => ({ b, p: pointOnCurve(b.curve, b.t) }))

    for (const b of this.bots) {
      b.yielding = false
      if (b.paused || b.fault || b.status === 'PAUSE' || b.status === 'ERROR' || b.status === 'CHARGING') continue

      const ahead = pointOnCurve(b.curve, Math.min(1, b.t + LOOKAHEAD))
      for (const other of occ) {
        if (other.b === b) continue
        const d = Math.hypot(ahead.x - other.p.x, ahead.y - other.p.y)
        if (d < TRAFFIC_RADIUS && this.priority(other.b) > this.priority(b)) {
          b.yielding = true
          break
        }
      }
    }
  }

  private tick(all: MapCurve[]) {
    const store = useFleetStore.getState()
    const now = Date.now()

    this.dispatch(store)
    this.resolveTraffic()

    for (const b of this.bots) {
      // transient fault recovery
      if (b.fault && now >= b.fault.until) {
        this.resolveAlarmFor(store, b.id, b.fault.error.errorType)
        b.fault = null
        b.status = b.mission ? 'EXECUTING' : 'EXECUTING'
      }
      // random transient fault
      if (!b.fault && !b.paused && b.status === 'EXECUTING' && Math.random() < FAULT_CHANCE) {
        this.raiseFault(store, b, now)
      }

      // paused / faulted robots hold position but keep reporting
      if (b.paused || b.fault || b.status === 'PAUSE' || b.status === 'ERROR') {
        this.report(store, b, now)
        continue
      }

      // traffic: yield right-of-way, hold position this tick
      if (b.yielding) {
        if (b.status !== 'CHARGING') b.status = 'TRAFFIC'
        this.report(store, b, now)
        continue
      }
      // clear a stale TRAFFIC state once the path is free again
      if (b.status === 'TRAFFIC') b.status = b.battery < 15 ? 'CHARGING' : 'EXECUTING'

      b.t += b.speed
      if (b.t >= 1) {
        store.recordOrderCompleted()
        b.curve = this.nextCurve(b, all)
        b.speed = (b.mps * (TICK_MS / 1000)) / curveLength(b.curve)
        b.t = 0
        b.battery = Math.max(5, b.battery - 0.4)
        b.status = b.battery < 15 ? 'CHARGING' : 'EXECUTING'
      }

      // mission progress / arrival
      if (b.mission) {
        const p = pointOnCurve(b.curve, b.t)
        const dist = Math.hypot(p.x - b.mission.tx, p.y - b.mission.ty)
        const progress = Math.max(0, Math.min(99, Math.round((1 - dist / b.mission.initialDist) * 100)))
        store.updateMission(b.mission.id, { progress })
        b.mission.ticks++
        if (dist <= ARRIVE_DIST) {
          store.updateMission(b.mission.id, { status: 'FINISHED', progress: 100, finishedAt: new Date().toISOString() })
          b.mission = null
        } else if (b.mission.ticks > MISSION_TIMEOUT_TICKS) {
          store.updateMission(b.mission.id, { status: 'FAILED', finishedAt: new Date().toISOString() })
          b.mission = null
        }
      }

      // battery alarms
      if (b.battery < LOW_BATTERY && !b.lowBatt) {
        b.lowBatt = true
        store.pushAlarm({ id: uid(), agvId: b.id, code: 'BAT_LOW', level: 'WARNING',
          message: `Battery low (${Math.round(b.battery)}%)`, status: 'ACTIVE', createdAt: new Date().toISOString() })
      } else if (b.battery >= LOW_BATTERY && b.lowBatt) {
        b.lowBatt = false
        this.resolveAlarmFor(store, b.id, 'BAT_LOW')
      }

      this.report(store, b, now)
    }
    store.setMqttLatency(20 + Math.round(Math.random() * 30))
  }

  private raiseFault(store: ReturnType<typeof useFleetStore.getState>, b: SimBot, now: number) {
    const faults = [
      { type: 'OBSTACLE_DETECTED', desc: 'Obstacle blocking path' },
      { type: 'LOCALIZATION_LOST', desc: 'Localization score below threshold' },
      { type: 'MOTOR_OVERCURRENT',  desc: 'Drive motor over-current' },
    ]
    const f = rand(faults)
    const error: VDA5050Error = {
      errorType: f.type, errorLevel: 'FATAL', errorDescription: f.desc, errorReferences: [],
    }
    b.fault = { until: now + 3000 + Math.random() * 4000, error }
    b.status = 'ERROR'
    store.pushAlarm({ id: uid(), agvId: b.id, code: f.type, level: 'ERROR',
      message: f.desc, status: 'ACTIVE', createdAt: new Date().toISOString() })
  }

  private resolveAlarmFor(store: ReturnType<typeof useFleetStore.getState>, agvId: string, code: string) {
    const a = store.alarms.find(x => x.status === 'ACTIVE' && x.agvId === agvId && x.code === code)
    if (a) store.resolveAlarm(a.id)
  }

  /** Emit one synthetic VDA5050 state for a bot through the store pipeline. */
  private report(store: ReturnType<typeof useFleetStore.getState>, b: SimBot, now: number) {
    const pos  = pointOnCurve(b.curve, b.t)
    const look = pointOnCurve(b.curve, Math.min(1, b.t + 0.05))
    const theta = calcTheta(look.x - pos.x, look.y - pos.y)

    const state: VDA5050State = {
      headerId: now, timestamp: new Date().toISOString(), version: '2.0.0',
      manufacturer: 'ATP', serialNumber: b.id,
      orderId: b.mission ? b.mission.id : '', orderUpdateId: 0,
      lastNodeId: '', lastNodeSequenceId: 0,
      driving: b.status === 'EXECUTING',
      agvPosition: { x: pos.x, y: pos.y, theta, mapId: 'sim' },
      velocity: { vx: b.status === 'EXECUTING' ? b.mps : 0, vy: 0, omega: 0 },
      batteryState: { batteryCharge: Math.round(b.battery), charging: b.status === 'CHARGING' },
      operatingMode: b.status,
      errors: b.fault ? [b.fault.error] : [],
      warnings: [],
      safetyState: { fieldViolation: false, eStop: 'NONE' },
    }
    store.updateFromVDA5050(b.id, state)

    // feed the VDA5050 stream panel, throttled to ~1/s per robot
    if (now - b.lastLog > 1000) {
      b.lastLog = now
      store.pushMqttLog({
        id: `${b.id}-${now}`,
        robotId: b.id,
        topic: 'state',
        timestamp: new Date().toLocaleTimeString('en-GB'),
      })
    }
  }
}

export const simulationService = new SimulationService()
