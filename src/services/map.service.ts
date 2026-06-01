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

interface RawMapCurveProp { key: string; int32Value?: number }
interface RawMapCurve {
  instanceName: string
  routeType: 'line' | 'bezier'
  startPos: { pos: { x: number; y: number }; instanceName: string }
  endPos:   { pos: { x: number; y: number }; instanceName: string }
  trajectory?: { controlPoints?: { x: number; y: number }[] }
  property?: RawMapCurveProp[]
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

/** Normalize a raw ATP map object into our FleetMap shape. */
export function parseMap(raw: RawMap): FleetMap {
  const points: MapPoint[] = (raw.advancedPointList ?? []).map(p => ({
    id:    p.instanceName,
    name:  p.stationName,
    cls:   parseClass(p.className),
    x:     p.pos.x,
    y:     p.pos.y,
    theta: p.pos.theta,
  }))

  const curves: MapCurve[] = (raw.advancedCurveList ?? []).map(c => ({
    id:    c.instanceName,
    type:  c.routeType,
    sNode: c.startPos.instanceName,
    eNode: c.endPos.instanceName,
    sx:    c.startPos.pos.x,
    sy:    c.startPos.pos.y,
    ex:    c.endPos.pos.x,
    ey:    c.endPos.pos.y,
    cp:    c.trajectory?.controlPoints ?? [],
    // ATP "direction" property: 0 = Forward (正向), 1 = Reverse (反向)
    reverse: (c.property?.find(p => p.key === 'direction')?.int32Value ?? 0) === 1,
  }))

  const areas: MapArea[] = (raw.advancedAreaList ?? []).map(a => ({
    id:   a.instanceName,
    type: a.zoneType,
    poly: a.zonePolygon ?? [],
  }))

  return { points, curves, areas }
}

export async function loadMap(url: string): Promise<FleetMap> {
  const res  = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load map: ${res.status}`)
  return parseMap(await res.json())
}

/** Parse an uploaded ATP map from a raw JSON string. */
export function loadMapFromJson(json: string): FleetMap {
  return parseMap(JSON.parse(json) as RawMap)
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
