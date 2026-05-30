/**
 * SimulationService — dev-mode fleet driver (no MQTT broker required)
 * Seeds robots and walks them between map LocationMark nodes, feeding
 * synthetic VDA5050 state through the real store pipeline.
 */
import type { FleetMap, MapPoint, AgvModel, AgvStatus, VDA5050State } from '@/types'
import { useFleetStore } from '@/store/fleet.store'
import { calcTheta } from '@/utils/canvas'

interface SimBot {
  id: string
  model: AgvModel
  from: MapPoint
  to: MapPoint
  t: number            // 0..1 progress along current leg
  speed: number        // progress per tick
  battery: number
  status: AgvStatus
}

const FLEET: { id: string; model: AgvModel }[] = [
  { id: 'AMR-001', model: 'AM15' },
  { id: 'AMR-002', model: 'MP10S' },
  { id: 'AMR-003', model: 'AM15' },
  { id: 'AMR-004', model: 'AS15' },
  { id: 'AMR-005', model: 'TP30' },
]

const TICK_MS = 100
const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

export class SimulationService {
  private bots: SimBot[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private nodes: MapPoint[] = []

  get running() { return this.timer !== null }

  start(map: FleetMap) {
    if (this.timer) return
    this.nodes = map.points.filter(p => p.cls === 'LocationMark')
    if (this.nodes.length < 2) {
      console.warn('[SIM] not enough LocationMark nodes to simulate')
      return
    }

    const store = useFleetStore.getState()
    this.bots = FLEET.map(f => {
      const from = rand(this.nodes)
      const to   = rand(this.nodes)
      const bot: SimBot = {
        id: f.id, model: f.model, from, to, t: 0,
        speed: 0.01 + Math.random() * 0.02,
        battery: 60 + Math.random() * 40,
        status: 'EXECUTING',
      }
      // seed full robot so updateFromVDA5050 (update-only) can take over
      store.upsertRobot({
        id: f.id, model: f.model, status: 'IDLE',
        pose: { x: from.x, y: from.y, theta: 0, mapId: 'sim' },
        battery: { batteryCharge: bot.battery, charging: false },
        velocity: { vx: 0, vy: 0, omega: 0 },
        currentNodeId: from.id, currentOrderId: null,
        path: [], pathIndex: 0, errors: [],
        totalDistance: 0, lastUpdated: Date.now(),
        mqttConnected: true,
      })
      return bot
    })

    store.setMqttConnected(true)
    this.timer = setInterval(() => this.tick(), TICK_MS)
    console.log('[SIM] started with', this.bots.length, 'robots')
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    useFleetStore.getState().setMqttConnected(false)
  }

  private tick() {
    const store = useFleetStore.getState()
    for (const b of this.bots) {
      b.t += b.speed
      if (b.t >= 1) {
        // arrived → pick next leg, occasionally idle/charge
        b.from = b.to
        b.to = rand(this.nodes)
        b.t = 0
        b.battery = Math.max(5, b.battery - Math.random() * 1.5)
        b.status = b.battery < 15 ? 'CHARGING' : 'EXECUTING'
      }
      const x = b.from.x + (b.to.x - b.from.x) * b.t
      const y = b.from.y + (b.to.y - b.from.y) * b.t
      const theta = calcTheta(b.to.x - b.from.x, b.to.y - b.from.y)

      const state: VDA5050State = {
        headerId: Date.now(), timestamp: new Date().toISOString(), version: '2.0.0',
        manufacturer: 'ATP', serialNumber: b.id,
        orderId: `sim-${b.from.id}-${b.to.id}`, orderUpdateId: 0,
        lastNodeId: b.from.id, lastNodeSequenceId: 0,
        driving: b.status === 'EXECUTING',
        agvPosition: { x, y, theta, mapId: 'sim' },
        velocity: { vx: 0.5, vy: 0, omega: 0 },
        batteryState: { batteryCharge: Math.round(b.battery), charging: b.status === 'CHARGING' },
        operatingMode: b.status,
        errors: [], warnings: [],
        safetyState: { fieldViolation: false, eStop: 'NONE' },
      }
      store.updateFromVDA5050(b.id, state)
    }
  }
}

export const simulationService = new SimulationService()
