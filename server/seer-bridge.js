/**
 * seer-bridge.js — VDA5050 ⇄ SEER/AITEN-S broker bridge (WebSocket-capable aedes)
 *
 * The site's mosquitto was built WITHOUT websockets, so the browser had no
 * MQTT-over-WS endpoint at all. This process hosts its OWN aedes broker with a
 * WebSocket listener so the ATP-RMS-V2 dashboard (mqtt.js over WS) can connect,
 * and bridges it to the robot in one of two modes:
 *
 *   ┌─ MODE A — RoboVDA relay (DEFAULT)  ◄── the controller has the AITEN-S/SEER
 *   │   RoboVDA gateway flashed (web UI at http://<robot-ip>:5050). RoboVDA itself
 *   │   speaks full VDA5050 (state + the whole command path: order→GoTargetList,
 *   │   pick→ForkLoad, startCharging→SetDO, pause/resume, … per the AITEN-S manual
 *   │   §5–6). The bridge is then a PLAIN BROKER that just relays both directions —
 *   │   no SEER polling, no command translation here. This is the command-capable path.
 *   │
 *   │     RoboVDA (controller :5050) ──TCP MQTT──► [ aedes ] ◄──WS──► dashboard
 *   │         publishes …/state, …/connection         relay        publishes …/order
 *   │         subscribes …/order, …/instantActions     relay        subscribes …/state
 *   │
 *   └─ MODE B — native poll (`--poll`)  ◄── FALLBACK when there is NO RoboVDA gateway.
 *       The bridge polls the SEER controller's read-only status APIs (port 19204) and
 *       synthesizes a VDA5050 `state`. TELEMETRY ONLY — it does NOT translate
 *       order/instantActions, so the robot cannot be driven (this is why "state worked
 *       but order didn't" before: order was relayed to nobody). Don't run both modes —
 *       polled `state` and RoboVDA's `state` would fight on the same topic.
 *
 *         SEER .157:19204 ──poll──► [ aedes ] ──WS──► dashboard  (view only)
 *
 * Single-machine RMS: aedes is the ONE broker — TCP 0.0.0.0:1883 (RoboVDA + debug)
 * + WS :9001 (browser). Stop the legacy mosquitto/EMQX so :1883 is free for aedes.
 *
 * Run:  npm run seer-bridge          (MODE A, RoboVDA relay — command-capable, default)
 *       npm run seer-bridge:poll     (MODE B, native poll — telemetry only, no gateway)
 * Flags: --relay (force MODE A) · --poll (force MODE B).  Env mirrors (all optional):
 *   POLL=on                   force native polling (MODE B)
 *   SEER_HOST=192.168.1.157   SEER controller IP            (MODE B only)
 *   SEER_PORT=19204           status/query port             (MODE B only)
 *   SEER_SERIAL=AMB-01        VDA5050 serialNumber           (MODE B only; must equal the
 *                             dashboard AMR serial. In MODE A the serial comes from
 *                             RoboVDA's config.ini [topic] — register that serial instead.)
 *   WS_PORT=9001              browser MQTT-over-WebSocket listener
 *   TCP_PORT=1883             MQTT/TCP listener (RoboVDA mqtt_host → this host:1883)
 *   ROBOVDA_BIND=             extra TCP listen IP (only if something else holds :1883)
 *   ROBOVDA_PORT=1883         …and its port
 *   MQTT_BASE=robot/v2        topic prefix (SEER/AITEN brand preset)   (MODE B only)
 *   MQTT_MFR=SEER             manufacturer segment                     (MODE B only)
 *   POLL_MS=400               status poll interval                     (MODE B only)
 *
 * Dashboard config: brand SEER, broker ws://<bridge-host>:9001, AMR serial = the
 * controller's serialNumber (MODE A: RoboVDA config.ini; MODE B: SEER_SERIAL).
 */
const net = require('net')
const { Aedes } = require('aedes')
const { WebSocketServer, createWebSocketStream } = require('ws')

// Mode: relay (POLL off, RoboVDA does state+commands) is the DEFAULT now that the
// controller has RoboVDA. `--poll` (or POLL=on) re-enables native telemetry-only
// polling for a robot with no gateway. argv flags win over env (easier on Windows).
const argv = process.argv.slice(2)
const POLL = argv.includes('--poll') ? true
           : argv.includes('--relay') ? false
           : process.env.POLL === 'on'   // default: OFF (relay)

