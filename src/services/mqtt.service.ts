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
  manufacturer: string   // e.g. "AiTEN"
}

type StateCallback   = (robotId: string, state: VDA5050State) => void
type ConnectCallback = (connected: boolean) => void

export class MqttService {
  private client: MqttClient | null = null
  private config: MqttConfig | null = null
  private robotIds: string[] = []
  private onState:   StateCallback   = () => {}
  private onConnect: ConnectCallback = () => {}

  connect(config: MqttConfig, robotIds: string[]) {
    this.config   = config
    this.robotIds = robotIds

    this.client = mqtt.connect(config.brokerUrl, {
      username: config.username,
      password: config.password,
      clientId: `aiten-fleet-dt-${Date.now()}`,
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
    for (const robotId of this.robotIds) {
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
    const mfr = this.config?.manufacturer ?? 'AiTEN'
    return `${MQTT_BASE_TOPIC}/${mfr}/${robotId}/${topic}`
  }

  private handleMessage(topic: string, payload: Buffer) {
    try {
      const parts = topic.split('/')
      const topicType = parts[parts.length - 1] as VDA5050Topic
      const robotId   = parts[parts.length - 2]
      const data      = JSON.parse(payload.toString())

      if (topicType === 'state' || topicType === 'visualization') {
        this.onState(robotId, data as VDA5050State)
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

  onStateUpdate(cb: StateCallback)   { this.onState   = cb }
  onConnectionChange(cb: ConnectCallback) { this.onConnect = cb }

  disconnect() {
    this.client?.end()
    this.client = null
  }

  get isConnected() { return this.client?.connected ?? false }
}

export const mqttService = new MqttService()
