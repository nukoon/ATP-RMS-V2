/**
 * ATP-RMS-V2 — App Shell
 * TODO: Connect real MQTT broker URL from environment config
 */
import { useEffect, useState } from 'react'
import { useFleetStore } from '@/store/fleet.store'
import { loadMap } from '@/services/map.service'
import { simulationService } from '@/services/simulation.service'
import { RobotList }    from '@/components/sidebar/RobotList'
import { VdaStream }    from '@/components/panels/VdaStream'
import { MetricsPanel } from '@/components/panels/MetricsPanel'
import { RobotDetail }  from '@/components/panels/RobotDetail'
import { OrderPanel }   from '@/components/panels/OrderPanel'
import { AlarmPanel }   from '@/components/panels/AlarmPanel'
import { MapToolbar }   from '@/components/map/MapToolbar'
import { MapCanvas }    from '@/components/map/MapCanvas'
import { useMapTransform } from '@/hooks/useMapTransform'

type RightTab = 'stream' | 'missions' | 'alarms'

export default function App() {
  const { map, setMap, robots, mqttLog, metrics, mapConfig, setMapConfig, selectedRobotId, setSelectedRobotId, mqttConnected, mqttLatency } = useFleetStore()
  const ctrl = useMapTransform(map)
  const [simOn, setSimOn] = useState(false)
  const [tab, setTab] = useState<RightTab>('stream')
  const alarms = useFleetStore(s => s.alarms)
  const activeAlarms = alarms.filter(a => a.status === 'ACTIVE').length

  useEffect(() => {
    loadMap('/maps/origin_20260120205139.json').then(setMap).catch(console.error)
  }, [])

  const toggleSim = () => {
    if (!map) return
    if (simulationService.running) { simulationService.stop(); setSimOn(false) }
    else { simulationService.start(map); setSimOn(true) }
  }

  useEffect(() => () => simulationService.stop(), [])

  const robotList = [...robots.values()]
  const selectedRobot = selectedRobotId ? robots.get(selectedRobotId) ?? null : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#060a10', color: '#c8d8e8', fontFamily: 'Rajdhani, sans-serif' }}>
      {/* TOP BAR */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px', background: '#0a1520', borderBottom: '1px solid #152030', flexShrink: 0 }}>
        <img src="/assets/brand/logo_atp.png" style={{ height: 28, objectFit: 'contain' }} />
        <span style={{ width: 1, height: 20, background: '#152030', margin: '0 4px' }} />
        <span style={{ fontFamily: 'Share Tech Mono', fontSize: 9, color: '#5a7080', letterSpacing: 2 }}>DIGITAL TWIN · FLEET MANAGEMENT</span>
        <div style={{ display: 'flex', gap: 14, marginLeft: 8 }}>
          {[['#00ff88', `Moving: ${metrics.activeCount}`], ['#ffb800', `Charging: ${metrics.chargingCount}`], ['#ff4444', `Error: ${metrics.errorCount}`]].map(([col, lbl]) => (
            <div key={lbl as string} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: col as string, boxShadow: `0 0 6px ${col}`, animation: 'blink 1.8s infinite' }} />
              {lbl}
            </div>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={toggleSim}
            style={{ fontFamily: 'Share Tech Mono', fontSize: 9, cursor: 'pointer',
              color: simOn ? '#00ff88' : '#5a7080',
              border: `1px solid ${simOn ? 'rgba(0,255,136,0.4)' : '#152030'}`,
              background: simOn ? 'rgba(0,255,136,0.08)' : 'transparent',
              padding: '2px 7px', borderRadius: 2 }}>
            {simOn ? '● SIM RUNNING' : '○ START SIM'}
          </button>
          <span style={{ fontFamily: 'Share Tech Mono', fontSize: 9, color: '#00d4ff', border: '1px solid rgba(0,212,255,0.4)', padding: '2px 7px', borderRadius: 2 }}>VDA5050 v2.0</span>
        </div>
      </div>

      {/* TOOLBAR */}
      <MapToolbar
        config={mapConfig} zoom={ctrl.transform.scale}
        onChange={setMapConfig}
        onZoomIn={ctrl.zoomIn} onZoomOut={ctrl.zoomOut} onFit={ctrl.fitToCanvas}
      />

      {/* MAIN */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT SIDEBAR */}
        <div style={{ width: 190, background: '#0a1520', borderRight: '1px solid #152030', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ fontSize: 9, letterSpacing: 2, color: '#5a7080', padding: '8px 12px 6px', textTransform: 'uppercase', borderBottom: '1px solid #152030' }}>
            AMR Fleet — <span style={{ color: '#00d4ff', fontFamily: 'Share Tech Mono' }}>{robotList.length} units</span>
          </div>
          <RobotList robots={robotList} selectedId={selectedRobotId} onSelect={setSelectedRobotId} />
        </div>

        {/* MAP AREA */}
        <div style={{ flex: 1, background: '#060a10', position: 'relative', overflow: 'hidden' }}>
          {map ? (
            <MapCanvas
              map={map}
              robots={robotList}
              config={mapConfig}
              selectedRobotId={selectedRobotId}
              onRobotClick={setSelectedRobotId}
              ctrl={ctrl}
            />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a5060', fontFamily: 'Share Tech Mono', fontSize: 11 }}>Loading map...</div>
          )}
        </div>

        {/* RIGHT PANEL — robot detail when selected, else tabs + metrics */}
        <div style={{ width: 210, background: '#0a1520', borderLeft: '1px solid #152030', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          {selectedRobot ? (
            <RobotDetail
              robot={selectedRobot}
              onClose={() => setSelectedRobotId(null)}
              onAction={(a) => simulationService.command(selectedRobot.id, a)}
            />
          ) : (
            <>
              {/* Tab bar */}
              <div style={{ display: 'flex', borderBottom: '1px solid #152030', flexShrink: 0 }}>
                {([['stream', 'STREAM'], ['missions', 'MISSIONS'], ['alarms', 'ALARMS']] as [RightTab, string][]).map(([key, lbl]) => (
                  <button key={key} onClick={() => setTab(key)}
                    style={{ flex: 1, padding: '6px 0', fontSize: 9, letterSpacing: 1, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'Rajdhani, sans-serif', background: tab === key ? 'rgba(0,212,255,0.08)' : 'transparent',
                      color: tab === key ? '#00d4ff' : '#5a7080',
                      border: 'none', borderBottom: tab === key ? '2px solid #00d4ff' : '2px solid transparent' }}>
                    {lbl}{key === 'alarms' && activeAlarms > 0 && <span style={{ color: '#ff4444' }}> {activeAlarms}</span>}
                  </button>
                ))}
              </div>

              {/* Tab body */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {tab === 'stream' && (
                  <div style={{ padding: '8px 12px', overflowY: 'auto' }}>
                    <div style={{ fontSize: 9, letterSpacing: 2, color: '#5a7080', textTransform: 'uppercase', marginBottom: 7 }}>VDA5050 Stream</div>
                    <VdaStream entries={mqttLog} />
                  </div>
                )}
                {tab === 'missions' && map && <OrderPanel nodes={map.points} />}
                {tab === 'alarms' && <AlarmPanel onSelectRobot={setSelectedRobotId} />}
              </div>

              {/* Metrics always visible */}
              <div style={{ borderTop: '1px solid #152030', padding: '8px 12px', flexShrink: 0 }}>
                <div style={{ fontSize: 9, letterSpacing: 2, color: '#5a7080', textTransform: 'uppercase', marginBottom: 7 }}>Fleet Metrics</div>
                <MetricsPanel metrics={metrics} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* STATUS BAR */}
      <div style={{ background: '#0a1520', borderTop: '1px solid #152030', padding: '3px 12px', display: 'flex', gap: 14, fontFamily: 'Share Tech Mono', fontSize: 9, color: '#5a7080', alignItems: 'center', flexShrink: 0 }}>
        <span>MAP: <span style={{ color: '#00d4ff' }}>origin_20260120205139.json</span></span>
        <span>LM:<span style={{ color: '#00d4ff' }}>{map?.points.filter(p=>p.cls==='LocationMark').length ?? 0}</span> AP:<span style={{ color: '#00d4ff' }}>{map?.points.filter(p=>p.cls==='ActionPoint').length ?? 0}</span></span>
        <span>MQTT: <span style={{ color: mqttConnected ? '#00ff88' : '#ff4444' }}>{mqttConnected ? 'CONNECTED' : 'OFFLINE'}</span></span>
        <span>Latency: <span style={{ color: '#00d4ff' }}>{mqttConnected ? `${mqttLatency}ms` : '—'}</span></span>
        <span>Fleet: <span style={{ color: '#00d4ff' }}>{robots.size}</span></span>
        <span style={{ marginLeft: 'auto' }}>ATP-RMS-V2 v0.1.0</span>
      </div>
    </div>
  )
}
