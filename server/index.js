/**
 * ATP-RMS-V2 backend API (Express, plain JS) — the integration boundary
 * between the React Digital-Twin UI and the `atp_rms` MySQL database.
 *
 *   POST   /api/auth/login   { username, password }  -> { token, user }
 *   GET    /api/auth/me                               -> { user }
 *   GET    /api/amrs                                  -> AmrConfig[]
 *   POST   /api/amrs          AmrConfig               -> AmrConfig
 *   PATCH  /api/amrs/:sn      Partial<AmrConfig>      -> AmrConfig
 *   DELETE /api/amrs/:sn                              -> { ok: true }
 *
 * Vite proxies /api -> http://localhost:8080 (see vite.config.ts).
 */
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const pool = require('./db')
const { signToken, requireAuth } = require('./auth')

const app = express()
app.use(cors())
app.use(express.json())

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error('[API]', err)
  res.status(500).json({ error: 'server error' })
})

// ── health ────────────────────────────────────────────────
app.get('/api/health', wrap(async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ ok: true })
}))

// ── auth ──────────────────────────────────────────────────
app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'username and password required' })

  const [rows] = await pool.query(
    'SELECT id, username, password, real_name, role, enabled FROM sys_user WHERE username = ? LIMIT 1',
    [username],
  )
  const user = rows[0]
  if (!user || !user.enabled) return res.status(401).json({ error: 'invalid credentials' })

  const ok = await bcrypt.compare(password, user.password)
  if (!ok) return res.status(401).json({ error: 'invalid credentials' })

  await pool.query('UPDATE sys_user SET last_login = NOW() WHERE id = ?', [user.id])
  res.json({ token: signToken(user), user: publicUser(user) })
}))

app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, username, real_name, role, enabled FROM sys_user WHERE id = ? LIMIT 1',
    [req.user.id],
  )
  const user = rows[0]
  if (!user || !user.enabled) return res.status(401).json({ error: 'account disabled' })
  res.json({ user: publicUser(user) })
}))

function publicUser(u) {
  return { id: String(u.id), username: u.username, realName: u.real_name, role: u.role, enabled: !!u.enabled }
}

// ── AMRs (backed by the `agv` table joined to `agv_type`) ──
const SELECT_AMR =
  `SELECT a.sn AS serial, a.name, t.code AS model, a.color, a.ip, a.enabled
     FROM agv a JOIN agv_type t ON a.agv_type_id = t.id`

function rowToAmr(r) {
  return { serial: r.serial, name: r.name, model: r.model, color: r.color, ip: r.ip || '', enabled: !!r.enabled }
}

app.get('/api/amrs', requireAuth, wrap(async (_req, res) => {
  const [rows] = await pool.query(`${SELECT_AMR} ORDER BY a.id`)
  res.json(rows.map(rowToAmr))
}))

app.post('/api/amrs', requireAuth, wrap(async (req, res) => {
  const { serial, name, model, color, ip, enabled } = req.body || {}
  if (!serial || !model) return res.status(400).json({ error: 'serial and model required' })

  const [types] = await pool.query('SELECT id FROM agv_type WHERE code = ? LIMIT 1', [model])
  if (!types[0]) return res.status(400).json({ error: `unknown model: ${model}` })

  const [exists] = await pool.query('SELECT id FROM agv WHERE sn = ? LIMIT 1', [serial])
  if (exists[0]) return res.status(409).json({ error: 'serial already registered' })

  await pool.query(
    `INSERT INTO agv (sn, name, agv_type_id, color, ip, enabled, status)
     VALUES (?, ?, ?, ?, ?, ?, 'OFFLINE')`,
    [serial, name || serial, types[0].id, color || '#00d4ff', ip || null, enabled === false ? 0 : 1],
  )
  const [rows] = await pool.query(`${SELECT_AMR} WHERE a.sn = ?`, [serial])
  res.status(201).json(rowToAmr(rows[0]))
}))

