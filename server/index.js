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
const { signToken, requireAuth, requireRole } = require('./auth')

const app = express()
app.use(cors())
app.use(express.json())

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error('[API]', err)
  res.status(500).json({ error: 'server error' })
})

// ── multi-user sync: bump a global revision after every successful change to
// shared data, so other clients can poll /api/sync and auto-refresh. One place
// (res 'finish') instead of sprinkling calls through every mutating handler.
const SYNC_PATHS = /^\/api\/(storages|areas|docks|devices|traffic-areas|actions|missions|config)/
async function bumpSync(req) {
  const who = (req.user && (req.user.realName || req.user.username)) || null
  const scope = (req.path.split('/')[2] || 'data').replace('traffic-areas', 'traffic')
  await pool.query('UPDATE sync_state SET rev = rev + 1, scope = ?, updated_by = ? WHERE id = 1', [scope, who])
}
app.use((req, res, next) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && SYNC_PATHS.test(req.path)) {
    res.on('finish', () => { if (res.statusCode < 400) bumpSync(req).catch(() => {}) })
  }
  next()
})

// Optional ?mapId= filter so facility data is scoped to a single map.
const mapWhere = (req) => req.query.mapId ? { sql: ' WHERE map_id = ?', args: [req.query.mapId] } : { sql: '', args: [] }

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
  return {
    id: String(u.id), username: u.username, realName: u.real_name, role: u.role,
    enabled: !!u.enabled, lastLogin: u.last_login || null,
  }
}

// ── User management (ADMIN only) ──────────────────────────
const ROLES = ['ADMIN', 'OPERATOR', 'VIEWER']

app.get('/api/users', requireAuth, requireRole('ADMIN'), wrap(async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT id, username, real_name, role, enabled, last_login FROM sys_user ORDER BY username',
  )
  res.json(rows.map(publicUser))
}))

app.post('/api/users', requireAuth, requireRole('ADMIN'), wrap(async (req, res) => {
  const { username, password, realName, role, enabled } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'username and password required' })
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${ROLES.join('/')}` })
  const [exists] = await pool.query('SELECT id FROM sys_user WHERE username = ? LIMIT 1', [username])
  if (exists[0]) return res.status(409).json({ error: 'username already exists' })
  const hash = bcrypt.hashSync(password, 10)
  const [r] = await pool.query(
    'INSERT INTO sys_user (username, password, real_name, role, enabled) VALUES (?, ?, ?, ?, ?)',
    [username, hash, realName || username, role || 'VIEWER', enabled === false ? 0 : 1],
  )
  const [rows] = await pool.query('SELECT id, username, real_name, role, enabled, last_login FROM sys_user WHERE id = ?', [r.insertId])
  res.status(201).json(publicUser(rows[0]))
}))

app.patch('/api/users/:id', requireAuth, requireRole('ADMIN'), wrap(async (req, res) => {
  const id = req.params.id
  const { username, password, realName, role, enabled } = req.body || {}
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${ROLES.join('/')}` })

  // guard: don't let the last enabled ADMIN demote/disable themselves into lockout
  if (role !== undefined || enabled !== undefined) {
    const [cur] = await pool.query('SELECT role, enabled FROM sys_user WHERE id = ? LIMIT 1', [id])
    if (cur[0] && cur[0].role === 'ADMIN' && cur[0].enabled) {
      const losingAdmin = (role !== undefined && role !== 'ADMIN') || enabled === false
      if (losingAdmin) {
        const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM sys_user WHERE role = 'ADMIN' AND enabled = 1")
        if (n <= 1) return res.status(400).json({ error: 'cannot remove the last active admin' })
      }
    }
  }

  const sets = [], vals = []
  if (username !== undefined) { sets.push('username = ?');  vals.push(username) }
  if (realName !== undefined) { sets.push('real_name = ?'); vals.push(realName || null) }
  if (role !== undefined)     { sets.push('role = ?');      vals.push(role) }
  if (enabled !== undefined)  { sets.push('enabled = ?');   vals.push(enabled ? 1 : 0) }
  if (password)               { sets.push('password = ?');  vals.push(bcrypt.hashSync(password, 10)) }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' })
  vals.push(id)
  const [r] = await pool.query(`UPDATE sys_user SET ${sets.join(', ')} WHERE id = ?`, vals)
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  const [rows] = await pool.query('SELECT id, username, real_name, role, enabled, last_login FROM sys_user WHERE id = ?', [id])
  res.json(publicUser(rows[0]))
}))

