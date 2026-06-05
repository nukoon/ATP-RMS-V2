/**
 * useSync — multi-user data sync (manual). Polls the server's global revision
 * (bumped on every change to shared data: storages/areas/docks/traffic/config).
 *   • Another operator changed something → `pending` is set so the UI can prompt
 *     "press SYNC to load the latest" (we do NOT auto-overwrite the local view).
 *   • This operator changed something → `justSynced` flips briefly to confirm the
 *     edit went into the system. (Suppressed while the simulator is running, which
 *     would otherwise flip storage states constantly.)
 * `sync()` pulls the latest shared data on demand and clears `pending`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/services/api'
import { useStorageStore } from '@/store/storage.store'
import { useConfigStore } from '@/store/config.store'
import { useAuthStore } from '@/store/auth.store'
import { simulationService } from '@/services/simulation.service'

const POLL_MS = 5000

export interface SyncPending { by: string | null; scope: string | null }

export function useSync() {
  const [pending, setPending] = useState<SyncPending | null>(null)
  const [justSynced, setJustSynced] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const syncedT = useRef<ReturnType<typeof setTimeout>>()

  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      await Promise.all([
        useStorageStore.getState().loadAll().catch(() => {}),
        useConfigStore.getState().loadBroker().catch(() => {}),
      ])
      setPending(null)
    } finally { setSyncing(false) }
  }, [])

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const revRef = { current: null as number | null }

    const poll = async () => {
      try {
        const s = await api.getSync()
        if (revRef.current === null) {
          revRef.current = s.rev
        } else if (s.rev > revRef.current) {
          revRef.current = s.rev
          const me = useAuthStore.getState().user
          const myName = me?.realName || me?.username
          const isSelf = !!(s.updatedBy && myName && s.updatedBy === myName)
          if (isSelf) {
            if (!simulationService.running) {     // confirm a manual edit was saved
              setJustSynced(true)
              clearTimeout(syncedT.current)
              syncedT.current = setTimeout(() => setJustSynced(false), 3500)
            }
          } else {
            setPending({ by: s.updatedBy, scope: s.scope })   // prompt to SYNC
          }
        }
      } catch { /* offline / not authed → retry next tick */ }
      if (!stopped) timer = setTimeout(poll, POLL_MS)
    }
    poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [])

  return { pending, justSynced, syncing, sync }
}