app.patch('/api/amrs/:sn', requireAuth, wrap(async (req, res) => {
  const sn = req.params.sn
  const { name, model, color, ip, enabled } = req.body || {}
  const sets = []
  const vals = []
  if (name !== undefined)  { sets.push('name = ?');  vals.push(name) }
  if (color !== undefined) { sets.push('color = ?'); vals.push(color) }
  if (ip !== undefined)    { sets.push('ip = ?');    vals.push(ip || null) }
  if (enabled !== undefined) { sets.push('enabled = ?'); vals.push(enabled ? 1 : 0) }
  if (model !== undefined) {
    const [types] = await pool.query('SELECT id FROM agv_type WHERE code = ? LIMIT 1', [model])
    if (!types[0]) return res.status(400).json({ error: `unknown model: ${model}` })
    sets.push('agv_type_id = ?'); vals.push(types[0].id)
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' })

  vals.push(sn)
  const [r] = await pool.query(`UPDATE agv SET ${sets.join(', ')} WHERE sn = ?`, vals)
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })

  const [rows] = await pool.query(`${SELECT_AMR} WHERE a.sn = ?`, [sn])
  res.json(rowToAmr(rows[0]))
}))

app.delete('/api/amrs/:sn', requireAuth, wrap(async (req, res) => {
  const [r] = await pool.query('DELETE FROM agv WHERE sn = ?', [req.params.sn])
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
}))

// ── Storage areas ─────────────────────────────────────────
function rowToStorage(r) {
  return {
    id: String(r.id), name: r.name, nodeId: r.node_id,
    mapId: r.map_id != null ? String(r.map_id) : null,
    kind: r.kind, state: r.state, label: r.label || '', enabled: !!r.enabled,
  }
}

app.get('/api/storages', requireAuth, wrap(async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM storage ORDER BY name')
  res.json(rows.map(rowToStorage))
}))

app.post('/api/storages', requireAuth, wrap(async (req, res) => {
  const { name, nodeId, kind, state, label, enabled } = req.body || {}
  if (!name || !nodeId) return res.status(400).json({ error: 'name and nodeId required' })
  const [exists] = await pool.query('SELECT id FROM storage WHERE name = ? LIMIT 1', [name])
  if (exists[0]) return res.status(409).json({ error: 'storage name already exists' })
  const [r] = await pool.query(
    `INSERT INTO storage (name, node_id, kind, state, label, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, nodeId, kind || 'BOTH', state || 'EMPTY', label || null, enabled === false ? 0 : 1],
  )
  const [rows] = await pool.query('SELECT * FROM storage WHERE id = ?', [r.insertId])
  res.status(201).json(rowToStorage(rows[0]))
}))

app.patch('/api/storages/:id', requireAuth, wrap(async (req, res) => {
  const { name, nodeId, kind, state, label, enabled } = req.body || {}
  const sets = [], vals = []
  if (name !== undefined)    { sets.push('name = ?');    vals.push(name) }
  if (nodeId !== undefined)  { sets.push('node_id = ?'); vals.push(nodeId) }
  if (kind !== undefined)    { sets.push('kind = ?');    vals.push(kind) }
  if (state !== undefined)   { sets.push('state = ?');   vals.push(state) }
  if (label !== undefined)   { sets.push('label = ?');   vals.push(label || null) }
  if (enabled !== undefined) { sets.push('enabled = ?'); vals.push(enabled ? 1 : 0) }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' })
  vals.push(req.params.id)
  const [r] = await pool.query(`UPDATE storage SET ${sets.join(', ')} WHERE id = ?`, vals)
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  const [rows] = await pool.query('SELECT * FROM storage WHERE id = ?', [req.params.id])
  res.json(rowToStorage(rows[0]))
}))

app.delete('/api/storages/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM storage_action WHERE storage_id = ?', [req.params.id])
  const [r] = await pool.query('DELETE FROM storage WHERE id = ?', [req.params.id])
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
}))

// ── VDA5050 action templates ──────────────────────────────
function rowToAction(r) {
  return {
    id: String(r.id), code: r.code, actionType: r.action_type, name: r.name || r.code,
    blockingType: r.blocking_type, description: r.description || '',
    defaultParams: asParams(r.default_params),
  }
}
// JSON columns come back parsed by mysql2 (sometimes as string) — normalize to [].
function asParams(v) {
  if (v == null) return []
  if (typeof v === 'string') { try { return JSON.parse(v) || [] } catch { return [] } }
  return Array.isArray(v) ? v : []
}

app.get('/api/actions', requireAuth, wrap(async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM vda_action ORDER BY id')
  res.json(rows.map(rowToAction))
}))

app.post('/api/actions', requireAuth, wrap(async (req, res) => {
  const { code, actionType, name, blockingType, description, defaultParams } = req.body || {}
  if (!code || !actionType) return res.status(400).json({ error: 'code and actionType required' })
  const [exists] = await pool.query('SELECT id FROM vda_action WHERE code = ? LIMIT 1', [code])
  if (exists[0]) return res.status(409).json({ error: 'action code already exists' })
  const [r] = await pool.query(
    `INSERT INTO vda_action (code, action_type, name, blocking_type, description, default_params)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [code, actionType, name || code, blockingType || 'HARD', description || null, JSON.stringify(defaultParams || [])],
  )
  const [rows] = await pool.query('SELECT * FROM vda_action WHERE id = ?', [r.insertId])
  res.status(201).json(rowToAction(rows[0]))
}))