app.delete('/api/users/:id', requireAuth, requireRole('ADMIN'), wrap(async (req, res) => {
  const id = req.params.id
  if (String(id) === String(req.user.id)) return res.status(400).json({ error: 'cannot delete yourself' })
  const [cur] = await pool.query('SELECT role, enabled FROM sys_user WHERE id = ? LIMIT 1', [id])
  if (cur[0] && cur[0].role === 'ADMIN' && cur[0].enabled) {
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM sys_user WHERE role = 'ADMIN' AND enabled = 1")
    if (n <= 1) return res.status(400).json({ error: 'cannot delete the last active admin' })
  }
  const [r] = await pool.query('DELETE FROM sys_user WHERE id = ?', [id])
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
}))

// ── Sync revision (clients poll to auto-refresh on concurrent edits) ──
app.get('/api/sync', requireAuth, wrap(async (_req, res) => {
  const [rows] = await pool.query('SELECT rev, scope, updated_by, updated_at FROM sync_state WHERE id = 1')
  const r = rows[0] || { rev: 0 }
  res.json({ rev: Number(r.rev), scope: r.scope || null, updatedBy: r.updated_by || null, updatedAt: r.updated_at || null })
}))

// ── Shared app config (server-saved, so every operator sees the same setup) ──
app.get('/api/config', requireAuth, wrap(async (_req, res) => {
  const [rows] = await pool.query('SELECT k, v FROM app_config')
  const out = {}
  for (const r of rows) out[r.k] = typeof r.v === 'string' ? JSON.parse(r.v) : r.v
  res.json(out)
}))

app.put('/api/config/:key', requireAuth, requireRole('OPERATOR'), wrap(async (req, res) => {
  const key = req.params.key
  const value = req.body && Object.prototype.hasOwnProperty.call(req.body, 'value') ? req.body.value : req.body
  const who = actorOf(req)
  await pool.query(
    'INSERT INTO app_config (k, v, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v), updated_by = VALUES(updated_by)',
    [key, JSON.stringify(value ?? null), who],
  )
  res.json({ ok: true, key })
}))

// ── AMRs (backed by the `agv` table joined to `agv_type`) ──
const SELECT_AMR =
  `SELECT a.sn AS serial, a.name, t.code AS model, a.color, a.brand, a.ip, a.enabled,
          a.low_battery, a.resume_battery, a.charge_target, a.park_node, a.charge_node
     FROM agv a JOIN agv_type t ON a.agv_type_id = t.id`

const numOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
function rowToAmr(r) {
  return {
    serial: r.serial, name: r.name, model: r.model, color: r.color, brand: r.brand || 'aiten',
    ip: r.ip || '', enabled: !!r.enabled,
    lowBattery: r.low_battery, resumeBattery: r.resume_battery, chargeTarget: r.charge_target,
    parkNode: r.park_node || null, chargeNode: r.charge_node || null,
  }
}

app.get('/api/amrs', requireAuth, wrap(async (_req, res) => {
  const [rows] = await pool.query(`${SELECT_AMR} ORDER BY a.id`)
  res.json(rows.map(rowToAmr))
}))