const SEER_HOST = process.env.SEER_HOST || '192.168.1.157'
const SEER_PORT = Number(process.env.SEER_PORT || 19204)
const SERIAL    = process.env.SEER_SERIAL || 'AMB-01'
const WS_PORT   = Number(process.env.WS_PORT || 9001)
// One broker for the whole single-machine RMS: TCP 1883 (RoboVDA + debug, 0.0.0.0)
// + WS 9001 (browser). Stop the legacy mosquitto/EMQX so aedes owns 1883.
const TCP_PORT  = Number(process.env.TCP_PORT || 1883)
const BASE      = process.env.MQTT_BASE || 'robot/v2'
const MFR       = process.env.MQTT_MFR || 'SEER'
const POLL_MS   = Number(process.env.POLL_MS || 400)
// Optional second TCP listener on a specific IP/port — only needed if something
// else holds 0.0.0.0:TCP_PORT. Off by default (the main 1883 listener covers RoboVDA).
const ROBOVDA_BIND = process.env.ROBOVDA_BIND ?? ''
const ROBOVDA_PORT = Number(process.env.ROBOVDA_PORT || 1883)

const topic = (t) => `${BASE}/${MFR}/${SERIAL}/${t}`

// SEER native API numbers (port 19204, read-only status queries)
const API = { LOC: 1004, BATTERY: 1007, NAV: 1020 }

// ── SEER native protocol framing ─────────────────────────────────────────────
// 16-byte big-endian header [0x5A | 0x01 ver | u16 serial | u32 bodyLen | u16 api | 6B rsv]
// + optional JSON body. Response echoes the same header shape + JSON body.
function buildReq(apiType, body = '') {
  const bodyBuf = Buffer.from(body, 'ascii')
  const h = Buffer.alloc(16)
  h[0] = 0x5a; h[1] = 0x01
  h.writeUInt16BE(1, 2)
  h.writeUInt32BE(bodyBuf.length, 4)
  h.writeUInt16BE(apiType, 8)
  return Buffer.concat([h, bodyBuf])
}

// One short-lived request/response. Resolves the parsed JSON body (or rejects).
function seerQuery(apiType, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SEER_PORT, SEER_HOST)
    const chunks = []
    let settled = false
    const done = (err, val) => {
      if (settled) return
      settled = true
      sock.destroy()
      err ? reject(err) : resolve(val)
    }
    sock.setTimeout(timeoutMs)
    sock.on('connect', () => sock.write(buildReq(apiType)))
    sock.on('data', (d) => {
      chunks.push(d)
      const all = Buffer.concat(chunks)
      if (all.length < 16) return
      const bodyLen = all.readUInt32BE(4)
      if (all.length < 16 + bodyLen) return
      try { done(null, JSON.parse(all.slice(16, 16 + bodyLen).toString('utf8'))) }
      catch (e) { done(e) }
    })
    sock.on('timeout', () => done(new Error('timeout')))
    sock.on('error', (e) => done(e))
  })
}

// ── SEER → VDA5050 state mapping ─────────────────────────────────────────────
// SEER task_status: 0 NONE 1 WAITING 2 RUNNING 3 SUSPENDED 4 COMPLETED 5 FAILED 6 CANCELED
function toVda5050(loc, bat, nav) {
  const driving = nav?.task_status === 2
  const upcoming = Array.isArray(nav?.unfinished_path) ? nav.unfinished_path : []
  return {
    headerId: Date.now() % 100000,
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    manufacturer: MFR,
    serialNumber: SERIAL,
    // theta stays in RADIANS — the dashboard's mqtt.service converts rad→deg.
    agvPosition: {
      x: loc?.x ?? 0,
      y: loc?.y ?? 0,
      theta: loc?.angle ?? 0,
      mapId: loc?.current_map || 'live',
      positionInitialized: true,
      localizationScore: loc?.confidence ?? 0,
    },
    velocity: { vx: 0, vy: 0, omega: 0 },
    batteryState: {
      batteryCharge: Math.round((bat?.battery_level ?? 0) * 100), // 0–1 → 0–100 %
      charging: !!bat?.charging,
      voltage: bat?.voltage,
    },
    driving,
    paused: nav?.task_status === 3,
    operatingMode: 'AUTOMATIC',         // deriveStatus() refines to IDLE/EXECUTING/CHARGING/ERROR
    lastNodeId: loc?.current_station || nav?.target_id || '',
    nodeStates: upcoming.map((id) => ({ nodeId: id, released: true })),
    errors: [],
  }
}

// ── embedded MQTT broker (aedes): TCP + WebSocket ────────────────────────────
let aedes = null

function publish(t, obj, retain = false) {
  if (!aedes) return
  aedes.publish({ topic: topic(t), payload: JSON.stringify(obj), qos: 1, retain })
}

