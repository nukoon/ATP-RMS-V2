/**
 * Storage Store — DB-backed pickup/delivery storage areas, the VDA5050 action
 * templates, and per-storage action bindings. Storages bind to a map location
 * node and carry an EMPTY/FULL state shown on the map. All mutations go through
 * the backend API (server/index.js); nothing is persisted to localStorage.
 */
import { create } from 'zustand'
import { api } from '@/services/api'
import type { Storage, StorageState, VdaActionTemplate, StorageActionBinding } from '@/types/fleet'

interface StorageStore {
  storages: Storage[]
  templates: VdaActionTemplate[]
  bindings: Record<string, StorageActionBinding[]>  // storageId → bindings
  loaded: boolean

  loadAll: () => Promise<void>

  addStorage:    (s: Partial<Storage>) => Promise<Storage>
  updateStorage: (id: string, patch: Partial<Storage>) => Promise<void>
  removeStorage: (id: string) => Promise<void>
  setState:      (id: string, state: StorageState) => Promise<void>

  addTemplate:    (a: Partial<VdaActionTemplate>) => Promise<void>
  updateTemplate: (id: string, patch: Partial<VdaActionTemplate>) => Promise<void>
  removeTemplate: (id: string) => Promise<void>

  loadBindings: (storageId: string) => Promise<StorageActionBinding[]>
  saveBindings: (storageId: string, bindings: StorageActionBinding[]) => Promise<void>
}

export const useStorageStore = create<StorageStore>((set, get) => ({
  storages: [],
  templates: [],
  bindings: {},
  loaded: false,

  loadAll: async () => {
    const [storages, templates] = await Promise.all([api.listStorages(), api.listActions()])
    set({ storages, templates, loaded: true })
  },

  addStorage: async (s) => {
    const created = await api.createStorage(s)
    set(st => ({ storages: [...st.storages, created].sort((a, b) => a.name.localeCompare(b.name)) }))
    return created
  },
  updateStorage: async (id, patch) => {
    const updated = await api.updateStorage(id, patch)
    set(st => ({ storages: st.storages.map(s => s.id === id ? updated : s) }))
  },
  removeStorage: async (id) => {
    await api.deleteStorage(id)
    set(st => ({ storages: st.storages.filter(s => s.id !== id) }))
  },
  setState: async (id, state) => {
    // optimistic flip so the map/icon updates immediately, then persist
    set(st => ({ storages: st.storages.map(s => s.id === id ? { ...s, state } : s) }))
    try { await api.updateStorage(id, { state }) }
    catch (e) { await get().loadAll(); throw e }
  },

  addTemplate: async (a) => {
    const created = await api.createAction(a)
    set(st => ({ templates: [...st.templates, created] }))
  },
  updateTemplate: async (id, patch) => {
    const updated = await api.updateAction(id, patch)
    set(st => ({ templates: st.templates.map(t => t.id === id ? updated : t) }))
  },
  removeTemplate: async (id) => {
    await api.deleteAction(id)
    set(st => ({ templates: st.templates.filter(t => t.id !== id) }))
  },

  loadBindings: async (storageId) => {
    const bindings = await api.listStorageActions(storageId)
    set(st => ({ bindings: { ...st.bindings, [storageId]: bindings } }))
    return bindings
  },
  saveBindings: async (storageId, bindings) => {
    const saved = await api.setStorageActions(storageId, bindings)
    set(st => ({ bindings: { ...st.bindings, [storageId]: saved } }))
  },
}))
