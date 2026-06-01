/**
 * Config Store — operator-registered AMRs, maps and the MQTT broker.
 * AMRs are now persisted in the backend DB (`agv` table) and loaded via the
 * REST API; maps + broker stay in localStorage. This is the "Add AMR /
 * Add Map" configuration used to connect to REAL robots.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AmrConfig, MapConfig, BrokerConfig } from '@/types/fleet'
import { api } from '@/services/api'

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
  // Registered AMRs (for real-robot connection) — backed by the DB.
  amrs: AmrConfig[]
  amrsLoaded: boolean
  loadAmrs:  () => Promise<void>
  addAmr:    (a: AmrConfig) => Promise<void>
  updateAmr: (serial: string, patch: Partial<AmrConfig>) => Promise<void>
  removeAmr: (serial: string) => Promise<void>

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
      amrsLoaded: false,
      loadAmrs: async () => {
        const amrs = await api.listAmrs()
        set({ amrs, amrsLoaded: true })
      },
      addAmr: async (a) => {
        const created = await api.createAmr(a)
        set(s => s.amrs.some(x => x.serial === created.serial) ? s : { amrs: [...s.amrs, created] })
      },
      updateAmr: async (serial, patch) => {
        const updated = await api.updateAmr(serial, patch)
        set(s => ({ amrs: s.amrs.map(a => a.serial === serial ? updated : a) }))
      },
      removeAmr: async (serial) => {
        await api.deleteAmr(serial)
        set(s => ({ amrs: s.amrs.filter(a => a.serial !== serial) }))
      },

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
      // AMRs live in the DB now — only persist maps/activeMap/broker locally.
      partialize: (s) => ({ maps: s.maps, activeMapId: s.activeMapId, broker: s.broker }),
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
