/**
 * Config Store — operator-registered AMRs, maps and the MQTT broker.
 * Persisted to localStorage so the setup survives reloads. This is the
 * "Add AMR / Add Map" configuration used to connect to REAL robots.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AmrConfig, MapConfig, BrokerConfig } from '@/types/fleet'

const DEFAULT_BROKER: BrokerConfig = {
  wsUrl: 'ws://localhost:9001',
  username: '',
  password: '',
  manufacturer: 'ATP',
}

const BUILTIN_MAP: MapConfig = {
  id: 'builtin-origin',
  name: 'Factory (default)',
  source: 'builtin',
  url: '/maps/origin_20260120205139.json',
}

interface ConfigStore {
  // Registered AMRs (for real-robot connection)
  amrs: AmrConfig[]
  addAmr:    (a: AmrConfig) => void
  updateAmr: (serial: string, patch: Partial<AmrConfig>) => void
  removeAmr: (serial: string) => void

  // Maps
  maps: MapConfig[]
  activeMapId: string
  addMap:    (m: MapConfig) => void
  removeMap: (id: string) => void
  setActiveMap: (id: string) => void

  // Broker
  broker: BrokerConfig
  setBroker: (patch: Partial<BrokerConfig>) => void
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set) => ({
      amrs: [],
      addAmr: (a) => set(s => s.amrs.some(x => x.serial === a.serial) ? s : { amrs: [...s.amrs, a] }),
      updateAmr: (serial, patch) =>
        set(s => ({ amrs: s.amrs.map(a => a.serial === serial ? { ...a, ...patch } : a) })),
      removeAmr: (serial) => set(s => ({ amrs: s.amrs.filter(a => a.serial !== serial) })),

      maps: [BUILTIN_MAP],
      activeMapId: BUILTIN_MAP.id,
      addMap: (m) => set(s => ({ maps: [...s.maps, m], activeMapId: m.id })),
      removeMap: (id) => set(s => {
        if (id === BUILTIN_MAP.id) return s
        const maps = s.maps.filter(m => m.id !== id)
        return { maps, activeMapId: s.activeMapId === id ? BUILTIN_MAP.id : s.activeMapId }
      }),
      setActiveMap: (id) => set({ activeMapId: id }),

      broker: DEFAULT_BROKER,
      setBroker: (patch) => set(s => ({ broker: { ...s.broker, ...patch } })),
    }),
    {
      name: 'atp-rms-config',
      // ensure the builtin map always exists after rehydrate
      merge: (persisted, current) => {
        const p = persisted as Partial<ConfigStore> | undefined
        const maps = p?.maps?.length ? p.maps : current.maps
        if (!maps.some(m => m.id === BUILTIN_MAP.id)) maps.unshift(BUILTIN_MAP)
        return { ...current, ...p, maps }
      },
    }
  )
)
