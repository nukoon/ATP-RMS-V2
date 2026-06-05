/**
 * MapService — Loads and parses VDA5050-compatible map JSON
 * Supports ATP map format (advancedPointList / advancedCurveList)
 */
import type { FleetMap, MapPoint, MapCurve, MapArea, NodeClass } from '@/types'

type XY = { x: number; y: number }
interface RawMapPoint {
  instanceName: string
  stationName?: string
  className: string
  pos: { x: number; y: number; theta?: number }
  dir?: number              // SEER smap: heading in RADIANS (no pos.theta)
}

interface RawMapCurveProp { key: string; int32Value?: number }
interface RawMapCurve {
  instanceName: string
  routeType?: 'line' | 'bezier'   // ATP export; SEER omits it (uses className)
  className?: string
  startPos: { pos: { x: number; y: number }; instanceName: string }
  endPos:   { pos: { x: number; y: number }; instanceName: string }
  trajectory?: { controlPoints?: XY[] }   // ATP control points
  controlPos1?: XY                        // SEER DegenerateBezier control points
  controlPos2?: XY
  property?: RawMapCurveProp[]
}

interface RawMapArea {
  instanceName: string
  zoneType?: string
  zonePolygon?: { x: number; y: number }[]
}

const radToDeg = (r: number) => (r * 180) / Math.PI

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
    name:  p.stationName ?? p.instanceName,
    cls:   parseClass(p.className),
    x:     p.pos.x,
    y:     p.pos.y,
    // ATP gives pos.theta in DEGREES; SEER gives heading in `dir` (RADIANS)
    theta: typeof p.pos.theta === 'number' ? p.pos.theta : (typeof p.dir === 'number' ? radToDeg(p.dir) : 0),
  }))

  const curves: MapCurve[] = (raw.advancedCurveList ?? []).map(c => {
    // control points: ATP trajectory.controlPoints, else SEER controlPos1/2
    const cp = c.trajectory?.controlPoints ?? [c.controlPos1, c.controlPos2].filter((q): q is XY => !!q)
    return {
      id:    c.instanceName,
      // routeType when present; else infer (control points → bezier, else line)
      type:  c.routeType ?? (cp.length ? 'bezier' : 'line'),
      sNode: c.startPos.instanceName,
      eNode: c.endPos.instanceName,
      sx:    c.startPos.pos.x,
      sy:    c.startPos.pos.y,
      ex:    c.endPos.pos.x,
      ey:    c.endPos.pos.y,
      cp,
      // "direction" property: 0 = Forward (正向), 1 = Reverse (反向)
      reverse: (c.property?.find(p => p.key === 'direction')?.int32Value ?? 0) === 1,
    }
  })

  const areas: MapArea[] = (raw.advancedAreaList ?? []).map(a => ({
    id:   a.instanceName,
    type: a.zoneType ?? '',
    poly: a.zonePolygon ?? [],   // SEER areas use posGroup (not rendered) → empty poly
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
