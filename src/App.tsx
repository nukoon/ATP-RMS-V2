/**
 * AiTEN Fleet Digital Twin — App Shell
 * TODO: Connect real MQTT broker URL from environment config
 */
import { useEffect } from 'react'
import { useFleetStore } from '@/store/fleet.store'
import { loadMap } from '@/services/map.service'
import { RobotList }    from '@/components/sidebar/RobotList'
import { VdaStream }    from '@/components/panels/VdaStream'
import { MetricsPanel } from '@/components/panels/MetricsPanel'
import { MapToolbar }   from '@/components/map/MapToolbar'
// import { MapCanvas } from '@/components/map/MapCanvas'  // TODO: wire transform

export default function App() {
  const { map, setMap, robots, mqttLog, metrics, mapConfig, setMapConfig, selectedRobotId, setSelectedRobotId } = useFleetStore()

  useEffect(() => {
    loadMap('/maps/origin_20260120205139.json').then(setMap).catch(console.error)
  }, [])

  const robotList = [...robots.values()]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#060a10', color: '#c8d8e8', fontFamily: 'Rajdhani, sans-serif' }}>
      {/* TOP BAR */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px', background: '#0a1520', borderBottom: '1px solid #152030', flexShrink: 0 }}>
        <img src="/assets/brand/logo_aiten.png" style={{ height: 28, objectFit: 'contain' }} />
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
          <span style={{ fontFamily: 'Share Tech Mono', fontSize: 9, color: '#00ff88', border: '1px solid rgba(0,255,136,0.4)', padding: '2px 7px', borderRadius: 2 }}>● MQTT LIVE</span>
          <span style={{ fontFamily: 'Share Tech Mono', fontSize: 9, color: '#00d4ff', border: '1px solid rgba(0,212,255,0.4)', padding: '2px 7px', borderRadius: 2 }}>VDA5050 v2.0</span>
        </div>
      </div>

      {/* TOOLBAR */}
      <MapToolbar
        config={mapConfig} zoom={1}
        onChange={setMapConfig}
        onZoomIn={() => {}} onZoomOut={() => {}} onFit={() => {}}
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

        {/* MAP AREA — TODO: replace with <MapCanvas> */}
        <div style={{ flex: 1, background: '#060a10', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          {map ? (
            <div style={{ color: '#5a7080', fontFamily: 'Share Tech Mono', fontSize: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🗺️</div>
              <div>Map loaded: {map.points.length} nodes, {map.curves.length} edges</div>
              <div style={{ fontSize: 10, marginTop: 4, color: '#3a5060' }}>Wire MapCanvas here with useMapTransform hook</div>
            </div>
          ) : (
            <div style={{ color: '#3a5060', fontFamily: 'Share Tech Mono', fontSize: 11 }}>Loading map...</div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div style={{ width: 190, background: '#0a1520', borderLeft: '1px solid #152030', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ borderBottom: '1px solid #152030', padding: '8px 12px' }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: '#5a7080', textTransform: 'uppercase', marginBottom: 7 }}>VDA5050 Stream</div>
            <VdaStream entries={mqttLog} />
          </div>
          <div style={{ borderBottom: '1px solid #152030', padding: '8px 12px' }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: '#5a7080', textTransform: 'uppercase', marginBottom: 7 }}>Fleet Metrics</div>
            <MetricsPanel metrics={metrics} />
          </div>
        </div>
      </div>

      {/* STATUS BAR */}
      <div style={{ background: '#0a1520', borderTop: '1px solid #152030', padding: '3px 12px', display: 'flex', gap: 14, fontFamily: 'Share Tech Mono', fontSize: 9, color: '#5a7080', alignItems: 'center', flexShrink: 0 }}>
        <span>MAP: <span style={{ color: '#00d4ff' }}>origin_20260120205139.json</span></span>
        <span>LM:<span style={{ color: '#00d4ff' }}>{map?.points.filter(p=>p.cls==='LocationMark').length ?? 0}</span> AP:<span style={{ color: '#00d4ff' }}>{map?.points.filter(p=>p.cls==='ActionPoint').length ?? 0}</span></span>
        <span style={{ marginLeft: 'auto' }}>AiTEN Fleet DT v0.1.0</span>
      </div>
    </div>
  )
}
