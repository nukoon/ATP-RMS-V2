/**
 * Fleet Store — Zustand global state
 * Single source of truth for all robot states, map, orders, UI config
 */
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
  Robot, FleetMap, FleetOrder, MqttLogEntry,
  MapViewConfig, FleetMetrics, VDA5050State, AgvStatus,
} from '@/types'
import { DEFAULT_MAP_CONFIG } from '@/constants'

interface FleetStore {
  // Map
  map:         FleetMap | null
  setMap:      (map: FleetMap) => void

  // Robots
  robots:      Map<string, Robot>
  upsertRobot: (robot: Robot) => void
  updateFromVDA5050: (robotId: string, state: VDA5050State) => void

  // Orders
  orders:      FleetOrder[]
  setOrders:   (orders: FleetOrder[]) => void
  updateOrder: (id: string, patch: Partial<FleetOrder>) => void

  // MQTT Log (ring buffer, max 100)
  mqttLog:     MqttLogEntry[]
  pushMqttLog: (entry: MqttLogEntry) => void

  // MQTT connection
  mqttConnected: boolean
  setMqttConnected: (v: boolean) => void
  mqttLatency: number
  setMqttLatency: (ms: number) => void

  // UI
  selectedRobotId: string | null
  setSelectedRobotId: (id: string | null) => void
  mapConfig: MapViewConfig
  setMapConfig: (patch: Partial<MapViewConfig>) => void

  // Derived metrics (recomputed on robot change)
  metrics: FleetMetrics
  recomputeMetrics: () => void
}

const INITIAL_METRICS: FleetMetrics = {
  activeCount: 0, chargingCount: 0, errorCount: 0, idleCount: 0,
  avgBattery: 0, throughputPerHour: 0, ordersCompleted: 0,
  utilization: 0, totalDistance: 0,
}

export const useFleetStore = create<FleetStore>()(
  subscribeWithSelector((set, get) => ({
    map: null,
    setMap: (map) => set({ map }),

    robots: new Map(),
    upsertRobot: (robot) => {
      set(s => {
        const robots = new Map(s.robots)
        robots.set(robot.id, robot)
        return { robots }
      })
      get().recomputeMetrics()
    },

    updateFromVDA5050: (robotId, state) => {
      set(s => {
        const robots = new Map(s.robots)
        const existing = robots.get(robotId)
        if (!existing) return s
        const updated: Robot = {
          ...existing,
          status:        state.operatingMode as AgvStatus,
          pose:          { ...state.agvPosition, mapId: existing.pose.mapId },
          battery:       state.batteryState,
          velocity:      state.velocity,
          currentNodeId: state.lastNodeId,
          currentOrderId: state.orderId || null,
          errors:        state.errors,
          lastUpdated:   Date.now(),
        }
        robots.set(robotId, updated)
        return { robots }
      })
      get().recomputeMetrics()
    },

    orders: [],
    setOrders: (orders) => set({ orders }),
    updateOrder: (id, patch) =>
      set(s => ({ orders: s.orders.map(o => o.id === id ? { ...o, ...patch } : o) })),

    mqttLog: [],
    pushMqttLog: (entry) =>
      set(s => ({ mqttLog: [entry, ...s.mqttLog].slice(0, 100) })),

    mqttConnected: false,
    setMqttConnected: (v) => set({ mqttConnected: v }),
    mqttLatency: 0,
    setMqttLatency: (ms) => set({ mqttLatency: ms }),

    selectedRobotId: null,
    setSelectedRobotId: (id) => set({ selectedRobotId: id }),

    mapConfig: DEFAULT_MAP_CONFIG as MapViewConfig,
    setMapConfig: (patch) =>
      set(s => ({ mapConfig: { ...s.mapConfig, ...patch } })),

    metrics: INITIAL_METRICS,
    recomputeMetrics: () => {
      const robots = [...get().robots.values()]
      const active    = robots.filter(r => r.status === 'EXECUTING').length
      const charging  = robots.filter(r => r.status === 'CHARGING').length
      const errors    = robots.filter(r => r.status === 'ERROR').length
      const idle      = robots.filter(r => r.status === 'IDLE').length
      const avgBat    = robots.length ? robots.reduce((a, r) => a + r.battery.batteryCharge, 0) / robots.length : 0
      const totalDist = robots.reduce((a, r) => a + r.totalDistance, 0)
      const util      = robots.length ? active / robots.length : 0
      set({
        metrics: {
          ...get().metrics,
          activeCount: active, chargingCount: charging,
          errorCount: errors, idleCount: idle,
          avgBattery: Math.round(avgBat),
          utilization: util,
          totalDistance: totalDist,
        }
      })
    },
  }))
)
