/**
 * One-off: (re)seed the default admin user with a freshly generated
 * BCrypt hash so login is guaranteed to work.  Run: node server/seed-admin.js
 * Username: admin   Password: admin123   Role: ADMIN
 */
const bcrypt = require('bcryptjs')
const pool = require('./db')

;(async () => {
  const hash = bcrypt.hashSync('admin123', 10)
  await pool.query(
    `INSERT INTO sys_user (username, password, real_name, role, enabled)
       VALUES ('admin', ?, 'Administrator', 'ADMIN', 1)
     ON DUPLICATE KEY UPDATE password = VALUES(password), enabled = 1`,
    [hash],
  )
  console.log('admin user seeded (admin / admin123)')
  await pool.end()
})().catch((e) => { console.error(e); process.exit(1) })
