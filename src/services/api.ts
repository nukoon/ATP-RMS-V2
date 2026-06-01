/**
 * REST client for the ATP-RMS backend (Express on :8080, proxied at /api).
 * Attaches the JWT from the auth store; a 401 clears the session so the
 * AuthGate falls back to the login page ("redirect to login if no session").
 */
import { useAuthStore } from '@/store/auth.store'
import type {
  AmrConfig, SysUser, Storage, VdaActionTemplate, StorageActionBinding, Mission,
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

  listAmrs: () => request<AmrConfig[]>('/amrs'),
  createAmr: (a: AmrConfig) => request<AmrConfig>('/amrs', { method: 'POST', body: JSON.stringify(a) }),
  updateAmr: (serial: string, patch: Partial<AmrConfig>) =>
    request<AmrConfig>(`/amrs/${encodeURIComponent(serial)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteAmr: (serial: string) =>
    request<{ ok: true }>(`/amrs/${encodeURIComponent(serial)}`, { method: 'DELETE' }),

  // Storage areas
  listStorages: () => request<Storage[]>('/storages'),
  createStorage: (s: Partial<Storage>) => request<Storage>('/storages', { method: 'POST', body: JSON.stringify(s) }),
  updateStorage: (id: string, patch: Partial<Storage>) =>
    request<Storage>(`/storages/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteStorage: (id: string) =>
    request<{ ok: true }>(`/storages/${encodeURIComponent(id)}`, { method: 'DELETE' }),

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
  patchMission: (id: string, patch: Partial<Mission>) =>
    request<Mission>(`/missions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
}
