/**
 * Auth Store — the login session. Holds the JWT + current user, persisted
 * to localStorage so a reload keeps you signed in until the token expires.
 * Kept dependency-free (does NOT import the api client) so api.ts can read
 * the token from here without an import cycle.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SysUser } from '@/types/fleet'

interface AuthStore {
  token: string | null
  user: SysUser | null
  setAuth: (token: string, user: SysUser) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),
    }),
    { name: 'atp-rms-auth' },
  ),
)
