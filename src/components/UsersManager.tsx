/**
 * UsersTab — ADMIN-only user management (rendered as the USERS tab in
 * ConfigDialog). Create accounts, set role (ADMIN/OPERATOR/VIEWER), enable /
 * disable, reset password, delete. All mutations go through the backend
 * /api/users endpoints, which enforce ADMIN and guard the last active admin.
 */
import { useEffect, useState } from 'react'
import type { SysUser, UserRole } from '@/types/fleet'
import { api, ApiError } from '@/services/api'
import { useAuthStore } from '@/store/auth.store'

const ROLES: UserRole[] = ['ADMIN', 'OPERATOR', 'VIEWER']
const ROLE_COLOR: Record<UserRole, string> = { ADMIN: '#dc2626', OPERATOR: '#2563eb', VIEWER: '#64748b' }
const ROLE_HINT: Record<UserRole, string> = {
  ADMIN: 'Full access + user management',
  OPERATOR: 'Can command robots (create / change missions)',
  VIEWER: 'Read-only — cannot issue commands',
}
const msg = (e: unknown) => e instanceof ApiError ? e.message : 'request failed'
const fmtTs = (ts?: string | null) => ts ? new Date(ts).toLocaleString('en-GB') : 'never'

export function UsersTab() {
  const me = useAuthStore(s => s.user)
  const [users, setUsers] = useState<SysUser[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // add form
  const [nu, setNu] = useState('')
  const [np, setNp] = useState('')
  const [nn, setNn] = useState('')
  const [nr, setNr] = useState<UserRole>('VIEWER')
  const [busy, setBusy] = useState(false)

  const load = () => { setLoading(true); setErr(''); api.listUsers().then(setUsers).catch(e => setErr(msg(e))).finally(() => setLoading(false)) }
  useEffect(load, [])

  const add = async () => {
    if (!nu.trim() || !np) { setErr('username and password required'); return }
    setBusy(true); setErr('')
    try {
      const u = await api.createUser({ username: nu.trim(), password: np, realName: nn.trim() || undefined, role: nr })
      setUsers(us => [...us, u].sort((a, b) => a.username.localeCompare(b.username)))
      setNu(''); setNp(''); setNn(''); setNr('VIEWER')
    } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }

  const patch = async (id: string, p: Partial<{ realName: string; role: UserRole; enabled: boolean; password: string }>) => {
    setErr('')
    try { const u = await api.updateUser(id, p); setUsers(us => us.map(x => x.id === id ? u : x)) }
    catch (e) { setErr(msg(e)) }
  }
  const del = async (u: SysUser) => {
    if (!window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) return
    setErr('')
    try { await api.deleteUser(u.id); setUsers(us => us.filter(x => x.id !== u.id)) }
    catch (e) { setErr(msg(e)) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* add a user */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 4, padding: 10, background: 'var(--surface-2)' }}>
        <div style={{ fontSize: 9, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 7 }}>Add user</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <input value={nu} onChange={e => setNu(e.target.value)} placeholder="username" style={inp} />
          <input value={nn} onChange={e => setNn(e.target.value)} placeholder="real name (optional)" style={inp} />
          <input value={np} onChange={e => setNp(e.target.value)} type="password" placeholder="password" style={inp} />
          <select value={nr} onChange={e => setNr(e.target.value as UserRole)} style={inp}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 9, color: 'var(--text-faint)', flex: 1 }}>{ROLE_HINT[nr]}</span>
          <button onClick={add} disabled={busy || !nu.trim() || !np} style={{ ...primaryBtn, opacity: busy || !nu.trim() || !np ? 0.5 : 1 }}>+ ADD USER</button>
        </div>
      </div>

      {err && <div style={{ fontSize: 10, color: '#dc2626' }}>{err}</div>}

      {/* user list */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Users ({users.length})</span>
          <button onClick={load} style={{ ...miniBtn, marginLeft: 'auto' }}>↻ RELOAD</button>
        </div>
        {loading && <div style={{ fontSize: 10, color: 'var(--text-faint)', padding: 8 }}>Loading…</div>}
        {!loading && users.map(u => (
          <UserRow key={u.id} u={u} isSelf={me?.id === u.id} onPatch={patch} onDelete={del} />
        ))}
      </div>
    </div>
  )
}

function UserRow({ u, isSelf, onPatch, onDelete }: {
  u: SysUser; isSelf: boolean
  onPatch: (id: string, p: Partial<{ realName: string; role: UserRole; enabled: boolean; password: string }>) => void
  onDelete: (u: SysUser) => void
}) {
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [name, setName] = useState(u.realName)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0', borderBottom: '1px solid rgba(212,218,227,0.6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'Roboto Mono', fontSize: 12, color: 'var(--text)', minWidth: 90 }}>{u.username}{isSelf && <span style={{ fontSize: 8, color: 'var(--text-faint)' }}> (you)</span>}</span>
        <input value={name} onChange={e => setName(e.target.value)} onBlur={() => name !== u.realName && onPatch(u.id, { realName: name })}
          placeholder="real name" style={{ ...inp, flex: 1, minWidth: 0 }} />
        <select value={u.role} onChange={e => onPatch(u.id, { role: e.target.value as UserRole })}
          title={ROLE_HINT[u.role]} style={{ ...inp, width: 100, color: ROLE_COLOR[u.role], fontWeight: 700 }}>
          {ROLES.map(r => <option key={r} value={r} style={{ color: 'var(--text)' }}>{r}</option>)}
        </select>
        <button onClick={() => onPatch(u.id, { enabled: !u.enabled })} title="Enable / disable login"
          style={{ ...miniBtn, width: 44, color: u.enabled ? '#16a34a' : 'var(--text-faint)', borderColor: u.enabled ? 'rgba(22,163,74,0.4)' : 'var(--border)' }}>
          {u.enabled ? 'ON' : 'OFF'}
        </button>
        <button onClick={() => setShowPw(s => !s)} title="Reset password" style={{ ...miniBtn, color: showPw ? 'var(--accent)' : 'var(--text-muted)' }}>🔑</button>
        <button onClick={() => onDelete(u)} disabled={isSelf} title={isSelf ? 'cannot delete yourself' : 'Delete user'}
          style={{ ...miniBtn, color: '#dc2626', opacity: isSelf ? 0.35 : 1 }}>×</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 2 }}>
        <span style={{ fontSize: 8, color: 'var(--text-faint)' }}>last login: {fmtTs(u.lastLogin)}</span>
        {showPw && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={pw} onChange={e => setPw(e.target.value)} type="password" placeholder="new password" style={{ ...inp, width: 150 }} />
            <button onClick={() => { if (pw) { onPatch(u.id, { password: pw }); setPw(''); setShowPw(false) } }} disabled={!pw}
              style={{ ...miniBtn, color: '#16a34a', borderColor: 'rgba(22,163,74,0.4)', opacity: pw ? 1 : 0.5 }}>SET</button>
          </span>
        )}
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 2, padding: '5px 7px', fontSize: 11, fontFamily: 'Roboto Mono', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: 1, borderRadius: 2, cursor: 'pointer', color: '#16a34a', border: '1px solid rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.08)', whiteSpace: 'nowrap' }
const miniBtn: React.CSSProperties = { fontSize: 10, padding: '4px 8px', borderRadius: 2, cursor: 'pointer', color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'transparent', fontFamily: 'Roboto Mono', whiteSpace: 'nowrap' }