app.post('/api/amrs', requireAuth, wrap(async (req, res) => {
  const { serial, name, model, color, brand, ip, enabled, lowBattery, resumeBattery, chargeTarget, parkNode, chargeNode } = req.body || {}
  if (!serial || !model) return res.status(400).json({ error: 'serial and model required' })

  const [types] = await pool.query('SELECT id FROM agv_type WHERE code = ? LIMIT 1', [model])
  if (!types[0]) return res.status(400).json({ error: `unknown model: ${model}` })

  const [exists] = await pool.query('SELECT id FROM agv WHERE sn = ? LIMIT 1', [serial])
  if (exists[0]) return res.status(409).json({ error: 'serial already registered' })

  await pool.query(
    `INSERT INTO agv (sn, name, agv_type_id, color, brand, ip, enabled, low_battery, resume_battery, charge_target, park_node, charge_node, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OFFLINE')`,
    [serial, name || serial, types[0].id, color || '#00d4ff', brand || 'aiten', ip || null, enabled === false ? 0 : 1,
     numOrNull(lowBattery), numOrNull(resumeBattery), numOrNull(chargeTarget), parkNode || null, chargeNode || null],
  )
  const [rows] = await pool.query(`${SELECT_AMR} WHERE a.sn = ?`, [serial])
  res.status(201).json(rowToAmr(rows[0]))
}))

