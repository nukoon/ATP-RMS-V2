/**
 * ATP-RMS-V2 — App Shell
 * TODO: Connect real MQTT broker URL from environment config
 */
import { useEffect, useState } from 'react'
import { useSync } from '@/hooks/useSync'
import { useFleetStore } from '@/store/fleet.store'
import { useConfigStore } from '@/store/config.store'
import { useAuthStore } from '@/store/auth.store'
import { useStorageStore } from '@/store/storage.store'
import { loadMap, loadMapFromJson } from '@/services/map.service'
import { simulationService } from '@/services/simulation.service'
import { mqttService } from '@/services/mqtt.service'
import { ConfigDialog } from '@/components/ConfigDialog'
import { FleetSidebar } from '@/components/sidebar/FleetSidebar'
import { MetricsPanel } from '@/components/panels/MetricsPanel'
import { RobotDetail }  from '@/components/panels/RobotDetail'
import { OrderPanel }   from '@/components/panels/OrderPanel'
import { StoragePanel } from '@/components/panels/StoragePanel'
import { StorageDialog } from '@/components/StorageDialog'
import { MultiStorageDialog } from '@/components/MultiStorageDialog'
import { TrafficAreaDialog, type TrafficDraft } from '@/components/TrafficAreaDialog'
import { FacilitiesDialog } from '@/components/FacilitiesDialog'
import { DashboardDialog } from '@/components/DashboardDialog'
import { HistoryDialog } from '@/components/HistoryDialog'
import { MapToolbar }   from '@/components/map/MapToolbar'
import { MapCanvas }    from '@/components/map/MapCanvas'
import { Map3DCanvas }  from '@/components/map/Map3DCanvas'
import { useThemeStore } from '@/store/theme.store'
import { StatusBar }    from '@/components/StatusBar'
import { useMapTransform } from '@/hooks/useMapTransform'
import { VDA_BRANDS } from '@/constants/vda-brands'

type RightTab = 'missions' | 'storage'

