/**
 * MqttService — VDA5050 v2.0 MQTT bridge
 * Connects to broker via WebSocket (port 9001)
 * Subscribes to all VDA5050 topics for configured robots
 */
import mqtt, { MqttClient } from 'mqtt'
import type { VDA5050State, VDA5050Topic, AgvStatus } from '@/types'
import { MQTT_BASE_TOPIC, MQTT_QOS } from '@/constants'

// VDA5050 reports theta in RADIANS; our renderer uses DEGREES (0=East, 90=North).
const radToDeg = (r: number) => (r * 180) / Math.PI

// Derive our UI status from the raw VDA5050 state (operatingMode alone is
// AUTOMATIC/MANUAL/… — not a fleet status).
function deriveStatus(raw: Record<string, unknown>): AgvStatus {
  const errors = raw.errors as { errorLevel?: string }[] | undefined
  const safety = raw.safetyState as { eStop?: string } | undefined
  const battery = raw.batteryState as { charging?: boolean } | undefined
  // Only a FATAL error (or an e-stop) is a hard ERROR. WARNING-level errors —
  // transient "blocked" / "slipping" cautions a real robot streams while still
  // driving — must NOT flip the status to ERROR, or the badge flickers red.
  if (errors && errors.some(e => e?.errorLevel === 'FATAL')) return 'ERROR'
  if (safety && safety.eStop && safety.eStop !== 'NONE') return 'ERROR'
  if (battery && battery.charging) return 'CHARGING'
  if (raw.paused) return 'PAUSE'
  if (raw.driving) return 'EXECUTING'
  const mode = String(raw.operatingMode || '').toUpperCase()
  if (mode && mode !== 'AUTOMATIC' && mode !== 'SEMIAUTOMATIC') return 'UNAVAILABLE'  // MANUAL/SERVICE/TEACHIN
  return 'IDLE'
}

// Normalize a raw VDA5050 state/visualization payload for the UI: theta→degrees,
// operatingMode→our status, and safe defaults for optional blocks.
function normalizeLiveState(raw: Record<string, any>): VDA5050State {
  const pos = raw.agvPosition || {}
  return {
    ...(raw as VDA5050State),
    agvPosition: { x: pos.x ?? 0, y: pos.y ?? 0, theta: typeof pos.theta === 'number' ? radToDeg(pos.theta) : 0, mapId: pos.mapId ?? 'live' },
    velocity: raw.velocity || { vx: 0, vy: 0, omega: 0 },
    batteryState: raw.batteryState || { batteryCharge: 0, charging: false },
    operatingMode: deriveStatus(raw),   // updateFromVDA5050 reads this as the status
    errors: raw.errors || [],
  }
}

// Upcoming route from the state graph: where it is now + the nodes still ahead.
function pathFromState(raw: Record<string, any>): string[] {
  const ns = Array.isArray(raw.nodeStates) ? raw.nodeStates : []
  const ids = [raw.lastNodeId, ...ns.map((n: any) => n?.nodeId)].filter(Boolean) as string[]
  return ids.filter((id, i) => i === 0 || id !== ids[i - 1])   // drop consecutive dups
}

export interface MqttConfig {
  brokerUrl: string       // e.g. "ws://192.168.1.100:9001"
  username?: string
  password?: string
}

// per-robot VDA5050 topic identity (derived from the robot's brand preset)
export interface MqttRobot {
  serial: string
  manufacturer: string    // VDA5050 manufacturer segment, e.g. "SEER" / "ATP"
  baseTopic: string       // topic prefix incl. version, e.g. "robot/v2" or "uagv/v2"
}

type StateCallback   = (robotId: string, state: VDA5050State) => void
type ConnectCallback = (connected: boolean) => void
// per-robot VDA5050 connection state (ONLINE / OFFLINE / CONNECTIONBROKEN)
type RobotConnCallback = (robotId: string, online: boolean) => void
// upcoming route (node ids) parsed from a state's nodeStates
type PathCallback = (robotId: string, path: string[]) => void

