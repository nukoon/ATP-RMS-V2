/**
 * live-monitor.js — watch a live robot's VDA5050 stream on the seer-bridge and
 * print one-line events for bench observation: order received, driving start/
 * stop, new errors, and a 10 s telemetry summary while moving (state rate, avg/
 * max gap, speed from pose deltas, node). Used to measure update latency.
 *
 * Run:  node server/live-monitor.js
 * Env:  SERIAL=1  MFR=SEER  BASE=robot/v2  BROKER=mqtt://localhost:1883
 */
const mqtt = require('mqtt')

const SERIAL = process.env.SERIAL || '1'
const MFR    = process.env.MFR    || 'SEER'
const BASE   = process.env.BASE   || 'robot/v2'
const BROKER = process.env.BROKER || 'mqtt://localhost:1883'
const t = (s) => `${BASE}/${MFR}/${SERIAL}/${s}`
const log = (m) => console.log(`[${new Date().toLocaleTimeString('en-GB')}] ${m}`)

let last = null            // { ts, x, y }
let gaps = []              // ms between state msgs (window)
let dist = 0               // m moved since last summary
let wasDriving = false
let lastSummary = 0
const seenErrors = new Set()

const client = mqtt.connect(BROKER, { clientId: `live-monitor-${Date.now()}` })
client.on('connect', () => {
  client.subscribe([t('state'), t('order'), t('instantActions')], { qos: 1 })
  log(`monitoring ${t('#')} on ${BROKER}`)
})

client.on('message', (topic, payload) => {
  let m
  try { m = JSON.parse(payload.toString()) } catch { return }

  if (topic === t('order')) {
    const nodes = (m.nodes || []).map(n => n.nodeId)
    log(`ORDER ${m.orderId}: ${nodes.length} nodes  ${nodes[0]} → ${nodes[nodes.length - 1]}`)
    return
  }
  if (topic === t('instantActions')) {
    log(`INSTANT ${(m.actions || []).map(a => a.actionType).join(', ')}`)
    return
  }

  // state
  const now = Date.now()
  const p = m.agvPosition || {}
  if (last) {
    gaps.push(now - last.ts)
    if (gaps.length > 40) gaps.shift()
    const step = Math.hypot((p.x ?? 0) - last.x, (p.y ?? 0) - last.y)
    if (step < 5) dist += step
  }
  last = { ts: now, x: p.x ?? 0, y: p.y ?? 0 }

  if (m.driving && !wasDriving) { log(`DRIVING start — order ${m.orderId || '-'} from ${m.lastNodeId}`); lastSummary = now; dist = 0 }
  if (!m.driving && wasDriving) log(`STOPPED at ${m.lastNodeId} (${(p.x ?? 0).toFixed(2)}, ${(p.y ?? 0).toFixed(2)})  battery ${m.batteryState?.batteryCharge ?? '?'}%`)
  wasDriving = !!m.driving

  for (const e of m.errors || []) {
    const key = `${e.errorType}|${e.errorLevel}`
    if (!seenErrors.has(key)) { seenErrors.add(key); log(`ERROR ${e.errorLevel} ${e.errorType}: ${e.errorDescription || ''}`) }
  }

  if (m.driving && now - lastSummary >= 10_000 && gaps.length) {
    lastSummary = now
    const avg = gaps.reduce((s, x) => s + x, 0) / gaps.length
    const max = Math.max(...gaps)
    const speed = dist / 10
    // perceived display lag ≈ ease duration (1.4×gap) + half the sample age
    const lag = (avg * 1.4 + avg / 2) / 1000
    log(`state ${(1000 / avg).toFixed(1)} Hz (avg ${Math.round(avg)}ms, max ${Math.round(max)}ms) · ~${speed.toFixed(2)} m/s · node ${m.lastNodeId} · est. display lag ~${lag.toFixed(1)}s`)
    dist = 0
  }
})