app.patch('/api/amrs/:sn', requireAuth, wrap(async (req, res) => {
  const sn = req.params.sn
  const { name, model, color, brand, ip, enabled, lowBattery, resumeBattery, chargeTarget, parkNode, chargeNode } = req.body || {}
  const sets = []
  const vals = []
  if (name !== undefined)  { sets.push('name = ?');  vals.push(name) }
  if (color !== undefined) { sets.push('color = ?'); vals.push(color) }
  if (brand !== undefined) { sets.push('brand = ?'); vals.push(brand || 'aiten') }
  if (ip !== undefined)    { sets.push('ip = ?');    vals.push(ip || null) }
  if (enabled !== undefined) { sets.push('enabled = ?'); vals.push(enabled ? 1 : 0) }
  if (lowBattery !== undefined)    { sets.push('low_battery = ?');    vals.push(numOrNull(lowBattery)) }
  if (resumeBattery !== undefined) { sets.push('resume_battery = ?'); vals.push(numOrNull(resumeBattery)) }
  if (chargeTarget !== undefined)  { sets.push('charge_target = ?');  vals.push(numOrNull(chargeTarget)) }
  if (parkNode !== undefined)      { sets.push('park_node = ?');      vals.push(parkNode || null) }
  if (chargeNode !== undefined)    { sets.push('charge_node = ?');    vals.push(chargeNode || null) }
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
    areaId: r.area_id != null ? String(r.area_id) : null,
    kind: r.kind, state: r.state, label: r.label || '', enabled: !!r.enabled,
  }
}

app.get('/api/storages', requireAuth, wrap(async (req, res) => {
  const w = mapWhere(req)
  const [rows] = await pool.query(`SELECT * FROM storage${w.sql} ORDER BY name`, w.args)
  res.json(rows.map(rowToStorage))
}))

app.post('/api/storages', requireAuth, wrap(async (req, res) => {
  const { name, nodeId, kind, state, label, enabled, areaId, mapId } = req.body || {}
  if (!name || !nodeId) return res.status(400).json({ error: 'name and nodeId required' })
  // name + node uniqueness are scoped to the map (different maps are independent)
  const [exists] = await pool.query('SELECT id FROM storage WHERE name = ? AND map_id <=> ? LIMIT 1', [name, mapId || null])
  if (exists[0]) return res.status(409).json({ error: 'storage name already exists on this map' })
  const [nodeUsed] = await pool.query('SELECT name FROM storage WHERE node_id = ? AND map_id <=> ? LIMIT 1', [nodeId, mapId || null])
  if (nodeUsed[0]) return res.status(409).json({ error: `node ${nodeId} already has a storage (${nodeUsed[0].name})` })
  const [r] = await pool.query(
    `INSERT INTO storage (name, node_id, area_id, kind, state, label, enabled, map_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, nodeId, areaId || null, kind || 'BOTH', state || 'EMPTY', label || null, enabled === false ? 0 : 1, mapId || null],
  )
  const [rows] = await pool.query('SELECT * FROM storage WHERE id = ?', [r.insertId])
  res.status(201).json(rowToStorage(rows[0]))
}))

app.patch('/api/storages/:id', requireAuth, wrap(async (req, res) => {
  const { name, nodeId, kind, state, label, enabled, areaId } = req.body || {}
  if (nodeId !== undefined) {
    const [used] = await pool.query(
      'SELECT name FROM storage WHERE node_id = ? AND id <> ? AND map_id <=> (SELECT map_id FROM storage WHERE id = ?) LIMIT 1',
      [nodeId, req.params.id, req.params.id])
    if (used[0]) return res.status(409).json({ error: `node ${nodeId} already has a storage (${used[0].name})` })
  }
  const sets = [], vals = []
  if (name !== undefined)    { sets.push('name = ?');    vals.push(name) }
  if (nodeId !== undefined)  { sets.push('node_id = ?'); vals.push(nodeId) }
  if (areaId !== undefined)  { sets.push('area_id = ?'); vals.push(areaId || null) }
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

// ── Storage areas (batch pickup/drop grouping) ────────────
function rowToArea(r) {
  return {
    id: String(r.id), name: r.name, kind: r.kind,
    mapId: r.map_id != null ? String(r.map_id) : null, enabled: !!r.enabled,
  }
}

app.get('/api/areas', requireAuth, wrap(async (req, res) => {
  const w = mapWhere(req)
  const [rows] = await pool.query(`SELECT * FROM storage_area${w.sql} ORDER BY name`, w.args)
  res.json(rows.map(rowToArea))
}))

app.post('/api/areas', requireAuth, wrap(async (req, res) => {
  const { name, kind, enabled, mapId } = req.body || {}
  if (!name) return res.status(400).json({ error: 'name required' })
  const [exists] = await pool.query('SELECT id FROM storage_area WHERE name = ? AND map_id <=> ? LIMIT 1', [name, mapId || null])
  if (exists[0]) return res.status(409).json({ error: 'area name already exists on this map' })
  const [r] = await pool.query(
    'INSERT INTO storage_area (name, kind, enabled, map_id) VALUES (?, ?, ?, ?)',
    [name, kind || 'BOTH', enabled === false ? 0 : 1, mapId || null],
  )
  const [rows] = await pool.query('SELECT * FROM storage_area WHERE id = ?', [r.insertId])
  res.status(201).json(rowToArea(rows[0]))
}))

app.patch('/api/areas/:id', requireAuth, wrap(async (req, res) => {
  const { name, kind, enabled } = req.body || {}
  const sets = [], vals = []
  if (name !== undefined)    { sets.push('name = ?');    vals.push(name) }
  if (kind !== undefined)    { sets.push('kind = ?');    vals.push(kind) }
  if (enabled !== undefined) { sets.push('enabled = ?'); vals.push(enabled ? 1 : 0) }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' })
  vals.push(req.params.id)
  const [r] = await pool.query(`UPDATE storage_area SET ${sets.join(', ')} WHERE id = ?`, vals)
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  const [rows] = await pool.query('SELECT * FROM storage_area WHERE id = ?', [req.params.id])
  res.json(rowToArea(rows[0]))
}))

app.delete('/api/areas/:id', requireAuth, wrap(async (req, res) => {
  // orphan members rather than deleting the storages
  await pool.query('UPDATE storage SET area_id = NULL WHERE area_id = ?', [req.params.id])
  const [r] = await pool.query('DELETE FROM storage_area WHERE id = ?', [req.params.id])
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
}))

// ── Docks (parking & charging points) ─────────────────────
function rowToDock(r) {
  return {
    id: String(r.id), name: r.name, nodeId: r.node_id, type: r.type,
    agvId: r.agv_id || null,
    mapId: r.map_id != null ? String(r.map_id) : null, enabled: !!r.enabled,
  }
}

app.get('/api/docks', requireAuth, wrap(async (req, res) => {
  const w = mapWhere(req)
  const [rows] = await pool.query(`SELECT * FROM dock${w.sql} ORDER BY type, name`, w.args)
  res.json(rows.map(rowToDock))
}))

app.post('/api/docks', requireAuth, wrap(async (req, res) => {
  const { name, nodeId, type, agvId, enabled, mapId } = req.body || {}
  if (!name || !nodeId) return res.status(400).json({ error: 'name and nodeId required' })
  const [r] = await pool.query(
    'INSERT INTO dock (name, node_id, type, agv_id, enabled, map_id) VALUES (?, ?, ?, ?, ?, ?)',
    [name, nodeId, type || 'PARK', agvId || null, enabled === false ? 0 : 1, mapId || null],
  )
  const [rows] = await pool.query('SELECT * FROM dock WHERE id = ?', [r.insertId])
  res.status(201).json(rowToDock(rows[0]))
}))

app.patch('/api/docks/:id', requireAuth, wrap(async (req, res) => {
  const { name, nodeId, type, agvId, enabled } = req.body || {}
  const sets = [], vals = []
  if (name !== undefined)    { sets.push('name = ?');    vals.push(name) }
  if (nodeId !== undefined)  { sets.push('node_id = ?'); vals.push(nodeId) }
  if (type !== undefined)    { sets.push('type = ?');    vals.push(type) }
  if (agvId !== undefined)   { sets.push('agv_id = ?');  vals.push(agvId || null) }
  if (enabled !== undefined) { sets.push('enabled = ?'); vals.push(enabled ? 1 : 0) }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' })
  vals.push(req.params.id)
  const [r] = await pool.query(`UPDATE dock SET ${sets.join(', ')} WHERE id = ?`, vals)
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  const [rows] = await pool.query('SELECT * FROM dock WHERE id = ?', [req.params.id])
  res.json(rowToDock(rows[0]))
}))

app.delete('/api/docks/:id', requireAuth, wrap(async (req, res) => {
  const [r] = await pool.query('DELETE FROM dock WHERE id = ?', [req.params.id])
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
}))

// ── Field devices (doors / traffic lights / lifts / … bound to a map node) ──
function rowToDevice(r) {
  let config = null
  if (r.config != null) { try { config = typeof r.config === 'string' ? JSON.parse(r.config) : r.config } catch { config = null } }
  return {
    id: String(r.id), name: r.name, type: r.type, nodeId: r.node_id,
    state: r.state || null, config,
    mapId: r.map_id != null ? String(r.map_id) : null, enabled: !!r.enabled,
  }
}

app.get('/api/devices', requireAuth, wrap(async (req, res) => {
  const w = mapWhere(req)
  const [rows] = await pool.query(`SELECT * FROM field_device${w.sql} ORDER BY type, name`, w.args)
  res.json(rows.map(rowToDevice))
}))

app.post('/api/devices', requireAuth, requireRole('OPERATOR'), wrap(async (req, res) => {
  const { name, type, nodeId, state, enabled, config, mapId } = req.body || {}
  if (!name || !nodeId) return res.status(400).json({ error: 'name and nodeId required' })
  const [r] = await pool.query(
    'INSERT INTO field_device (name, type, node_id, state, config, enabled, map_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, type || 'DOOR', nodeId, state || null, config ? JSON.stringify(config) : null, enabled === false ? 0 : 1, mapId || null],
  )
  const [rows] = await pool.query('SELECT * FROM field_device WHERE id = ?', [r.insertId])
  res.status(201).json(rowToDevice(rows[0]))
}))

app.patch('/api/devices/:id', requireAuth, requireRole('OPERATOR'), wrap(async (req, res) => {
  const { name, type, nodeId, state, enabled, config } = req.body || {}
  const sets = [], vals = []
  if (name !== undefined)    { sets.push('name = ?');    vals.push(name) }
  if (type !== undefined)    { sets.push('type = ?');    vals.push(type) }
  if (nodeId !== undefined)  { sets.push('node_id = ?'); vals.push(nodeId) }
  if (state !== undefined)   { sets.push('state = ?');   vals.push(state || null) }
  if (enabled !== undefined) { sets.push('enabled = ?'); vals.push(enabled ? 1 : 0) }
  if (config !== undefined)  { sets.push('config = ?');  vals.push(config ? JSON.stringify(config) : null) }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' })
  vals.push(req.params.id)
  const [r] = await pool.query(`UPDATE field_device SET ${sets.join(', ')} WHERE id = ?`, vals)
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  const [rows] = await pool.query('SELECT * FROM field_device WHERE id = ?', [req.params.id])
  res.json(rowToDevice(rows[0]))
}))

app.delete('/api/devices/:id', requireAuth, requireRole('OPERATOR'), wrap(async (req, res) => {
  const [r] = await pool.query('DELETE FROM field_device WHERE id = ?', [req.params.id])
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
}))

// ── Traffic areas (operator-defined mutual-exclusion zones) ──
function rowToTrafficArea(r) {
  return {
    id: String(r.id), name: r.name, nodeIds: asParams(r.node_ids), capacity: r.capacity,
    mapId: r.map_id != null ? String(r.map_id) : null, enabled: !!r.enabled,
  }
}

app.get('/api/traffic-areas', requireAuth, wrap(async (req, res) => {
  const w = mapWhere(req)
  const [rows] = await pool.query(`SELECT * FROM traffic_area${w.sql} ORDER BY name`, w.args)
  res.json(rows.map(rowToTrafficArea))
}))

app.post('/api/traffic-areas', requireAuth, wrap(async (req, res) => {
  const { name, nodeIds, capacity, enabled, mapId } = req.body || {}
  if (!name || !Array.isArray(nodeIds) || !nodeIds.length) return res.status(400).json({ error: 'name and nodeIds required' })
  const [exists] = await pool.query('SELECT id FROM traffic_area WHERE name = ? AND map_id <=> ? LIMIT 1', [name, mapId || null])
  if (exists[0]) return res.status(409).json({ error: 'traffic area name already exists on this map' })
  const [r] = await pool.query(
    'INSERT INTO traffic_area (name, node_ids, capacity, enabled, map_id) VALUES (?, ?, ?, ?, ?)',
    [name, JSON.stringify(nodeIds), capacity || 1, enabled === false ? 0 : 1, mapId || null],
  )
  const [rows] = await pool.query('SELECT * FROM traffic_area WHERE id = ?', [r.insertId])
  res.status(201).json(rowToTrafficArea(rows[0]))
}))

app.patch('/api/traffic-areas/:id', requireAuth, wrap(async (req, res) => {
  const { name, nodeIds, capacity, enabled } = req.body || {}
  const sets = [], vals = []
  if (name !== undefined)     { sets.push('name = ?');     vals.push(name) }
  if (nodeIds !== undefined)  { sets.push('node_ids = ?'); vals.push(JSON.stringify(nodeIds)) }
  if (capacity !== undefined) { sets.push('capacity = ?'); vals.push(capacity) }
  if (enabled !== undefined)  { sets.push('enabled = ?');  vals.push(enabled ? 1 : 0) }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' })
  vals.push(req.params.id)
  const [r] = await pool.query(`UPDATE traffic_area SET ${sets.join(', ')} WHERE id = ?`, vals)
  if (!r.affectedRows) return res.status(404).json({ error: 'not found' })
  const [rows] = await pool.query('SELECT * FROM traffic_area WHERE id = ?', [req.params.id])
  res.json(rowToTrafficArea(rows[0]))
}))

app.delete('/api/traffic-areas/:id', requireAuth, wrap(async (req, res) => {
  const [r] = await pool.query('DELETE FROM traffic_area WHERE id = ?', [req.params.id])
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
    createdBy: r.created_by || null,
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

// Who issued a command — operator display name from the JWT (real name, else username).
const actorOf = (req) => (req.user && (req.user.realName || req.user.username)) || null

app.post('/api/missions', requireAuth, requireRole('OPERATOR'), wrap(async (req, res) => {
  const { pickupStorageId, dropoffStorageId, priority } = req.body || {}
  if (!pickupStorageId || !dropoffStorageId) return res.status(400).json({ error: 'pickupStorageId and dropoffStorageId required' })
  if (pickupStorageId === dropoffStorageId) return res.status(400).json({ error: 'pickup and dropoff must differ' })

  const [stores] = await pool.query('SELECT id, name, node_id, state, enabled FROM storage WHERE id IN (?, ?)', [pickupStorageId, dropoffStorageId])
  const pickup = stores.find(s => String(s.id) === String(pickupStorageId))
  const dropoff = stores.find(s => String(s.id) === String(dropoffStorageId))
  if (!pickup || !dropoff) return res.status(400).json({ error: 'unknown storage' })
  if (!pickup.enabled)  return res.status(400).json({ error: `pickup ${pickup.name} is disabled` })
  if (!dropoff.enabled) return res.status(400).json({ error: `dropoff ${dropoff.name} is disabled` })
  // can't pick from an empty source, nor deliver to a full destination
  if (pickup.state !== 'FULL')   return res.status(409).json({ error: `pickup ${pickup.name} is EMPTY — nothing to pick up` })
  if (dropoff.state !== 'EMPTY') return res.status(409).json({ error: `dropoff ${dropoff.name} is FULL — no space to deliver` })

  res.status(201).json(await insertMission(pickup, dropoff, priority, actorOf(req)))
}))

// Insert one storage→storage transport mission, return the joined row.
async function insertMission(pickup, dropoff, priority, createdBy) {
  const actions = [
    ...(await resolveStageActions(pickup.id, 'PICK')),
    ...(await resolveStageActions(dropoff.id, 'DROP')),
  ]
  const missionNo = `MS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5)}`
  const [r] = await pool.query(
    `INSERT INTO mission (mission_no, type, status, priority, start_node, end_node, progress,
        pickup_storage_id, dropoff_storage_id, actions, created_by)
     VALUES (?, 'TRANSPORT', 'PENDING', ?, ?, ?, 0, ?, ?, ?, ?)`,
    [missionNo, priority || 5, pickup.node_id, dropoff.node_id, pickup.id, dropoff.id, JSON.stringify(actions), createdBy || null],
  )
  const [rows] = await pool.query(`${SELECT_MISSION} WHERE m.id = ?`, [r.insertId])
  return rowToMission(rows[0])
}

// Batch: pair every FULL pickup storage in the pickup area with an EMPTY
// dropoff storage in the dropoff area (zipped, min count), one mission each.
app.post('/api/missions/batch', requireAuth, requireRole('OPERATOR'), wrap(async (req, res) => {
  const { pickupAreaId, dropoffAreaId, priority } = req.body || {}
  if (!pickupAreaId || !dropoffAreaId) return res.status(400).json({ error: 'pickupAreaId and dropoffAreaId required' })

  const [pickups] = await pool.query(
    `SELECT id, name, node_id FROM storage
      WHERE area_id = ? AND enabled = 1 AND state = 'FULL' AND kind IN ('PICK','BOTH') ORDER BY name`,
    [pickupAreaId])
  const [dropoffs] = await pool.query(
    `SELECT id, name, node_id FROM storage
      WHERE area_id = ? AND enabled = 1 AND state = 'EMPTY' AND kind IN ('DROP','BOTH') ORDER BY name`,
    [dropoffAreaId])

  const n = Math.min(pickups.length, dropoffs.length)
  if (!n) return res.status(400).json({ error: 'no FULL pickups / EMPTY dropoffs available in the chosen areas' })

  const created = []
  const by = actorOf(req)
  for (let i = 0; i < n; i++) {
    if (String(pickups[i].id) === String(dropoffs[i].id)) continue
    created.push(await insertMission(pickups[i], dropoffs[i], priority, by))
  }
  res.status(201).json(created)
}))

app.patch('/api/missions/:id', requireAuth, requireRole('OPERATOR'), wrap(async (req, res) => {
  const { status, progress, priority, agvId, assignedAt, startedAt, finishedAt } = req.body || {}
  const sets = [], vals = []
  if (status !== undefined)     { sets.push('status = ?');      vals.push(status) }
  if (progress !== undefined)   { sets.push('progress = ?');    vals.push(progress) }
  if (priority !== undefined)   { sets.push('priority = ?');    vals.push(priority) }
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
