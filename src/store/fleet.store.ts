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
import type { Mission, Alarm } from '@/types/fleet'
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
  recordOrderCompleted: () => void

  // Missions (Phase C)
  missions:    Mission[]
  addMission:    (m: Mission) => void
  updateMission: (id: string, patch: Partial<Mission>) => void
  cancelMission: (id: string) => void

  // Alarms (Phase D)
  alarms:      Alarm[]
  pushAlarm:   (a: Alarm) => void
  resolveAlarm: (id: string) => void

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

// Rolling window of order-completion timestamps (ms), for throughput/hr
const completionTimes: number[] = []

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
        // accumulate travelled distance from pose delta (ignore teleports > 5m/tick)
        const dx = state.agvPosition.x - existing.pose.x
        const dy = state.agvPosition.y - existing.pose.y
        const step = Math.hypot(dx, dy)
        const moved = step < 5 ? step : 0
        const updated: Robot = {
          ...existing,
          status:        state.operatingMode as AgvStatus,
          pose:          { ...state.agvPosition, mapId: existing.pose.mapId },
          battery:       state.batteryState,
          velocity:      state.velocity,
          currentNodeId: state.lastNodeId,
          currentOrderId: state.orderId || null,
          errors:        state.errors,
          totalDistance: existing.totalDistance + moved,
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
    recordOrderCompleted: () => {
      completionTimes.push(Date.now())
      get().recomputeMetrics()
    },

    missions: [],
    addMission: (m) => set(s => ({ missions: [m, ...s.missions] })),
    updateMission: (id, patch) =>
      set(s => ({ missions: s.missions.map(m => m.id === id ? { ...m, ...patch } : m) })),
    cancelMission: (id) =>
      set(s => ({ missions: s.missions.map(m =>
        m.id === id && m.status !== 'FINISHED'
          ? { ...m, status: 'CANCELLED', finishedAt: new Date().toISOString() }
          : m) })),

    alarms: [],
    pushAlarm: (a) =>
      set(s => {
        // de-dup: skip if an identical active alarm already exists
        if (s.alarms.some(x => x.status === 'ACTIVE' && x.agvId === a.agvId && x.code === a.code)) return s
        return { alarms: [a, ...s.alarms].slice(0, 200) }
      }),
    resolveAlarm: (id) =>
      set(s => ({ alarms: s.alarms.map(a =>
        a.id === id ? { ...a, status: 'RESOLVED', resolvedAt: new Date().toISOString() } : a) })),

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
      // throughput = orders completed in the last hour (rolling)
      const cutoff = Date.now() - 3600_000
      while (completionTimes.length && completionTimes[0] < cutoff) completionTimes.shift()
      set({
        metrics: {
          ...get().metrics,
          activeCount: active, chargingCount: charging,
          errorCount: errors, idleCount: idle,
          avgBattery: Math.round(avgBat),
          utilization: util,
          totalDistance: totalDist,
          throughputPerHour: completionTimes.length,
          ordersCompleted: completionTimes.length,
        }
      })
    },
  }))
)
