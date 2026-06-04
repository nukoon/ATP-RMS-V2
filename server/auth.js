/**
 * Auth helpers — JWT signing + verification middleware.
 * The browser stores the token in localStorage and sends it as
 * `Authorization: Bearer <token>`. No server-side session table.
 */
const jwt = require('jsonwebtoken')

const SECRET = process.env.JWT_SECRET || 'dev-secret'
const EXPIRES = process.env.JWT_EXPIRES || '12h'

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, realName: user.real_name },
    SECRET,
    { expiresIn: EXPIRES },
  )
}

// Express middleware: require a valid Bearer token, attach req.user.
function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || ''
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null
  if (!token) return res.status(401).json({ error: 'no token' })
  try {
    req.user = jwt.verify(token, SECRET)
    next()
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' })
  }
}

// Express middleware factory: require the authed user to hold one of `roles`.
// Use AFTER requireAuth. ADMIN passes every check (superuser).
function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.user && req.user.role
    if (role === 'ADMIN' || roles.includes(role)) return next()
    return res.status(403).json({ error: 'insufficient role' })
  }
}

module.exports = { signToken, requireAuth, requireRole }