app.patch('/api/actions/:id', requireAuth, wrap(async (req, res) => {
  const { actionType, name, blockingType, description, defaultParams } = req.body || {}
  const sets = [], vals = []
  if (actionType !== undefined)   { sets.push('action_type = ?');   vals.push(actionType) }
  if (name !== undefined)         { sets.push('name = ?');          vals.push(name) }
  if (blockingType !== undefined) { sets.push('blocking_type = ?'); vals.push(blockingType) }
  if (description !== undefined)  { sets.push('description = ?');   vals.push(description || null) }
  if (defaultParams !== undefined){ sets.push('default_params = ?');vals.push(JSON.stringify(defaultParams || [])) }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' })
  vals.push(req.params.id)
  const [r] = await pool.query(`UPDATE vda_action SET ${sets.join(', ')} WHERE id = ?`, vals)
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  const [rows] = await pool.query('SELECT * FROM vda_action WHERE id = ?', [req.params.id])
  res.json(rowToAction(rows[0]))
}))

app.delete('/api/actions/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM storage_action WHERE vda_action_id = ?', [req.params.id])
  const [r] = await pool.query('DELETE FROM vda_action WHERE id = ?', [req.params.id])
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
}))

// ── Storage → action bindings ─────────────────────────────
app.get('/api/storages/:id/actions', requireAuth, wrap(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM storage_action WHERE storage_id = ? ORDER BY stage, seq',
    [req.params.id],
  )
  res.json(rows.map(r => ({
    id: String(r.id), storageId: String(r.storage_id), actionId: String(r.vda_action_id),
    stage: r.stage, seq: r.seq, params: asParams(r.params),
  })))
}))

// Replace the full binding set for a storage in one call.
app.put('/api/storages/:id/actions', requireAuth, wrap(async (req, res) => {
  const storageId = req.params.id
  const bindings = Array.isArray(req.body) ? req.body : (req.body?.bindings || [])
  await pool.query('DELETE FROM storage_action WHERE storage_id = ?', [storageId])
  for (const b of bindings) {
    await pool.query(
      `INSERT INTO storage_action (storage_id, vda_action_id, stage, seq, params)
       VALUES (?, ?, ?, ?, ?)`,
      [storageId, b.actionId, b.stage, b.seq ?? 0, b.params ? JSON.stringify(b.params) : null],
    )
  }
  const [rows] = await pool.query(
    'SELECT * FROM storage_action WHERE storage_id = ? ORDER BY stage, seq', [storageId])
  res.json(rows.map(r => ({
    id: String(r.id), storageId: String(r.storage_id), actionId: String(r.vda_action_id),
    stage: r.stage, seq: r.seq, params: asParams(r.params),
  })))
}))

// ── Missions (pickup storage → dropoff storage) ───────────
const SELECT_MISSION =
  `SELECT m.*, ps.name AS pickup_name, ds.name AS dropoff_name
     FROM mission m
     LEFT JOIN storage ps ON m.pickup_storage_id = ps.id
     LEFT JOIN storage ds ON m.dropoff_storage_id = ds.id`

function rowToMission(r) {
  return {
    id: String(r.id), missionNo: r.mission_no, agvId: r.agv_id || null,
    type: r.type, status: r.status, priority: r.priority,
    startNode: r.start_node, endNode: r.end_node, progress: r.progress,
    pickupStorageId: r.pickup_storage_id != null ? String(r.pickup_storage_id) : null,
    dropoffStorageId: r.dropoff_storage_id != null ? String(r.dropoff_storage_id) : null,
    pickupStorageName: r.pickup_name || null,
    dropoffStorageName: r.dropoff_name || null,
    actions: asParams(r.actions),
    createdAt: r.created_at, assignedAt: r.assigned_at, startedAt: r.started_at, finishedAt: r.finished_at,
  }
}

