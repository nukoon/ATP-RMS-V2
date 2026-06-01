/**
 * LoginPage — the gate before the dashboard. Authenticates against the
 * backend (sys_user table) and stores the JWT in the auth store.
 * Default credentials (seeded): admin / admin123.
 */
import { useState } from 'react'
import { api, ApiError } from '@/services/api'
import { useAuthStore } from '@/store/auth.store'

export function LoginPage() {
  const setAuth = useAuthStore(s => s.setAuth)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setErr(''); setBusy(true)
    try {
      const { token, user } = await api.login(username.trim(), password)
      setAuth(token, user)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'connection failed — is the API running?')
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#eef1f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, "Noto Sans JP", sans-serif', color: '#1a2230' }}>
      <form onSubmit={submit}
        style={{ width: 320, background: '#ffffff', border: '1px solid #d4dae3', borderRadius: 6, padding: '26px 24px', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 0 40px rgba(37,99,235,0.06)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <img src="/assets/brand/logo_atp.png" style={{ height: 34, objectFit: 'contain' }} />
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 9, color: '#64748b', letterSpacing: 2 }}>DIGITAL TWIN · FLEET MANAGEMENT</span>
        </div>

        <div style={{ height: 1, background: '#d4dae3' }} />

        <div>
          <div style={{ fontSize: 9, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Username</div>
          <input autoFocus value={username} onChange={e => setUsername(e.target.value)} placeholder="admin"
            style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Password</div>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
            style={inputStyle} />
        </div>

        {err && <div style={{ fontSize: 10, color: '#dc2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 3, padding: '6px 8px' }}>{err}</div>}

        <button type="submit" disabled={busy || !username.trim() || !password}
          style={{ marginTop: 4, padding: '9px 0', fontSize: 12, fontWeight: 700, letterSpacing: 2, borderRadius: 3,
            cursor: busy ? 'wait' : 'pointer', fontFamily: 'Roboto Mono',
            color: '#16a34a', border: '1px solid rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.08)',
            opacity: (busy || !username.trim() || !password) ? 0.5 : 1 }}>
          {busy ? 'AUTHENTICATING…' : 'SIGN IN'}
        </button>
      </form>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#f3f6fa', color: '#1a2230', border: '1px solid #d4dae3', borderRadius: 3,
  padding: '8px 10px', fontSize: 12, fontFamily: 'Roboto Mono', width: '100%', boxSizing: 'border-box',
}
