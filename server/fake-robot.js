/**
 * fake-robot.js — VDA5050 robot emulator for bench-testing the LIVE path
 * (dispatcher / orders / mission lifecycle) WITHOUT a real AGV.
 *
 * Connects to the seer-bridge broker over TCP like RoboVDA would, publishes
 * `state` at 2 Hz, accepts `order`s (drives node-to-node using each node's
 * nodePosition), honours `instantActions` cancelOrder, and — on a mission
 * order (anything not PARK-) — reports `pick` then `drop` FINISHED action
 * states on arrival so the dashboard's syncLiveMission runs the full
 * carrying → stock-flip → FINISHED → re-dispatch → auto-park chain.
 *
 * Run:  node server/fake-robot.js
 * Env:  SERIAL=FAKE-01  MFR=SEER  BASE=robot/v2  BROKER=mqtt://localhost:1883
 *       START_NODE=LM1  START_X=0  START_Y=0  SPEED=1.5 (m/s)
 *
 * SAFETY: use a serial that is NOT a real robot's — the dashboard publishes
 * orders to whatever serial is registered+enabled.
 */
const mqtt = require('mqtt')

const SERIAL = process.env.SERIAL || 'FAKE-01'
const MFR    = process.env.MFR    || 'SEER'
const BASE   = process.env.BASE   || 'robot/v2'
const BROKER = process.env.BROKER || 'mqtt://localhost:1883'
const SPEED  = Number(process.env.SPEED || 1.5)   // m/s
const TICK   = 500                                 // ms

const t = (s) => `${BASE}/${MFR}/${SERIAL}/${s}`

// pose + mission state
let x = Number(process.env.START_X || 0)
let y = Number(process.env.START_Y || 0)
let lastNodeId = process.env.START_NODE || 'LM1'
let order = null          // { orderId, nodes: [{nodeId, x, y, actions}], idx }
let driving = false
let actionStates = []     // VDA5050 actionStates we report
let dwell = 0             // ticks left to linger at an action node
let headerId = 0

const client = mqtt.connect(BROKER, { clientId: `fake-robot-${SERIAL}` })

client.on('connect', () => {
  console.log(`[fake-robot] ${SERIAL} connected to ${BROKER}`)
  client.publish(t('connection'), JSON.stringify({
    headerId: ++headerId, timestamp: new Date().toISOString(), version: '2.0.0',
    manufacturer: MFR, serialNumber: SERIAL, connectionState: 'ONLINE',
  }), { qos: 1, retain: true })
  client.subscribe([t('order'), t('instantActions')], { qos: 1 })
})

client.on('message', (topic, payload) => {
  let msg
  try { msg = JSON.parse(payload.toString()) } catch { return }
  if (topic === t('order')) {
    const nodes = (msg.nodes || []).map(n => ({
      nodeId: n.nodeId,
      x: n.nodePosition?.x ?? x, y: n.nodePosition?.y ?? y,
      actions: n.actions || [],
    }))
    order = { orderId: msg.orderId, nodes, idx: 0 }
    actionStates = []
    dwell = 0
    driving = nodes.length > 1
    console.log(`[fake-robot] ORDER ${msg.orderId}: ${nodes.map(n => n.nodeId).join(' → ')}`)
  } else if (topic === t('instantActions')) {
    for (const a of msg.actions || []) {
      console.log(`[fake-robot] instantAction: ${a.actionType}`)
      if (a.actionType === 'cancelOrder') { order = null; driving = false; actionStates = [] }
    }
  }
})

const finish = (actionType) => {
  if (!actionStates.some(a => a.actionType === actionType)) {
    actionStates.push({ actionId: `${actionType}-${Date.now()}`, actionType, actionStatus: 'FINISHED' })
    console.log(`[fake-robot] action ${actionType} FINISHED at ${lastNodeId}`)
  }
}

function tick() {
  if (order && order.idx < order.nodes.length) {
    if (dwell > 0) { dwell-- }
    else {
      const target = order.nodes[order.idx]
      const dx = target.x - x, dy = target.y - y
      const d = Math.hypot(dx, dy)
      const step = SPEED * (TICK / 1000)
      if (d <= step) {
        x = target.x; y = target.y; lastNodeId = target.nodeId
        order.idx++
        if (target.actions.length) dwell = 2   // linger where the order put actions
        if (order.idx >= order.nodes.length) {
          driving = false
          // mission order completed → report the load handled (PARK- nav orders don't)
          if (!String(order.orderId).startsWith('PARK-')) {
            finish('pick')
            setTimeout(() => finish('drop'), 1200)
          }
          console.log(`[fake-robot] order ${order.orderId} complete at ${lastNodeId}`)
        }
      } else {
        x += (dx / d) * step; y += (dy / d) * step
      }
    }
  }

  const remaining = order ? order.nodes.slice(order.idx) : []
  client.publish(t('state'), JSON.stringify({
    headerId: ++headerId, timestamp: new Date().toISOString(), version: '2.0.0',
    manufacturer: MFR, serialNumber: SERIAL,
    orderId: order?.orderId ?? '', orderUpdateId: 0,
    lastNodeId, lastNodeSequenceId: 0,
    driving, paused: false, operatingMode: 'AUTOMATIC',
    agvPosition: { x, y, theta: 0, mapId: 'live', positionInitialized: true, localizationScore: 0.99 },
    velocity: { vx: driving ? SPEED : 0, vy: 0, omega: 0 },
    batteryState: { batteryCharge: 82, charging: false, voltage: 48.1 },
    nodeStates: remaining.map(n => ({ nodeId: n.nodeId, released: true })),
    edgeStates: [], errors: [], information: [],
    actionStates,
    safetyState: { eStop: 'NONE', fieldViolation: false },
  }), { qos: 1 })
}

setInterval(tick, TICK)
