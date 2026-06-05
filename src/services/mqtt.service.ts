/**
 * MqttService — VDA5050 v2.0 MQTT bridge
 * Connects to broker via WebSocket (port 9001)
 * Subscribes to all VDA5050 topics for configured robots
 */
import mqtt, { MqttClient } from 'mqtt'
import type { VDA5050State, VDA5050Topic } from '@/types'
import { MQTT_BASE_TOPIC, MQTT_QOS } from '@/constants'

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

export class MqttService {
  private client: MqttClient | null = null
  private config: MqttConfig | null = null
  // serial → {manufacturer, baseTopic} from each robot's brand preset
  private robots = new Map<string, { manufacturer: string; baseTopic: string }>()
  private onState:   StateCallback   = () => {}
  private onConnect: ConnectCallback = () => {}
  private onRobotConn: RobotConnCallback = () => {}

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
        this.onState(robotId, data as VDA5050State)
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

  disconnect() {
    this.client?.end()
    this.client = null
  }

  get isConnected() { return this.client?.connected ?? false }
}

export const mqttService = new MqttService()