let robotOnline = null   // tri-state so we only publish connection changes
function setOnline(online) {
  if (online === robotOnline) return
  robotOnline = online
  publish('connection', {
    headerId: Date.now() % 100000, timestamp: new Date().toISOString(),
    version: '2.0.0', manufacturer: MFR, serialNumber: SERIAL,
    connectionState: online ? 'ONLINE' : 'CONNECTIONBROKEN',
  }, true)
  console.log(`[seer-bridge] robot ${SERIAL} ${online ? 'ONLINE' : 'OFFLINE'}`)
}

// ── poll loop ────────────────────────────────────────────────────────────────
let polling = false
async function poll() {
  if (polling) return
  polling = true
  try {
    // Query sequentially — the SEER 19204 status port is unreliable with
    // several concurrent connections from one client (parallel = timeouts).
    const loc = await seerQuery(API.LOC)
    const bat = await seerQuery(API.BATTERY)
    const nav = await seerQuery(API.NAV)
    setOnline(true)
    publish('state', toVda5050(loc, bat, nav))
  } catch {
    setOnline(false)        // only the ONLINE→OFFLINE edge logs (setOnline)
  } finally {
    polling = false
  }
}

async function main() {
  aedes = await Aedes.createBroker()
  aedes.on('subscribe', (subs, c) =>
    console.log(`[seer-bridge] ${c?.id} subscribed: ${subs.map(s => s.topic).join(', ')}`))
  aedes.on('client', (c) => console.log(`[seer-bridge] client connected: ${c.id}`))
  aedes.on('clientDisconnect', (c) => console.log(`[seer-bridge] client gone: ${c.id}`))
  // log inbound app→robot traffic (order / instantActions) and any external state feed (RoboVDA)
  aedes.on('publish', (pkt, c) => {
    if (!c) return  // skip our own aedes.publish() (client is null)
    if (/\/(order|instantActions|state|connection)$/.test(pkt.topic))
      console.log(`[seer-bridge] ⇐ ${c.id} → ${pkt.topic} (${pkt.payload.length}b)`)
  })

  // A port clash (e.g. another bridge already running) should warn, not crash the
  // whole process — otherwise a single busy port takes down every listener.
  const die = (label) => (e) => {
    if (e.code === 'EADDRINUSE') { console.error(`[seer-bridge] ${label} port in use — is another bridge already running? (${e.address}:${e.port})`); process.exit(1) }
    console.error(`[seer-bridge] ${label} error:`, e); process.exit(1)
  }
  net.createServer(aedes.handle)
    .on('error', die('MQTT tcp'))
    .listen(TCP_PORT, () => console.log(`[seer-bridge] MQTT (tcp) listening on 0.0.0.0:${TCP_PORT}  ◄── RoboVDA (mqtt_host=<this-host>) + debug`))
  // optional extra listener on a specific IP/port — only if something else holds
  // 0.0.0.0:TCP_PORT. Off unless ROBOVDA_BIND is set; non-fatal if the bind fails.
  if (ROBOVDA_BIND) {
    const roboSrv = net.createServer(aedes.handle)
    roboSrv.on('error', (e) => console.warn(`[seer-bridge] RoboVDA listener ${ROBOVDA_BIND}:${ROBOVDA_PORT} not bound: ${e.code}`))
    roboSrv.listen(ROBOVDA_PORT, ROBOVDA_BIND, () =>
      console.log(`[seer-bridge] MQTT (tcp) extra listener on ${ROBOVDA_BIND}:${ROBOVDA_PORT}`))
  }
  const wss = new WebSocketServer({ port: WS_PORT })
  wss.on('error', die('MQTT ws'))
  wss.on('connection', (socket) => aedes.handle(createWebSocketStream(socket)))
  wss.on('listening', () => console.log(`[seer-bridge] MQTT (ws) listening on ws://localhost:${WS_PORT}`))

  console.log(`[seer-bridge] native polling: ${POLL ? `ON (${POLL_MS}ms)` : 'OFF (RoboVDA is the state source)'} → ${SERIAL}`)
  console.log(`[seer-bridge] dashboard: brand SEER · broker ws://localhost:${WS_PORT} · AMR serial ${SERIAL}`)
  const timer = POLL ? setInterval(poll, POLL_MS) : null

  const shutdown = () => {
    clearInterval(timer)
    if (POLL) setOnline(false)   // mode A: RoboVDA owns …/connection (its own LWT) — don't fake it
    setTimeout(() => process.exit(0), 300)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e) => { console.error('[seer-bridge] fatal:', e); process.exit(1) })
