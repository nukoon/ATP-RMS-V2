/**
 * MapService — Loads and parses VDA5050-compatible map JSON
 * Supports ATP map format (advancedPointList / advancedCurveList)
 */
import type { FleetMap, MapPoint, MapCurve, MapArea, NodeClass } from '@/types'

interface RawMapPoint {
  instanceName: string
  stationName: string
  className: string
  pos: { x: number; y: number; theta: number }
}

interface RawMapCurve {
  instanceName: string
  routeType: 'line' | 'bezier'
  startPos: { pos: { x: number; y: number }; instanceName: string }
  endPos:   { pos: { x: number; y: number }; instanceName: string }
  trajectory?: { controlPoints?: { x: number; y: number }[] }
}

interface RawMapArea {
  instanceName: string
  zoneType: string
  zonePolygon: { x: number; y: number }[]
}

interface RawMap {
  advancedPointList: RawMapPoint[]
  advancedCurveList: RawMapCurve[]
  advancedAreaList:  RawMapArea[]
}

function parseClass(cls: string): NodeClass {
  if (cls === 'Charge') return 'Charge'
  if (cls === 'ActionPoint') return 'ActionPoint'
  return 'LocationMark'
}

export async function loadMap(url: string): Promise<FleetMap> {
  const res  = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load map: ${res.status}`)
  const raw: RawMap = await res.json()

  const points: MapPoint[] = raw.advancedPointList.map(p => ({
    id:    p.instanceName,
    name:  p.stationName,
    cls:   parseClass(p.className),
    x:     p.pos.x,
    y:     p.pos.y,
    theta: p.pos.theta,
  }))

  const curves: MapCurve[] = raw.advancedCurveList.map(c => ({
    id:   c.instanceName,
    type: c.routeType,
    sx:   c.startPos.pos.x,
    sy:   c.startPos.pos.y,
    ex:   c.endPos.pos.x,
    ey:   c.endPos.pos.y,
    cp:   c.trajectory?.controlPoints ?? [],
  }))

  const areas: MapArea[] = raw.advancedAreaList.map(a => ({
    id:   a.instanceName,
    type: a.zoneType,
    poly: a.zonePolygon ?? [],
  }))

  return { points, curves, areas }
}

export function buildNodeMap(map: FleetMap): Map<string, MapPoint> {
  return new Map(map.points.map(p => [p.id, p]))
}

export function getMapBounds(map: FleetMap) {
  const xs = map.points.map(p => p.x)
  const ys = map.points.map(p => p.y)
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    width:  Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}
