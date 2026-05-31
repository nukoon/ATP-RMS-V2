/**
 * SimulationService — dev-mode fleet driver (no MQTT broker required)
 * Walks robots along the map's real route edges (curves), following
 * bezier/line geometry, and feeds synthetic VDA5050 state through the
 * real store pipeline.
 */
import type { FleetMap, MapCurve, AgvModel, AgvStatus, VDA5050State } from '@/types'
import { useFleetStore } from '@/store/fleet.store'
import { calcTheta } from '@/utils/canvas'
import { speedMaxOf } from '@/constants/agv-specs'

interface SimBot {
  id: string
  model: AgvModel
  curve: MapCurve
  t: number            // 0..1 progress along current edge
  speed: number        // progress per tick (scaled by edge length)
  mps: number          // this model's real top speed (m/s)
  battery: number
  status: AgvStatus
  lastLog: number      // ms timestamp of last VDA stream entry
}

const FLEET: { id: string; model: AgvModel }[] = [
  { id: 'AMR-001', model: 'AM15' },
  { id: 'AMR-002', model: 'MP10S' },
  { id: 'AMR-003', model: 'AM15' },
  { id: 'AMR-004', model: 'AS15' },
  { id: 'AMR-005', model: 'TP30' },
]

const TICK_MS = 100
const KEY = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`
const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

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

  /** Pick an edge leaving the end of the current one (fall back to any edge) */
  private nextCurve(c: MapCurve, all: MapCurve[]): MapCurve {
    const out = this.graph.get(KEY(c.ex, c.ey))
    if (out && out.length) return rand(out)
    return rand(all)
  }

  start(map: FleetMap) {
    if (this.timer) return
    if (map.curves.length < 1) {
      console.warn('[SIM] map has no edges to drive on')
      return
    }
    this.buildGraph(map)
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
    this.timer = setInterval(() => this.tick(map.curves), TICK_MS)
    console.log('[SIM] started with', this.bots.length, 'robots on', all.length, 'edges')
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    useFleetStore.getState().setMqttConnected(false)
  }

  private tick(all: MapCurve[]) {
    const store = useFleetStore.getState()
    const now = Date.now()
    for (const b of this.bots) {
      b.t += b.speed
      if (b.t >= 1) {
        // reached the end of this edge → count it as a completed leg, hop on
        store.recordOrderCompleted()
        b.curve = this.nextCurve(b.curve, all)
        b.speed = (b.mps * (TICK_MS / 1000)) / curveLength(b.curve)
        b.t = 0
        b.battery = Math.max(5, b.battery - 0.4)
        b.status = b.battery < 15 ? 'CHARGING' : 'EXECUTING'
      }
      const pos  = pointOnCurve(b.curve, b.t)
      const look = pointOnCurve(b.curve, Math.min(1, b.t + 0.05))
      const theta = calcTheta(look.x - pos.x, look.y - pos.y)

      const state: VDA5050State = {
        headerId: now, timestamp: new Date().toISOString(), version: '2.0.0',
        manufacturer: 'ATP', serialNumber: b.id,
        orderId: `sim-${b.curve.id}`, orderUpdateId: 0,
        lastNodeId: '', lastNodeSequenceId: 0,
        driving: b.status === 'EXECUTING',
        agvPosition: { x: pos.x, y: pos.y, theta, mapId: 'sim' },
        velocity: { vx: b.status === 'EXECUTING' ? b.mps : 0, vy: 0, omega: 0 },
        batteryState: { batteryCharge: Math.round(b.battery), charging: b.status === 'CHARGING' },
        operatingMode: b.status,
        errors: [], warnings: [],
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
    store.setMqttLatency(20 + Math.round(Math.random() * 30))
  }
}

export const simulationService = new SimulationService()
