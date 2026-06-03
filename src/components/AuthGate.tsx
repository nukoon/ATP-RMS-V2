/**
 * AuthGate — wraps the app. No token → render <LoginPage>. With a token,
 * validate it once against /api/auth/me; if the server rejects it, the api
 * client clears the session and we fall back to login. This is the SPA
 * equivalent of "redirect to login when there is no valid session".
 */
import { useEffect, useState } from 'react'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/auth.store'
import { LoginPage } from './LoginPage'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.token)
  const [checking, setChecking] = useState(!!token)

  useEffect(() => {
    if (!token) return
    api.me()
      .then(({ user }) => useAuthStore.getState().setAuth(token, user))
      .catch(() => { /* 401 already cleared the session in the api client */ })
      .finally(() => setChecking(false))
    // run once on mount; token changes flip us to LoginPage via the guard below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!token) return <LoginPage />
  if (checking) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontFamily: 'Roboto Mono', fontSize: 11 }}>
        Restoring session…
      </div>
    )
  }
  return <>{children}</>
}
