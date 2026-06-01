/**
 * MySQL connection pool (mysql2/promise) for the atp_rms database.
 * Connects with the dedicated `atp_app` user — NOT the legacy root —
 * so this backend only ever touches atp_rms on the shared instance.
 */
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })
const mysql = require('mysql2/promise')

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'atp_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'atp_rms',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4_unicode_ci',
})

module.exports = pool