export class MqttService {
  private client: MqttClient | null = null
  private config: MqttConfig | null = null
  // serial → {manufacturer, baseTopic} from each robot's brand preset
  private robots = new Map<string, { manufacturer: string; baseTopic: string }>()
  private onState:   StateCallback   = () => {}
  private onConnect: ConnectCallback = () => {}
  private onRobotConn: RobotConnCallback = () => {}
  private onPath: PathCallback = () => {}

  connect(config: MqttConfig, robots: MqttRobot[]) {
    this.config = config
    this.robots = new Map(robots.map(r => [r.serial, { manufacturer: r.manufacturer, baseTopic: r.baseTopic }]))

    this.client = mqtt.connect(config.brokerUrl, {
      username: config.username,
      password: config.password,
      clientId: `atp-rms-v2-${Date.now()}`,
      reconnectPeriod: 3000,
      connectTimeout: 10000,
    })

    this.client.on('connect', () => {
      console.log('[MQTT] Connected to', config.brokerUrl)
      this.onConnect(true)
      this.subscribeAll()
    })

    this.client.on('disconnect', () => {
      console.warn('[MQTT] Disconnected')
      this.onConnect(false)
    })

    this.client.on('error', (err) => {
      console.error('[MQTT] Error:', err)
    })

    this.client.on('message', (topic, payload) => {
      this.handleMessage(topic, payload)
    })
  }

  private subscribeAll() {
    if (!this.client || !this.config) return
    const topics: VDA5050Topic[] = ['state', 'visualization', 'connection']
    for (const robotId of this.robots.keys()) {
      for (const t of topics) {
        const fullTopic = this.buildTopic(robotId, t)
        this.client.subscribe(fullTopic, { qos: MQTT_QOS }, (err) => {
          if (err) console.error(`[MQTT] Subscribe failed: ${fullTopic}`, err)
          else console.log(`[MQTT] Subscribed: ${fullTopic}`)
        })
      }
    }
  }

  private buildTopic(robotId: string, topic: VDA5050Topic): string {
    const r = this.robots.get(robotId)
    const mfr  = r?.manufacturer ?? 'ATP'
    const base = r?.baseTopic || MQTT_BASE_TOPIC   // brand-specific prefix (robot/v2, uagv/v2…)
    return `${base}/${mfr}/${robotId}/${topic}`
  }

  private handleMessage(topic: string, payload: Buffer) {
    try {
      const parts = topic.split('/')
      const topicType = parts[parts.length - 1] as VDA5050Topic
      const robotId   = parts[parts.length - 2]
      const data      = JSON.parse(payload.toString())

      if (topicType === 'state' || topicType === 'visualization') {
        this.onState(robotId, normalizeLiveState(data))          // theta→deg, status, defaults
        if (topicType === 'state') this.onPath(robotId, pathFromState(data))   // live route for the map
      } else if (topicType === 'connection') {
        // VDA5050 connection message: connectionState ONLINE/OFFLINE/CONNECTIONBROKEN
        const cs = (data as { connectionState?: string }).connectionState
        this.onRobotConn(robotId, cs === 'ONLINE')
      }
    } catch (e) {
      console.warn('[MQTT] Parse error:', topic, e)
    }
  }

  sendOrder(robotId: string, order: unknown) {
    if (!this.client || !this.config) return
    const topic = this.buildTopic(robotId, 'order')
    this.client.publish(topic, JSON.stringify(order), { qos: MQTT_QOS })
  }

  // VDA5050 instantActions (cancelOrder / startPause / stopPause / startCharging…)
  // — the channel real robots use for immediate commands outside an order.
  sendInstantActions(robotId: string, message: unknown) {
    if (!this.client || !this.config) return
    const topic = this.buildTopic(robotId, 'instantActions')
    this.client.publish(topic, JSON.stringify(message), { qos: MQTT_QOS })
  }

  onStateUpdate(cb: StateCallback)   { this.onState   = cb }
  onConnectionChange(cb: ConnectCallback) { this.onConnect = cb }
  onRobotConnection(cb: RobotConnCallback) { this.onRobotConn = cb }
  onPathUpdate(cb: PathCallback) { this.onPath = cb }

  disconnect() {
    this.client?.end()
    this.client = null
  }

  get isConnected() { return this.client?.connected ?? false }
}

export const mqttService = new MqttService()
