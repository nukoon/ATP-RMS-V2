/**
 * REST client for the ATP-RMS backend (Express on :8080, proxied at /api).
 * Attaches the JWT from the auth store; a 401 clears the session so the
 * AuthGate falls back to the login page ("redirect to login if no session").
 */
import { useAuthStore } from '@/store/auth.store'
import type {
  AmrConfig, SysUser, Storage, StorageArea, Dock, TrafficArea, VdaActionTemplate, StorageActionBinding, Mission, FieldDevice,
} from '@/types/fleet'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    })
  } catch {
    // network-level failure (dev server down)
    throw new ApiError('cannot reach the API — is the backend running? (npm run server)', 0)
  }

  // Session gone/expired → drop it so the UI returns to login.
  if (res.status === 401) {
    useAuthStore.getState().clearAuth()
  }

  // Backend down behind the Vite proxy surfaces as a non-JSON 5xx page.
  const ct = res.headers.get('content-type') || ''
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null
  if (!res.ok) {
    if (res.status >= 500 && !data) {
      throw new ApiError('cannot reach the API — is the backend running? (npm run server)', res.status)
    }
    throw new ApiError((data && data.error) || `request failed (${res.status})`, res.status)
  }
  return data as T
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; user: SysUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => request<{ user: SysUser }>('/auth/me'),

  // multi-user sync: a global revision bumped on every shared-data change
  getSync: () => request<{ rev: number; scope: string | null; updatedBy: string | null; updatedAt: string | null }>('/sync'),
  // server-saved shared config (broker, …)
  getConfig: () => request<Record<string, unknown>>('/config'),
  putConfig: (key: string, value: unknown) =>
    request<{ ok: true }>(`/config/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) }),

  // User management (ADMIN only)
  listUsers: () => request<SysUser[]>('/users'),
  createUser: (u: { username: string; password: string; realName?: string; role?: SysUser['role']; enabled?: boolean }) =>
    request<SysUser>('/users', { method: 'POST', body: JSON.stringify(u) }),
  updateUser: (id: string, patch: Partial<{ username: string; password: string; realName: string; role: SysUser['role']; enabled: boolean }>) =>
    request<SysUser>(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteUser: (id: string) =>
    request<{ ok: true }>(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listAmrs: () => request<AmrConfig[]>('/amrs'),
  createAmr: (a: AmrConfig) => request<AmrConfig>('/amrs', { method: 'POST', body: JSON.stringify(a) }),
  updateAmr: (serial: string, patch: Partial<AmrConfig>) =>
    request<AmrConfig>(`/amrs/${encodeURIComponent(serial)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteAmr: (serial: string) =>
    request<{ ok: true }>(`/amrs/${encodeURIComponent(serial)}`, { method: 'DELETE' }),

  // Storage areas (mapId scopes facility data to the active map)
  listStorages: (mapId?: string) => request<Storage[]>(`/storages${mapId ? `?mapId=${encodeURIComponent(mapId)}` : ''}`),
  createStorage: (s: Partial<Storage>) => request<Storage>('/storages', { method: 'POST', body: JSON.stringify(s) }),
  updateStorage: (id: string, patch: Partial<Storage>) =>
    request<Storage>(`/storages/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteStorage: (id: string) =>
    request<{ ok: true }>(`/storages/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Storage areas (batch grouping)
  listAreas: (mapId?: string) => request<StorageArea[]>(`/areas${mapId ? `?mapId=${encodeURIComponent(mapId)}` : ''}`),
  createArea: (a: Partial<StorageArea>) => request<StorageArea>('/areas', { method: 'POST', body: JSON.stringify(a) }),
  updateArea: (id: string, patch: Partial<StorageArea>) =>
    request<StorageArea>(`/areas/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteArea: (id: string) =>
    request<{ ok: true }>(`/areas/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Docks (parking & charging points)
  listDocks: (mapId?: string) => request<Dock[]>(`/docks${mapId ? `?mapId=${encodeURIComponent(mapId)}` : ''}`),
  createDock: (d: Partial<Dock>) => request<Dock>('/docks', { method: 'POST', body: JSON.stringify(d) }),
  updateDock: (id: string, patch: Partial<Dock>) =>
    request<Dock>(`/docks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteDock: (id: string) =>
    request<{ ok: true }>(`/docks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Field devices (doors / traffic lights / lifts / …)
  listDevices: (mapId?: string) => request<FieldDevice[]>(`/devices${mapId ? `?mapId=${encodeURIComponent(mapId)}` : ''}`),
  createDevice: (d: Partial<FieldDevice>) => request<FieldDevice>('/devices', { method: 'POST', body: JSON.stringify(d) }),
  updateDevice: (id: string, patch: Partial<FieldDevice>) =>
    request<FieldDevice>(`/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteDevice: (id: string) =>
    request<{ ok: true }>(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Traffic areas (mutual-exclusion zones)
  listTrafficAreas: (mapId?: string) => request<TrafficArea[]>(`/traffic-areas${mapId ? `?mapId=${encodeURIComponent(mapId)}` : ''}`),
  createTrafficArea: (a: Partial<TrafficArea>) => request<TrafficArea>('/traffic-areas', { method: 'POST', body: JSON.stringify(a) }),
  updateTrafficArea: (id: string, patch: Partial<TrafficArea>) =>
    request<TrafficArea>(`/traffic-areas/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTrafficArea: (id: string) =>
    request<{ ok: true }>(`/traffic-areas/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // VDA5050 action templates
  listActions: () => request<VdaActionTemplate[]>('/actions'),
  createAction: (a: Partial<VdaActionTemplate>) => request<VdaActionTemplate>('/actions', { method: 'POST', body: JSON.stringify(a) }),
  updateAction: (id: string, patch: Partial<VdaActionTemplate>) =>
    request<VdaActionTemplate>(`/actions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteAction: (id: string) =>
    request<{ ok: true }>(`/actions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Per-storage action bindings
  listStorageActions: (storageId: string) =>
    request<StorageActionBinding[]>(`/storages/${encodeURIComponent(storageId)}/actions`),
  setStorageActions: (storageId: string, bindings: StorageActionBinding[]) =>
    request<StorageActionBinding[]>(`/storages/${encodeURIComponent(storageId)}/actions`, { method: 'PUT', body: JSON.stringify(bindings) }),

  // Missions
  listMissions: (params?: { status?: string; limit?: number }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return request<Mission[]>(`/missions${qs ? `?${qs}` : ''}`)
  },
  createMission: (m: { pickupStorageId: string; dropoffStorageId: string; priority?: number }) =>
    request<Mission>('/missions', { method: 'POST', body: JSON.stringify(m) }),
  createBatchMissions: (m: { pickupAreaId: string; dropoffAreaId: string; priority?: number }) =>
    request<Mission[]>('/missions/batch', { method: 'POST', body: JSON.stringify(m) }),
  patchMission: (id: string, patch: Partial<Mission>) =>
    request<Mission>(`/missions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
}
