/**
 * dispatch.service — LIVE mission dispatcher (the real-robot counterpart of the
 * simulator's dispatch loop).
 *
 * The old live path published a VDA5050 Order for every new mission straight to the
 * FIRST enabled AMR — even if it was offline or mid-job — and a batch fired all its
 * orders at once at the same robot (a new orderId replaces the current order, so only
 * the last mission ever ran). Missions created while the robot was busy stayed
 * PENDING forever because nothing re-checked the queue.
 *
 * This dispatcher runs while LIVE is connected:
 *  - PENDING missions are served by priority (1 = highest), then age.
 *  - A robot is free when its telemetry is fresh, it's IDLE/CHARGING (or merely
 *    driving home on a PARK- nav order, which a real job may preempt), and no
 *    ASSIGNED/EXECUTING mission already names it.
 *  - The nearest free robot by routed map cost (order.service routeCost — same
 *    metric as the simulator's Dijkstra) gets the order; the mission turns
 *    ASSIGNED with its agvId (persisted via fleet.store → PATCH /api/missions).
 *  - ASSIGNED → EXECUTING once the robot's state echoes the orderId.
 *  - An ASSIGNED order the robot never picked up (offline, rejected) re-queues
 *    after RETRY_MS so the next pass can resend or pick another robot.
 */
import { useFleetStore } from '@/store/fleet.store'
import { useConfigStore } from '@/store/config.store'
import { mqttService } from '@/services/mqtt.service'
import { buildVda5050Order, buildInstantActions, routeCost } from '@/services/order.service'
import { VDA_BRANDS } from '@/constants/vda-brands'
import type { Robot } from '@/types'
import type { Mission, AmrConfig } from '@/types/fleet'

const TICK_MS  = 2_000
const STALE_MS = 10_000   // no state update for this long → robot isn't live
const RETRY_MS = 45_000   // ASSIGNED but the robot never echoed the orderId → re-queue

class LiveDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private sentAt = new Map<string, number>()   // missionId → when we published its order

  start() { if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS) }
  stop()  { if (this.timer) clearInterval(this.timer); this.timer = null; this.sentAt.clear() }
  /** Run a dispatch pass now (mission created / robot finished a job). */
  kick()  { this.tick() }

  /** Mission cancelled in the UI → tell the robot it was assigned to (cancelOrder →
   *  CLEARTARGETLIST on SEER/RoboVDA). The store/DB cancel is the caller's job. */
  cancel(m: Mission) {
    this.sentAt.delete(m.id)
    if (!mqttService.isConnected || !m.agvId) return
    if (m.status !== 'ASSIGNED' && m.status !== 'EXECUTING') return
    const amr = useConfigStore.getState().amrs.find(a => a.serial === m.agvId)
    const mfr = (VDA_BRANDS[amr?.brand ?? 'aiten'] ?? VDA_BRANDS.aiten).manufacturer
    mqttService.sendInstantActions(m.agvId, buildInstantActions(m.agvId, mfr, [{ actionType: 'cancelOrder' }]))
  }

  private tick() {
    if (!mqttService.isConnected) return
    const fs = useFleetStore.getState()
    if (!fs.map) return
    this.trackAssigned(fs)
    this.dispatchPending(fs)
  }

  // ASSIGNED missions: promote to EXECUTING when the robot reports our orderId;
  // re-queue ones the robot never picked up.
  private trackAssigned(fs: ReturnType<typeof useFleetStore.getState>) {
    for (const m of fs.missions) {
      if (m.status !== 'ASSIGNED' || !m.agvId) continue
      const r = fs.robots.get(m.agvId)
      if (r?.currentOrderId === m.missionNo) {
        this.sentAt.delete(m.id)
        if (r.status === 'EXECUTING')
          fs.updateMission(m.id, { status: 'EXECUTING', progress: 25, startedAt: new Date().toISOString() })
      } else {
        const t = this.sentAt.get(m.id)
        if (t && Date.now() - t > RETRY_MS) {
          this.sentAt.delete(m.id)
          console.warn(`[DISPATCH] ${m.missionNo}: ${m.agvId} never accepted the order — re-queueing`)
          fs.updateMission(m.id, { status: 'PENDING', agvId: null })
        }
      }
    }
  }

  private dispatchPending(fs: ReturnType<typeof useFleetStore.getState>) {
    const pending = fs.missions
      .filter(m => m.status === 'PENDING')
      .sort((a, b) => (a.priority - b.priority) || a.createdAt.localeCompare(b.createdAt))
    if (!pending.length) return

    const amrs = useConfigStore.getState().amrs
    const claimed = new Set(fs.missions
      .filter(m => (m.status === 'ASSIGNED' || m.status === 'EXECUTING') && m.agvId)
      .map(m => m.agvId as string))
    const free: { amr: AmrConfig; robot: Robot }[] = []
    for (const a of amrs) {
      if (!a.enabled) continue
      const robot = fs.robots.get(a.serial)
      if (robot && !claimed.has(robot.id) && isFree(robot)) free.push({ amr: a, robot })
    }

    for (const m of pending) {
      if (!free.length) return
      // nearest free robot by routed cost to the pickup; unroutable/unknown = Infinity,
      // and if nobody is routable the first free robot still takes it (the order builder
      // then falls back to a 2-node order the robot self-plans).
      let best = 0, bestCost = Infinity
      free.forEach(({ robot }, i) => {
        const c = robot.currentNodeId ? routeCost(fs.map!, robot.currentNodeId, m.startNode) : null
        const cost = c ?? Infinity
        if (cost < bestCost) { bestCost = cost; best = i }
      })
      const { amr, robot } = free.splice(best, 1)[0]
      this.send(fs, m, amr, robot)
    }
  }

  private send(
    fs: ReturnType<typeof useFleetStore.getState>,
    m: Mission, amr: AmrConfig, robot: Robot,
  ) {
    const mfr = (VDA_BRANDS[amr.brand] ?? VDA_BRANDS.aiten).manufacturer
    const order = buildVda5050Order(amr.serial, mfr, m, fs.map, robot.currentNodeId || undefined)
    mqttService.sendOrder(amr.serial, order)
    this.sentAt.set(m.id, Date.now())
    fs.updateMission(m.id, { status: 'ASSIGNED', agvId: amr.serial, progress: 0, assignedAt: new Date().toISOString() })
    console.log(`[DISPATCH] ${m.missionNo} → ${amr.serial} (${m.startNode} → ${m.endNode})`)
  }
}

// Free = telemetry fresh AND idle/charging — or only driving home on a PARK- nav
// order, which a real job is allowed to preempt (a new orderId replaces it).
function isFree(r: Robot): boolean {
  if (Date.now() - r.lastUpdated > STALE_MS) return false
  if (r.status === 'IDLE' || r.status === 'CHARGING') return true
  return r.status === 'EXECUTING' && !!r.currentOrderId?.startsWith('PARK-')
}

export const liveDispatcher = new LiveDispatcher()
