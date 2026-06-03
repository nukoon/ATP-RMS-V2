/**
 * Theme store — Light/Dark, persisted to localStorage. Applies CSS variables
 * (via applyTheme) on change and on rehydrate so the choice survives reloads.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applyTheme, type ThemeName } from '@/theme'

interface ThemeStore {
  theme: ThemeName
  setTheme: (t: ThemeName) => void
  toggle: () => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'light',
      setTheme: (theme) => { applyTheme(theme); set({ theme }) },
      toggle: () => { const t: ThemeName = get().theme === 'dark' ? 'light' : 'dark'; applyTheme(t); set({ theme: t }) },
    }),
    { name: 'atp-rms-theme', onRehydrateStorage: () => (s) => { if (s) applyTheme(s.theme) } },
  ),
)