// Build the resolved PICK/DROP action snapshot for a storage from its bindings.
async function resolveStageActions(storageId, stage) {
  const [rows] = await pool.query(
    `SELECT sa.params, sa.seq, va.action_type, va.blocking_type, va.description, va.default_params
       FROM storage_action sa JOIN vda_action va ON sa.vda_action_id = va.id
      WHERE sa.storage_id = ? AND sa.stage = ? ORDER BY sa.seq`,
    [storageId, stage],
  )
  return rows.map(r => ({
    stage,
    actionType: r.action_type,
    blockingType: r.blocking_type,
    description: r.description || '',
    params: asParams(r.params).length ? asParams(r.params) : asParams(r.default_params),
  }))
}

app.get('/api/missions', requireAuth, wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500)
  const status = req.query.status
  const where = status ? 'WHERE m.status = ?' : ''
  const args = status ? [status, limit] : [limit]
  const [rows] = await pool.query(`${SELECT_MISSION} ${where} ORDER BY m.id DESC LIMIT ?`, args)
  res.json(rows.map(rowToMission))
}))

app.post('/api/missions', requireAuth, wrap(async (req, res) => {
  const { pickupStorageId, dropoffStorageId, priority } = req.body || {}
  if (!pickupStorageId || !dropoffStorageId) return res.status(400).json({ error: 'pickupStorageId and dropoffStorageId required' })
  if (pickupStorageId === dropoffStorageId) return res.status(400).json({ error: 'pickup and dropoff must differ' })

  const [stores] = await pool.query('SELECT id, name, node_id FROM storage WHERE id IN (?, ?)', [pickupStorageId, dropoffStorageId])
  const pickup = stores.find(s => String(s.id) === String(pickupStorageId))
  const dropoff = stores.find(s => String(s.id) === String(dropoffStorageId))
  if (!pickup || !dropoff) return res.status(400).json({ error: 'unknown storage' })

  const actions = [
    ...(await resolveStageActions(pickup.id, 'PICK')),
    ...(await resolveStageActions(dropoff.id, 'DROP')),
  ]
  const missionNo = `MS-${Date.now().toString(36).toUpperCase()}`
  const [r] = await pool.query(
    `INSERT INTO mission (mission_no, type, status, priority, start_node, end_node, progress,
        pickup_storage_id, dropoff_storage_id, actions)
     VALUES (?, 'TRANSPORT', 'PENDING', ?, ?, ?, 0, ?, ?, ?)`,
    [missionNo, priority || 5, pickup.node_id, dropoff.node_id, pickup.id, dropoff.id, JSON.stringify(actions)],
  )
  const [rows] = await pool.query(`${SELECT_MISSION} WHERE m.id = ?`, [r.insertId])
  res.status(201).json(rowToMission(rows[0]))
}))

app.patch('/api/missions/:id', requireAuth, wrap(async (req, res) => {
  const { status, progress, agvId, assignedAt, startedAt, finishedAt } = req.body || {}
  const sets = [], vals = []
  if (status !== undefined)     { sets.push('status = ?');      vals.push(status) }
  if (progress !== undefined)   { sets.push('progress = ?');    vals.push(progress) }
  if (agvId !== undefined)      { sets.push('agv_id = ?');      vals.push(agvId) }
  if (assignedAt !== undefined) { sets.push('assigned_at = ?'); vals.push(toMysqlTs(assignedAt)) }
  if (startedAt !== undefined)  { sets.push('started_at = ?');  vals.push(toMysqlTs(startedAt)) }
  if (finishedAt !== undefined) { sets.push('finished_at = ?'); vals.push(toMysqlTs(finishedAt)) }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' })
  vals.push(req.params.id)
  const [r] = await pool.query(`UPDATE mission SET ${sets.join(', ')} WHERE id = ?`, vals)
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  const [rows] = await pool.query(`${SELECT_MISSION} WHERE m.id = ?`, [req.params.id])
  res.json(rowToMission(rows[0]))
}))

function toMysqlTs(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d) ? null : d.toISOString().slice(0, 19).replace('T', ' ')
}

const PORT = Number(process.env.PORT) || 8080
app.listen(PORT, () => console.log(`[ATP-RMS API] listening on http://localhost:${PORT}`))
