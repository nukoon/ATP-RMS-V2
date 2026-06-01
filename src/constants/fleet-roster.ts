// ============================================================
// ATP-RMS-V2 — Fleet roster
// Our own ATP demo fleet — a mixed-model fleet covering the AGV
// types we ship SVG assets for. This is OUR definition, not data
// imported from any customer site.
// Per-model physical specs live in ./agv-specs.ts (AGV_SPECS).
// ============================================================
import type { AgvModel } from '@/types'

export interface FleetMember {
  id: string          // display name (ATP-NN)
  model: AgvModel
  color: string       // identity colour (status-independent)
}

export const FLEET_ROSTER: FleetMember[] = [
  { id: 'ATP-01', model: 'AM15',  color: '#00d4ff' },
  { id: 'ATP-02', model: 'AM15',  color: '#00ff88' },
  { id: 'ATP-03', model: 'MP10S', color: '#ffb800' },
  { id: 'ATP-04', model: 'AS15',  color: '#ff6b6b' },
  { id: 'ATP-05', model: 'TP30',  color: '#a78bfa' },
  { id: 'ATP-06', model: 'TT30',  color: '#ff8c00' },
]

export const memberOf = (id: string): FleetMember | undefined =>
  FLEET_ROSTER.find(f => f.id === id)

export const colorOf = (id: string): string => memberOf(id)?.color ?? '#00d4ff'
