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
import { VDA_BRANDS } from '@/constants/vda-brands'

const DEFAULT_BROKER: BrokerConfig = {
  brand: 'aiten',
  wsUrl: 'ws://localhost:9001',
  username: '',
  password: '',
  manufacturer: VDA_BRANDS.aiten.manufacturer,   // SEER
  baseTopic: VDA_BRANDS.aiten.baseTopic,          // robot/v2
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

  // Broker (server-saved + shared across operators; localStorage is a cache)
  broker: BrokerConfig
  setBroker: (patch: Partial<BrokerConfig>) => void
  loadBroker: () => Promise<void>
}

// debounced save of the broker to the shared server config
let saveBrokerT: ReturnType<typeof setTimeout> | null = null
function scheduleSaveBroker(broker: BrokerConfig) {
  if (saveBrokerT) clearTimeout(saveBrokerT)
  saveBrokerT = setTimeout(() => { api.putConfig('broker', broker).catch(() => { /* offline / no perm → keep local */ }) }, 600)
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set, get) => ({
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
      setBroker: (patch) => {
        set(s => ({ broker: { ...s.broker, ...patch } }))
        scheduleSaveBroker(get().broker)   // persist to the shared server config
      },
      loadBroker: async () => {
        try {
          const cfg = await api.getConfig()
          const b = cfg.broker as Partial<BrokerConfig> | undefined
          if (b && typeof b === 'object') set(s => ({ broker: { ...s.broker, ...b } }))
        } catch { /* offline → keep the localStorage copy */ }
      },
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
        // backfill new broker fields (brand/baseTopic) for configs saved before they existed
        const broker = { ...DEFAULT_BROKER, ...(p?.broker ?? {}) }
        return { ...current, ...p, maps, broker }
      },
    }
  )
)
