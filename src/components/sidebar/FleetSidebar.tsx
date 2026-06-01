/**
 * FleetSidebar — left column: list of MAPS (switchable) on top, the live
 * AMR list below, plus an "+ Add AMR" affordance. Replaces the old
 * model-picker sidebar.
 */
import type { Robot } from '@/types'
import { RobotList } from './RobotList'
import { useConfigStore } from '@/store/config.store'

interface Props {
  robots: Robot[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAddAmr: () => void
  onManageMaps: () => void
}

export function FleetSidebar({ robots, selectedId, onSelect, onAddAmr, onManageMaps }: Props) {
  const maps = useConfigStore(s => s.maps)
  const activeMapId = useConfigStore(s => s.activeMapId)
  const setActiveMap = useConfigStore(s => s.setActiveMap)

  return (
    <div style={{ width: 200, background: '#ffffff', borderRight: '1px solid #d4dae3', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
      {/* MAPS */}
      <SectionHead label={`Maps · ${maps.length}`} action="⚙" onAction={onManageMaps} />
      <div style={{ maxHeight: 150, overflowY: 'auto', flexShrink: 0 }}>
        {maps.map(m => {
          const active = m.id === activeMapId
          return (
            <button key={m.id} onClick={() => setActiveMap(m.id)}
              style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px',
                cursor: 'pointer', background: active ? 'rgba(37,99,235,0.07)' : 'transparent',
                borderLeft: active ? '2px solid #2563eb' : '2px solid transparent', borderBottom: '1px solid rgba(212,218,227,0.6)',
                borderTop: 'none', borderRight: 'none', fontFamily: 'Inter, "Noto Sans JP", sans-serif' }}>
              <span style={{ fontSize: 11, color: active ? '#2563eb' : '#4a5568' }}>🗺</span>
              <span style={{ flex: 1, fontSize: 11, color: active ? '#2563eb' : '#1a2230', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              {m.source === 'uploaded' && <span style={{ fontSize: 8, color: '#64748b' }}>UP</span>}
            </button>
          )
        })}
      </div>

      {/* AMRs */}
      <SectionHead label={`AMR Fleet · ${robots.length}`} action="+ Add" onAction={onAddAmr} />
      {robots.length === 0 ? (
        <div style={{ padding: '12px', fontSize: 10, color: '#94a3b4', lineHeight: 1.5 }}>
          No AMRs. Click <b style={{ color: '#2563eb' }}>+ Add</b> to register a robot, or START SIM for demo bots.
        </div>
      ) : (
        <RobotList robots={robots} selectedId={selectedId} onSelect={onSelect} />
      )}
    </div>
  )
}

function SectionHead({ label, action, onAction }: { label: string; action: string; onAction: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px 6px', borderBottom: '1px solid #d4dae3', flexShrink: 0 }}>
      <span style={{ fontSize: 9, letterSpacing: 2, color: '#64748b', textTransform: 'uppercase' }}>{label}</span>
      <button onClick={onAction}
        style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'Roboto Mono', cursor: 'pointer', color: '#2563eb',
          border: '1px solid rgba(37,99,235,0.3)', background: 'rgba(37,99,235,0.06)', borderRadius: 2, padding: '1px 6px' }}>
        {action}
      </button>
    </div>
  )
}