export default function App() {
  const { map, setMap, robots, metrics, mapConfig, setMapConfig, selectedRobotId, setSelectedRobotId, mqttConnected } = useFleetStore()
  const ctrl = useMapTransform(map)
  const [simOn, setSimOn] = useState(false)
  const [tab, setTab] = useState<RightTab>('missions')
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [configTab, setConfigTab] = useState<'amrs' | 'maps' | 'broker' | 'users'>('amrs')
  const [live, setLive] = useState(false)
  const [showStorageDialog, setShowStorageDialog] = useState(false)
  const [showFacilities, setShowFacilities] = useState(false)   // docks + traffic
  const [showDashboard, setShowDashboard] = useState(false)     // KPI dashboard
  const [showHistory, setShowHistory] = useState(false)         // task history + CSV
  const [view3d, setView3d] = useState(false)                   // 2D canvas ↔ 3D scene
  const theme = useThemeStore(s => s.theme)
  const toggleTheme = useThemeStore(s => s.toggle)
  // lasso nodes on the map → either bulk storage, or a traffic area
  const [lasso, setLasso] = useState<null | 'storage' | 'traffic'>(null)
  const [picked, setPicked] = useState<{ purpose: 'storage'; ids: string[] } | null>(null)
  const [trafficEdit, setTrafficEdit] = useState<TrafficDraft | null>(null)   // create/edit a traffic zone
  const trafficAreas = useStorageStore(s => s.trafficAreas)
  // right-click context menu on a storage area (batch FULL/EMPTY)
  const [areaMenu, setAreaMenu] = useState<{ areaId: string; x: number; y: number } | null>(null)
  const [storageMenu, setStorageMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  // job pick-on-map: pick pickup/dropoff stock or pick/drop area by clicking the map
  const [pickMode, setPickMode] = useState<null | 'pickup' | 'dropoff' | 'pickArea' | 'dropArea'>(null)
  const [jobSel, setJobSel] = useState<{ pickup?: string; dropoff?: string; pickArea?: string; dropArea?: string }>({})
  const setAreaState = useStorageStore(s => s.setAreaState)
  const setStorageState = useStorageStore(s => s.setState)
  const storageAreas = useStorageStore(s => s.areas)
  const storages = useStorageStore(s => s.storages)
  const openConfig = (t: 'amrs' | 'maps' | 'broker' | 'users') => { setConfigTab(t); setShowConfig(true) }
  const missions = useFleetStore(s => s.missions)

  const { maps, activeMapId, amrs, broker, loadAmrs } = useConfigStore()
  const loadBroker = useConfigStore(s => s.loadBroker)
  const authUser = useAuthStore(s => s.user)
  const clearAuth = useAuthStore(s => s.clearAuth)
  // multi-user sync: prompt to pull when others change shared data; confirm own edits
  const { pending: syncPending, justSynced, syncing, sync } = useSync()

  const loadStorages = useStorageStore(s => s.loadAll)

  // Load the operator's registered AMRs + storages + shared broker config on entry.
  useEffect(() => { loadAmrs().catch(err => console.error('[AMR] load failed', err)) }, [loadAmrs])
  useEffect(() => { loadStorages().catch(err => console.error('[STORAGE] load failed', err)) }, [loadStorages])
  useEffect(() => { loadBroker().catch(() => {}) }, [loadBroker])

  // load the active map (builtin URL or uploaded JSON) whenever it changes
  useEffect(() => {
    const mc = maps.find(m => m.id === activeMapId) ?? maps[0]
    if (!mc) return
    try {
      if (mc.source === 'uploaded' && mc.data) setMap(loadMapFromJson(mc.data))
      else if (mc.url) loadMap(mc.url).then(setMap).catch(console.error)
    } catch (e) { console.error('[MAP] load failed', e) }
  }, [activeMapId, maps, setMap])

  const toggleSim = () => {
    if (!map) return
    if (simulationService.running) { simulationService.stop(); setSimOn(false) }
    else { simulationService.start(map); setSimOn(true) }
  }

  // Connect to a real broker and stream the enabled AMRs
  const toggleLive = () => {
    if (live) { mqttService.disconnect(); useFleetStore.getState().setMqttConnected(false); setLive(false); return }
    const enabled = amrs.filter(a => a.enabled)
    if (!enabled.length) { setShowConfig(true); return }
    // seed robots so VDA5050 state updates have something to update
    const store = useFleetStore.getState()
    for (const a of enabled) {
      store.upsertRobot({
        id: a.serial, model: a.model, color: a.color, status: 'UNKNOWN',
        pose: { x: 0, y: 0, theta: 0, mapId: 'live' },
        battery: { batteryCharge: 0, charging: false },
        velocity: { vx: 0, vy: 0, omega: 0 },
        currentNodeId: '', currentOrderId: null, path: [], pathIndex: 0,
        errors: [], totalDistance: 0, lastUpdated: Date.now(), mqttConnected: false,
      })
    }
    mqttService.onStateUpdate((id, st) => useFleetStore.getState().updateFromVDA5050(id, st))
    mqttService.onConnectionChange((c) => useFleetStore.getState().setMqttConnected(c))
    mqttService.onRobotConnection((id, online) => console.log(`[MQTT] robot ${id} ${online ? 'ONLINE' : 'OFFLINE'}`))
    // each robot gets its own topic identity from its brand preset
    const mqttRobots = enabled.map(a => {
      const b = VDA_BRANDS[a.brand] ?? VDA_BRANDS.aiten
      return { serial: a.serial, manufacturer: b.manufacturer, baseTopic: b.baseTopic }
    })
    mqttService.connect({ brokerUrl: broker.wsUrl, username: broker.username, password: broker.password }, mqttRobots)
    setLive(true)
  }

  useEffect(() => () => { simulationService.stop(); mqttService.disconnect() }, [])

  // Esc cancels an in-progress job pick-on-map
  useEffect(() => {
    if (!pickMode) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickMode(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickMode])

  const robotList = [...robots.values()]
  const selectedRobot = selectedRobotId ? robots.get(selectedRobotId) ?? null : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'Inter, "Noto Sans JP", sans-serif' }}>
      {/* multi-user sync: another operator changed shared data → prompt to pull (manual) */}
      {syncPending && (
        <div style={{ position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 1200,
          display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px 7px 14px', borderRadius: 8,
          background: 'rgba(234,122,0,0.97)', color: '#fff', boxShadow: '0 4px 16px rgba(26,34,48,0.3)',
          fontFamily: 'Inter, "Noto Sans JP", sans-serif', fontSize: 12 }}>
          ⚠ {syncPending.scope === 'config' ? 'Configuration' : 'Map data'} changed{syncPending.by ? ` by ${syncPending.by}` : ''} — sync to load the latest
          <button onClick={() => sync()} disabled={syncing}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff', color: '#ea7a00', border: 'none', borderRadius: 5,
              padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{syncing ? '… SYNCING' : '⟳ SYNC NOW'}</button>
        </div>
      )}
      {/* your own edit was saved into the shared system */}
      {justSynced && !syncPending && (
        <div style={{ position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 1200,
          padding: '7px 14px', borderRadius: 8, background: 'rgba(22,163,74,0.96)', color: '#fff',
          boxShadow: '0 4px 16px rgba(26,34,48,0.3)', fontFamily: 'Inter, "Noto Sans JP", sans-serif', fontSize: 12 }}>
          ✓ Your changes were synced to the system
        </div>
      )}
      {/* TOP BAR */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <img src="/assets/brand/logo_autoprobot.svg" style={{ height: 28, objectFit: 'contain' }} />
        <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
        <span style={{ fontFamily: 'Roboto Mono', fontSize: 10, color: 'var(--text)', letterSpacing: 1.5, fontWeight: 600 }}>ATP - Robot Management System</span>
        <div style={{ display: 'flex', gap: 14, marginLeft: 8 }}>
          {[['#16a34a', `Moving: ${metrics.activeCount}`], ['#f59e0b', `Charging: ${metrics.chargingCount}`], ['#dc2626', `Error: ${metrics.errorCount}`]].map(([col, lbl]) => (
            <div key={lbl as string} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: col as string, boxShadow: `0 0 6px ${col}`, animation: 'blink 1.8s infinite' }} />
              {lbl}
            </div>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'Roboto Mono', fontSize: 9, cursor: 'pointer',
              color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'transparent', padding: '2px 8px', borderRadius: 2 }}>
            {theme === 'dark' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            )}
            {theme === 'dark' ? 'LIGHT' : 'DARK'}
          </button>
          <button onClick={() => sync()} disabled={syncing}
            title={syncPending ? `Changes by ${syncPending.by ?? 'another user'} — click to load the latest` : 'Sync shared data'}
            style={{ fontFamily: 'Roboto Mono', fontSize: 9, cursor: 'pointer',
              color: syncPending ? '#ea7a00' : 'var(--text-muted)',
              border: `1px solid ${syncPending ? 'rgba(234,122,0,0.5)' : 'var(--border)'}`,
              background: syncPending ? 'rgba(234,122,0,0.1)' : 'transparent', padding: '2px 7px', borderRadius: 2 }}>
            {syncing ? '⟳ …' : syncPending ? '⟳ SYNC ●' : '⟳ SYNC'}
          </button>
          <button onClick={() => openConfig('broker')}
            style={{ fontFamily: 'Roboto Mono', fontSize: 9, cursor: 'pointer', color: 'var(--text-muted)',
              border: '1px solid var(--border)', background: 'transparent', padding: '2px 7px', borderRadius: 2 }}>
            ⚙ CONFIG
          </button>
          <button onClick={toggleLive}
            style={{ fontFamily: 'Roboto Mono', fontSize: 9, cursor: 'pointer',
              color: live ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${live ? 'rgba(37,99,235,0.5)' : 'var(--border)'}`,
              background: live ? 'rgba(37,99,235,0.1)' : 'transparent',
              padding: '2px 7px', borderRadius: 2 }}>
            {live ? '● LIVE' : '○ CONNECT'}
          </button>
          <button onClick={toggleSim} disabled={live}
            style={{ fontFamily: 'Roboto Mono', fontSize: 9, cursor: live ? 'not-allowed' : 'pointer',
              color: simOn ? '#16a34a' : 'var(--text-muted)', opacity: live ? 0.4 : 1,
              border: `1px solid ${simOn ? 'rgba(22,163,74,0.4)' : 'var(--border)'}`,
              background: simOn ? 'rgba(22,163,74,0.08)' : 'transparent',
              padding: '2px 7px', borderRadius: 2 }}>
            {simOn ? '● SIM RUNNING' : '○ START SIM'}
          </button>
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 9, color: 'var(--accent)', border: '1px solid rgba(37,99,235,0.4)', padding: '2px 7px', borderRadius: 2 }}>VDA5050 v2.0</span>
          <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 9, color: 'var(--text-2)' }} title={authUser?.role}>
            ◐ {authUser?.realName || authUser?.username || 'user'}
            {authUser?.role && <span style={{ marginLeft: 4, fontSize: 8, color: 'var(--text-faint)' }}>· {authUser.role}</span>}
          </span>
          {authUser?.role === 'ADMIN' && (
            <button onClick={() => openConfig('users')} title="User management"
              style={{ fontFamily: 'Roboto Mono', fontSize: 9, cursor: 'pointer', color: 'var(--accent)',
                border: '1px solid rgba(37,99,235,0.4)', background: 'rgba(37,99,235,0.06)', padding: '2px 7px', borderRadius: 2 }}>
              ⚇ USERS
            </button>
          )}
          <button onClick={() => { if (live) mqttService.disconnect(); simulationService.stop(); clearAuth() }}
            title="Sign out"
            style={{ fontFamily: 'Roboto Mono', fontSize: 9, cursor: 'pointer', color: '#dc2626',
              border: '1px solid rgba(220,38,38,0.35)', background: 'transparent', padding: '2px 7px', borderRadius: 2 }}>
            ⏻ LOGOUT
          </button>
        </div>
      </div>

      {/* TOOLBAR */}
      <MapToolbar
        config={mapConfig}
        onChange={setMapConfig}
        onManageFacilities={() => setShowFacilities(true)}
        onOpenDashboard={() => setShowDashboard(true)}
        onOpenHistory={() => setShowHistory(true)}
      />

      {/* MAIN */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT SIDEBAR — maps + AMR fleet */}
        <FleetSidebar
          robots={robotList}
          selectedId={selectedRobotId}
          onSelect={setSelectedRobotId}
          onAddAmr={() => openConfig('amrs')}
          onManageMaps={() => openConfig('maps')}
        />

        {/* MAP AREA */}
        <div style={{ flex: 1, background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>
          {map ? (
            view3d ? (
              <Map3DCanvas
                map={map}
                robots={robotList}
                config={mapConfig}
                selectedRobotId={selectedRobotId}
                onRobotClick={setSelectedRobotId}
              />
            ) : (
              <MapCanvas
                map={map}
                robots={robotList}
                config={mapConfig}
                selectedRobotId={selectedRobotId}
                onRobotClick={setSelectedRobotId}
                onHover={setCursor}
                ctrl={ctrl}
                selectMode={!!lasso}
                onSelectNodes={(ids) => {
                  const p = lasso; setLasso(null)
                  if (!ids.length) return
                  if (p === 'storage') setPicked({ purpose: 'storage', ids })
                  else if (p === 'traffic') setTrafficEdit(d => {
                    const base = d ?? { name: `TZ-${trafficAreas.length + 1}`, capacity: 1, nodeIds: [] }
                    return { ...base, nodeIds: [...new Set([...base.nodeIds, ...ids])] }   // additive
                  })
                }}
                onAreaContextMenu={(areaId, x, y) => { setStorageMenu(null); setAreaMenu({ areaId, x, y }) }}
                onStorageContextMenu={(id, x, y) => { setAreaMenu(null); setStorageMenu({ id, x, y }) }}
                pickMode={pickMode}
                onMapPick={(mode, id) => { if (id) { setJobSel(s => ({ ...s, [mode]: id })); setPickMode(null) } }}
              />
            )
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontFamily: 'Roboto Mono', fontSize: 11 }}>Loading map...</div>
          )}
          {/* job pick-on-map banner */}
          {pickMode && !view3d && (
            <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 7,
              display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderRadius: 8,
              background: 'rgba(124,58,237,0.96)', color: '#fff', boxShadow: '0 4px 14px rgba(26,34,48,0.25)',
              fontFamily: 'Roboto Mono, "Noto Sans JP", monospace', fontSize: 11 }}>
              📍 Click the {pickMode === 'pickup' ? 'PICKUP stock' : pickMode === 'dropoff' ? 'DROPOFF stock' : pickMode === 'pickArea' ? 'PICK area' : 'DROP area'} on the map
              <button onClick={() => setPickMode(null)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: 4, padding: '1px 7px', fontSize: 10 }}>Esc ✕</button>
            </div>
          )}
          {pickMode && view3d && (
            <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 7, padding: '6px 12px', borderRadius: 8,
              background: 'rgba(124,58,237,0.96)', color: '#fff', fontFamily: 'Roboto Mono', fontSize: 11 }}>
              Switch to 2D to pick on the map
            </div>
          )}
          {/* 2D ↔ 3D view switch (top-right of the map) */}
          {map && (
            <div style={{ position: 'absolute', top: 10, right: 12, zIndex: 6, display: 'flex', background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 7, boxShadow: '0 4px 14px rgba(26,34,48,0.12)', overflow: 'hidden',
              fontFamily: 'Roboto Mono, "Noto Sans JP", monospace' }}>
              {(['2D', '3D'] as const).map(m => {
                const on = (m === '3D') === view3d
                return (
                  <button key={m} type="button" onClick={() => setView3d(m === '3D')} title={`${m} map view`}
                    style={{ padding: '5px 13px', fontSize: 10, fontWeight: 700, letterSpacing: 1, cursor: 'pointer', border: 'none', outline: 'none',
                      color: on ? '#ffffff' : 'var(--text-muted)', background: on ? 'var(--accent)' : 'transparent',
                      transition: 'background 140ms ease, color 140ms ease' }}>
                    {m}
                  </button>
                )
              })}
            </div>
          )}
          {lasso && (
            <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 6,
              display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: `1px solid ${lasso === 'traffic' ? '#dc2626' : 'var(--accent)'}`,
              borderRadius: 4, padding: '6px 12px', boxShadow: '0 4px 14px rgba(26,34,48,0.15)' }}>
              <span style={{ fontSize: 11, color: 'var(--text)' }}>▭ {lasso === 'traffic' ? (trafficEdit?.nodeIds.length ? 'ลากกรอบคลุมโหนด เพื่อ "เพิ่ม" เข้าโซน Traffic' : 'ลากกรอบคลุมโหนด เพื่อสร้าง Traffic Area (โซนห้ามเข้าซ้อน)') : 'ลากกรอบคลุมโหนดที่ต้องการ เพื่อเพิ่ม Storage หลายจุด'}</span>
              <button onClick={() => setLasso(null)}
                style={{ fontSize: 10, color: '#dc2626', background: 'transparent', border: '1px solid rgba(220,38,38,0.35)', borderRadius: 2, cursor: 'pointer', padding: '2px 8px' }}>CANCEL</button>
            </div>
          )}
        </div>

        {/* RIGHT PANEL — robot detail when selected, else tabs + metrics */}
        <div style={{ width: 210, background: 'var(--surface)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          {selectedRobot ? (
            <RobotDetail
              robot={selectedRobot}
              onClose={() => setSelectedRobotId(null)}
              onAction={(a) => {
                if (a === 'VIEW') { ctrl.centerOnWorld(selectedRobot.pose.x, selectedRobot.pose.y); return }
                simulationService.command(selectedRobot.id, a)
              }}
            />
          ) : (
            <>
              {/* Tab bar */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                {([['missions', 'JOBS'], ['storage', 'STORAGE']] as [RightTab, string][]).map(([key, lbl]) => (
                  <button key={key} onClick={() => setTab(key)}
                    style={{ flex: 1, padding: '6px 0', fontSize: 9, letterSpacing: 0.5, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'Inter, "Noto Sans JP", sans-serif', background: tab === key ? 'rgba(37,99,235,0.08)' : 'transparent',
                      color: tab === key ? 'var(--accent)' : 'var(--text-muted)',
                      border: 'none', borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent' }}>
                    {lbl}
                  </button>
                ))}
              </div>

              {/* Tab body */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {tab === 'missions' && (
                  <OrderPanel onManageStorage={() => setShowStorageDialog(true)}
                    sel={jobSel} setSel={setJobSel} pickMode={pickMode}
                    onRequestPick={(m) => { setLasso(null); setSelectedRobotId(null); setPickMode(m) }} />
                )}
                {tab === 'storage' && <StoragePanel onManage={() => setShowStorageDialog(true)} onMultiAdd={() => { setSelectedRobotId(null); setLasso('storage') }} />}
              </div>

              {/* Metrics always visible */}
              <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px', flexShrink: 0 }}>
                <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 7 }}>Fleet Metrics</div>
                <MetricsPanel metrics={metrics} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* STATUS BAR — fleet state counts + cursor readout (legacy :12200 style) */}
      <StatusBar
        robots={robotList}
        missions={missions}
        map={map}
        mqttConnected={mqttConnected}
        cursor={cursor}
        zoom={ctrl.transform.scale}
        heading={selectedRobot?.pose.theta ?? 0}
      />

      {showConfig && <ConfigDialog initialTab={configTab} onClose={() => setShowConfig(false)} />}
      {showStorageDialog && <StorageDialog onClose={() => setShowStorageDialog(false)} />}
      {showFacilities && <FacilitiesDialog onClose={() => setShowFacilities(false)}
        onDrawTrafficArea={() => { setShowFacilities(false); setSelectedRobotId(null); setTrafficEdit(null); setLasso('traffic') }}
        onEditTrafficZone={(z) => { setShowFacilities(false); setTrafficEdit({ id: z.id, name: z.name, capacity: z.capacity, nodeIds: [...z.nodeIds] }) }} />}
      {showDashboard && <DashboardDialog onClose={() => setShowDashboard(false)} />}
      {showHistory && <HistoryDialog onClose={() => setShowHistory(false)} />}
      {picked?.purpose === 'storage' && <MultiStorageDialog nodeIds={picked.ids} onClose={() => setPicked(null)} />}
      {trafficEdit && !lasso && (
        <TrafficAreaDialog draft={trafficEdit} onChange={setTrafficEdit}
          onAddFromMap={() => { setSelectedRobotId(null); setLasso('traffic') }}
          onClose={() => setTrafficEdit(null)} />
      )}

      {/* right-click area menu: batch FULL/EMPTY all members */}
      {areaMenu && (() => {
        const area = storageAreas.find(a => a.id === areaMenu.areaId)
        return (
          <div onClick={() => setAreaMenu(null)} onContextMenu={e => { e.preventDefault(); setAreaMenu(null) }}
            style={{ position: 'fixed', inset: 0, zIndex: 1100 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ position: 'absolute', left: Math.min(areaMenu.x, window.innerWidth - 150), top: Math.min(areaMenu.y, window.innerHeight - 110),
                background: '#fff', border: '1px solid var(--border)', borderRadius: 4, boxShadow: '0 6px 18px rgba(26,34,48,0.18)', overflow: 'hidden', minWidth: 140 }}>
              <div style={{ padding: '6px 10px', fontSize: 10, fontFamily: 'Roboto Mono', color: 'var(--accent)', borderBottom: '1px solid var(--border)' }}>
                ▣ {area?.name ?? 'Area'}
              </div>
              <button onClick={() => { setAreaState(areaMenu.areaId, 'FULL').catch(() => {}); setAreaMenu(null) }}
                style={menuItem('#16a34a')}>● ALL FULL</button>
              <button onClick={() => { setAreaState(areaMenu.areaId, 'EMPTY').catch(() => {}); setAreaMenu(null) }}
                style={menuItem('var(--text-muted)')}>○ ALL EMPTY</button>
            </div>
          </div>
        )
      })()}

      {/* right-click single-storage menu: set this stock FULL / EMPTY (works for ungrouped too) */}
      {storageMenu && (() => {
        const s = storages.find(x => x.id === storageMenu.id)
        return (
          <div onClick={() => setStorageMenu(null)} onContextMenu={e => { e.preventDefault(); setStorageMenu(null) }}
            style={{ position: 'fixed', inset: 0, zIndex: 1100 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ position: 'absolute', left: Math.min(storageMenu.x, window.innerWidth - 160), top: Math.min(storageMenu.y, window.innerHeight - 130),
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, boxShadow: '0 6px 18px rgba(26,34,48,0.18)', overflow: 'hidden', minWidth: 150 }}>
              <div style={{ padding: '6px 10px', fontSize: 10, fontFamily: 'Roboto Mono', color: 'var(--accent)', borderBottom: '1px solid var(--border)' }}>
                ▣ {s?.name ?? 'Stock'} {s && <span style={{ color: s.state === 'FULL' ? '#16a34a' : 'var(--text-muted)' }}>· {s.state}</span>}
              </div>
              <button onClick={() => { setStorageState(storageMenu.id, 'FULL').catch(() => {}); setStorageMenu(null) }}
                style={menuItem('#16a34a')}>● FULL</button>
              <button onClick={() => { setStorageState(storageMenu.id, 'EMPTY').catch(() => {}); setStorageMenu(null) }}
                style={menuItem('var(--text-muted)')}>○ EMPTY</button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// context-menu item style (batch FULL/EMPTY)
function menuItem(color: string): React.CSSProperties {
  return {
    display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 11, fontWeight: 600,
    fontFamily: 'Roboto Mono', cursor: 'pointer', color, background: 'transparent', border: 'none',
  }
}
