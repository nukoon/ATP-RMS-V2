/**
 * MapCanvas — Main 2D fleet map renderer (Canvas API)
 * Draws: grid, zones, edges (bezier+line), nodes, robot paths, robots
 */
import { useEffect, useRef, useCallback, useState, type ReactNode } from 'react'
import type { FleetMap, Robot, MapViewConfig, MapPoint } from '@/types'
import type { Storage, Dock, StorageArea, TrafficArea } from '@/types/fleet'
import type { Transform } from '@/utils/canvas'
import { worldToScreen, screenToWorld, thetaToScreenRot } from '@/utils/canvas'
import { STATUS_COLOR, AGV_ASSET_PATH } from '@/constants'
import { getCanvas } from '@/theme'
import { useStorageStore } from '@/store/storage.store'
import { useFleetStore } from '@/store/fleet.store'
import type { useMapTransform } from '@/hooks/useMapTransform'

interface Props {
  map:       FleetMap
  robots:    Robot[]
  config:    MapViewConfig
  selectedRobotId: string | null
  onRobotClick:  (id: string | null) => void
  onHover?: (world: { x: number; y: number } | null) => void
  ctrl: ReturnType<typeof useMapTransform>
  // rubber-band node selection (multi-add storage): drag a box to pick nodes
  selectMode?: boolean
  onSelectNodes?: (ids: string[]) => void
  // right-click a storage area on the map → context menu (batch FULL/EMPTY)
  onAreaContextMenu?: (areaId: string, clientX: number, clientY: number) => void
}

const EMPTY_SET: Set<string> = new Set()

// Image cache
const imgCache = new Map<string, HTMLImageElement>()
function getCachedImg(src: string): HTMLImageElement {
  if (!imgCache.has(src)) {
    const img = new Image()
    img.src = src
    imgCache.set(src, img)
  }
  return imgCache.get(src)!
}

export function MapCanvas({ map, robots, config, selectedRobotId, onRobotClick, onHover, ctrl, selectMode, onSelectNodes, onAreaContextMenu }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef   = useRef<number>()
  // rubber-band selection rectangle (screen px), drawn each frame via a ref
  const selRectRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const selectingRef = useRef(false)
  const selectModeRef = useRef(selectMode)
  selectModeRef.current = selectMode
  const t = ctrl.transform
  const tRef = useRef(t)
  tRef.current = t
  const fittedRef = useRef(false)
  const movedRef  = useRef(false)
  // storages are read from the store and drawn each frame via a ref
  const storages = useStorageStore(s => s.storages)
  const storagesRef = useRef<Storage[]>(storages)
  storagesRef.current = storages
  const docks = useStorageStore(s => s.docks)
  const docksRef = useRef<Dock[]>(docks)
  docksRef.current = docks
  const areas = useStorageStore(s => s.areas)
  const areasRef = useRef<StorageArea[]>(areas)
  areasRef.current = areas
  const trafficAreas = useStorageStore(s => s.trafficAreas)
  const trafficRef = useRef<TrafficArea[]>(trafficAreas)
  trafficRef.current = trafficAreas
  // edge traffic-density heatmap (sim-accumulated), drawn each frame via a ref
  const edgeHeat = useFleetStore(s => s.edgeHeat)
  const edgeHeatRef = useRef<Map<string, number>>(edgeHeat)
  edgeHeatRef.current = edgeHeat
  // storages currently reserved by an active job → show an "occupy" badge
  const missions = useFleetStore(s => s.missions)
  const occupiedRef = useRef<Set<string>>(new Set())
  occupiedRef.current = new Set(
    missions
      .filter(m => m.status === 'EXECUTING' || m.status === 'ASSIGNED')
      .flatMap(m => [m.pickupStorageId, m.dropoffStorageId])
      .filter((id): id is string => !!id),
  )
  // clicked node → info card + canvas highlight (drawn from world coords each frame)
  const [selectedNode, setSelectedNode] = useState<MapPoint | null>(null)
  const selectedNodeRef = useRef<MapPoint | null>(null)
  selectedNodeRef.current = selectedNode

  // Keep canvas pixel size in sync with its CSS box; fit map on first size
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas
      if (w && h && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w
        canvas.height = h
      }
      if (!fittedRef.current && w && h && map) {
        ctrl.fitToCanvas(w, h)
        fittedRef.current = true
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [map, ctrl])

  // Draw loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const tt = tRef.current
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (config.showGrid) drawGrid(ctx, canvas.width, canvas.height, tt)
    drawAxes(ctx, tt)
    drawEdges(ctx, map, tt, config)
    if (config.showHeatmap) drawEdgeHeat(ctx, map, edgeHeatRef.current, tt)
    robots.forEach(r => drawRobotPath(ctx, map, r, tt, config))
    // when storage is shown, its icon stands in for the bound node (hide that node)
    const storageNodes = config.showStorage
      ? new Set(storagesRef.current.filter(s => s.enabled).map(s => s.nodeId))
      : EMPTY_SET
    if (config.showTraffic) drawTrafficAreas(ctx, map, trafficRef.current, tt, config)
    if (config.showStorage) drawAreas(ctx, map, areasRef.current, storagesRef.current, tt, config)
    drawNodes(ctx, map, tt, config, storageNodes)
    if (config.showStorage) drawDocks(ctx, map, docksRef.current, tt)
    if (config.showStorage) drawStorages(ctx, map, storagesRef.current, occupiedRef.current, tt, config)
    if (config.showRobots) robots.forEach(r => drawRobot(ctx, r, tt, config, selectedRobotId))

    // highlight the clicked node
    const sn = selectedNodeRef.current
    if (sn) {
      const { sx, sy } = worldToScreen(sn.x, sn.y, tt)
      ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2)
      ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([])
    }

    // rubber-band selection box
    const r = selRectRef.current
    if (r) {
      const x = Math.min(r.x0, r.x1), y = Math.min(r.y0, r.y1)
      const w = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0)
      ctx.fillStyle = 'rgba(37,99,235,0.10)'; ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([])
    }

    animRef.current = requestAnimationFrame(draw)
  }, [map, robots, config, selectedRobotId])

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [draw])

  // Wheel zoom (non-passive so we can preventDefault)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      const rect = canvas.getBoundingClientRect()
      ctrl.handleWheel(e, e.clientX - rect.left, e.clientY - rect.top)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [ctrl])

  const pos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    movedRef.current = false
    const { x, y } = pos(e)
    if (selectModeRef.current) { selectingRef.current = true; selRectRef.current = { x0: x, y0: y, x1: x, y1: y }; return }
    ctrl.handleMouseDown(x, y)
  }, [ctrl])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (e.buttons === 1) movedRef.current = true
    const { x, y } = pos(e)
    if (selectModeRef.current && selectingRef.current && selRectRef.current) {
      selRectRef.current = { ...selRectRef.current, x1: x, y1: y }
      onHover?.(screenToWorld(x, y, tRef.current))
      return
    }
    ctrl.handleMouseMove(x, y)
    onHover?.(screenToWorld(x, y, tRef.current))
  }, [ctrl, onHover])

  const finishSelection = useCallback(() => {
    const r = selRectRef.current
    selectingRef.current = false
    selRectRef.current = null
    if (!r) return
    const minX = Math.min(r.x0, r.x1), maxX = Math.max(r.x0, r.x1)
    const minY = Math.min(r.y0, r.y1), maxY = Math.max(r.y0, r.y1)
    if (maxX - minX < 4 && maxY - minY < 4) return  // a click, not a drag
    const ids: string[] = []
    for (const p of map.points) {
      const { sx, sy } = worldToScreen(p.x, p.y, tRef.current)
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) ids.push(p.id)
    }
    onSelectNodes?.(ids)
  }, [map, onSelectNodes])

  const onMouseUp = useCallback(() => {
    if (selectModeRef.current) { finishSelection(); return }
    ctrl.handleMouseUp()
  }, [ctrl, finishSelection])
  const onLeave = useCallback(() => {
    if (selectModeRef.current && selectingRef.current) finishSelection()
    ctrl.handleMouseUp(); onHover?.(null)
  }, [ctrl, onHover, finishSelection])

  // Click → robot selection, else node info, else clear (suppressed on drag)
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (movedRef.current || selectModeRef.current) return
    const { x: mx, y: my } = pos(e)
    const hitR = Math.max(14, config.robotSize * 0.6)
    for (const r of robots) {
      const { sx, sy } = worldToScreen(r.pose.x, r.pose.y, tRef.current)
      if (Math.hypot(mx - sx, my - sy) < hitR) {
        onRobotClick(selectedRobotId === r.id ? null : r.id)
        setSelectedNode(null)
        return
      }
    }
    // node hit-test (nearest within ~12px)
    let best: MapPoint | null = null, bestD = 12
    for (const p of map.points) {
      const { sx, sy } = worldToScreen(p.x, p.y, tRef.current)
      const d = Math.hypot(mx - sx, my - sy)
      if (d < bestD) { bestD = d; best = p }
    }
    if (best) { setSelectedNode(prev => prev?.id === best!.id ? null : best); onRobotClick(null); return }
    onRobotClick(null); setSelectedNode(null)
  }, [robots, map, config.robotSize, selectedRobotId, onRobotClick])

  // right-click → if the cursor is inside a storage area's box, open its menu
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (!onAreaContextMenu) return
    const { x: mx, y: my } = pos(e)
    const tt = tRef.current
    const pad = 2.0
    let hit: string | null = null
    for (const a of areasRef.current) {
      if (!a.enabled) continue
      const pts = storagesRef.current
        .filter(s => s.areaId === a.id && s.enabled)
        .map(s => map.points.find(p => p.id === s.nodeId))
        .filter((p): p is MapPoint => !!p)
      if (!pts.length) continue
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
      const tl = worldToScreen(Math.min(...xs) - pad, Math.max(...ys) + pad, tt)
      const br = worldToScreen(Math.max(...xs) + pad, Math.min(...ys) - pad, tt)
      if (mx >= tl.sx && mx <= br.sx && my >= tl.sy && my <= br.sy) hit = a.id  // topmost wins
    }
    if (hit) { e.preventDefault(); onAreaContextMenu(hit, e.clientX, e.clientY) }
  }, [map, onAreaContextMenu])

  const np = selectedNode ? worldToScreen(selectedNode.x, selectedNode.y, t) : null

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', cursor: selectMode ? 'crosshair' : 'grab' }}
        onClick={handleClick}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onLeave}
        onContextMenu={onContextMenu}
      />
      {selectedNode && np && <NodeInfoCard node={selectedNode} sx={np.sx} sy={np.sy} onClose={() => setSelectedNode(null)} />}
      <ZoomControl ctrl={ctrl} />
    </div>
  )
}

// Small info card anchored at a clicked node: id, type, world position.
function NodeInfoCard({ node, sx, sy, onClose }: { node: MapPoint; sx: number; sy: number; onClose: () => void }) {
  const cls = node.cls === 'Charge' ? 'Charge' : node.cls === 'ActionPoint' ? 'Action Point' : 'Location Mark'
  const accent = node.cls === 'Charge' ? '#b45309' : node.cls === 'ActionPoint' ? '#c2410c' : '#1d4ed8'
  const [closeHover, setCloseHover] = useState(false)
  return (
    <div onClick={e => e.stopPropagation()}
      style={{ position: 'absolute', left: Math.max(6, sx + 14), top: Math.max(6, sy + 14), zIndex: 6,
        minWidth: 168, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.28)', padding: '9px 11px 10px',
        fontFamily: 'Inter, "Noto Sans JP", sans-serif', color: 'var(--text)' }}>
      {/* class chip (dot + label, not a colored side-stripe) + close */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9, fontWeight: 700,
          letterSpacing: 0.6, textTransform: 'uppercase', color: accent,
          background: accent + '14', border: `1px solid ${accent}33`, borderRadius: 5, padding: '2px 7px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent }} />
          {cls}
        </span>
        <button onClick={onClose} aria-label="Close"
          onMouseEnter={() => setCloseHover(true)} onMouseLeave={() => setCloseHover(false)}
          onFocus={() => setCloseHover(true)} onBlur={() => setCloseHover(false)}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, borderRadius: 5, border: 'none', cursor: 'pointer', outline: 'none',
            color: closeHover ? '#ef4444' : 'var(--text-faint)', background: closeHover ? 'rgba(220,38,38,0.12)' : 'transparent',
            fontSize: 15, lineHeight: 1, transition: 'background 130ms ease, color 130ms ease' }}>×</button>
      </div>
      <div style={{ fontFamily: 'Roboto Mono', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginTop: 7 }}>{node.id}</div>
      {node.name && node.name !== node.id && <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 1 }}>{node.name}</div>}
      <div style={{ height: 1, background: 'var(--border)', margin: '8px 0 7px' }} />
      <div style={{ fontFamily: 'Roboto Mono', fontSize: 11, color: 'var(--text)', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px' }}>
        <span style={{ color: 'var(--text-muted)' }}>X</span><span>{node.x.toFixed(3)} m</span>
        <span style={{ color: 'var(--text-muted)' }}>Y</span><span>{node.y.toFixed(3)} m</span>
        <span style={{ color: 'var(--text-muted)' }}>θ</span><span>{node.theta.toFixed(1)}°</span>
      </div>
    </div>
  )
}

// Floating zoom control overlaid on the map (bottom-right), Google-Maps style:
// segmented in / out / fit stack plus a live scale readout.
const zoomIconProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
function ZoomBtn({ icon, onClick, title }: { icon: ReactNode; onClick: () => void; title: string }) {
  const [hover, setHover] = useState(false)
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)} onBlur={() => setHover(false)}
      style={{ width: 32, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', padding: 0, cursor: 'pointer', outline: 'none',
        color: hover ? 'var(--accent)' : 'var(--text-2)', background: hover ? 'var(--surface-2)' : 'var(--surface)',
        transition: 'background 140ms ease, color 140ms ease' }}>
      {icon}
    </button>
  )
}
function ZoomControl({ ctrl }: { ctrl: ReturnType<typeof useMapTransform> }) {
  return (
    <div style={{ position: 'absolute', right: 14, bottom: 14, zIndex: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, userSelect: 'none' }}>
      <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 9, boxShadow: '0 4px 16px rgba(0,0,0,0.28)', overflow: 'hidden' }}>
        <ZoomBtn title="Zoom in" onClick={ctrl.zoomIn} icon={<svg {...zoomIconProps}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>} />
        <div style={{ height: 1, background: 'var(--border)' }} />
        <ZoomBtn title="Zoom out" onClick={ctrl.zoomOut} icon={<svg {...zoomIconProps}><line x1="5" y1="12" x2="19" y2="12" /></svg>} />
        <div style={{ height: 1, background: 'var(--border)' }} />
        <ZoomBtn title="Fit to view" onClick={() => ctrl.fitToCanvas()} icon={<svg {...zoomIconProps}><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg>} />
      </div>
      <span style={{ fontFamily: 'Roboto Mono, "Noto Sans JP", monospace', fontSize: 10, color: 'var(--text-2)',
        background: 'var(--surface)', padding: '1px 6px', borderRadius: 5, border: '1px solid var(--border)' }}>
        {ctrl.transform.scale.toFixed(2)}×
      </span>
    </div>
  )
}

// ── Draw helpers ─────────────────────────────────────────

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, t: Transform) {
  const step = 5 * t.scale
  if (step < 8) return
  ctx.strokeStyle = getCanvas().grid
  ctx.lineWidth = 1
  for (let x = ((t.offsetX % step) + step) % step; x < w; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
  }
  for (let y = ((t.offsetY % step) + step) % step; y < h; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
  }
}

// Storage markers: an SVG crate icon drawn ON TOP of the bound AP/LM node
// (FULL = loaded green crate, EMPTY = grey outline crate). Toggle "Store" off
// to reveal the node + its name underneath.
const STORAGE_ICON = { EMPTY: '/assets/icons/storage_empty.svg', FULL: '/assets/icons/storage_full.svg' }
const OCCUPY_ICON = '/assets/icons/occupy.png'
const STORAGE_M = 1.6   // carton footprint in metres — scales true-to-map like robots

function drawStorages(ctx: CanvasRenderingContext2D, map: FleetMap, storages: Storage[], occupied: Set<string>, t: Transform, cfg: MapViewConfig) {
  // Proportional to the map (metres × zoom) so it tracks zoom smoothly, with a
  // small px floor so it stays visible when zoomed far out. No upper clamp.
  const sz = Math.max(14, STORAGE_M * t.scale)
  const half = sz / 2
  // Pass 1: draw the crate icons (+ occupy badge), and collect label candidates
  // so the names can be laid out afterwards without crate icons covering them.
  type Lbl = { sx: number; topY: number; text: string; col: string }
  const labels: Lbl[] = []
  for (const s of storages) {
    if (!s.enabled) continue
    const node = map.points.find(p => p.id === s.nodeId)
    if (!node) continue
    const { sx, sy } = worldToScreen(node.x, node.y, t)
    const full = s.state === 'FULL'
    const col = full ? '#16a34a' : '#7c93a8'

    const img = getCachedImg(full ? STORAGE_ICON.FULL : STORAGE_ICON.EMPTY)
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, sx - half, sy - half, sz, sz)
    } else {
      // vector fallback until the SVG loads
      const h = sz * 0.34
      ctx.beginPath(); ctx.roundRect(sx - h, sy - h, h * 2, h * 2, 2)
      ctx.fillStyle = full ? 'rgba(22,163,74,0.22)' : 'rgba(124,147,168,0.15)'
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke()
    }

    // "occupy" marker overlaid on the crate when a running job reserves this
    // pickup/dropoff point (centred, ~crate-sized).
    if (occupied.has(s.id)) {
      const bs = sz * 0.95
      const oimg = getCachedImg(OCCUPY_ICON)
      if (oimg.complete && oimg.naturalWidth > 0) {
        ctx.drawImage(oimg, sx - bs / 2, sy - bs / 2, bs, bs)
      } else {
        ctx.beginPath(); ctx.arc(sx, sy, bs / 2, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(34,211,238,0.85)'; ctx.fill()
      }
    }

    if (t.scale >= cfg.labelZoomThreshold) labels.push({ sx, topY: sy - half, text: s.name, col })
  }

  // Pass 2: name labels in a SINGLE row just above each crate. Densely-packed
  // crates would overlap into an unreadable run, so we declutter exactly like
  // the node labels: keep a list of placed boxes and SKIP any label that would
  // collide with one already drawn (so zooming out shows fewer names, zooming
  // in reveals them all). No stacking — that just piles into a noisy block.
  if (!labels.length) return
  const lblPx = Math.max(8, cfg.labelSize - 2)
  ctx.font = `bold ${lblPx}px Roboto Mono, "Noto Sans JP", monospace`
  ctx.textAlign = 'center'
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const L of [...labels].sort((a, b) => a.sx - b.sx)) {
    const lw = ctx.measureText(L.text).width
    const ly = L.topY - 3
    const box = { x1: L.sx - lw / 2 - 2, y1: ly - lblPx, x2: L.sx + lw / 2 + 2, y2: ly + 3 }
    if (placed.some(q => box.x1 < q.x2 && box.x2 > q.x1 && box.y1 < q.y2 && box.y2 > q.y1)) continue
    placed.push(box)
    ctx.fillStyle = getCanvas().labelBg
    ctx.fillRect(box.x1, ly - lblPx, lw + 4, lblPx + 3)
    ctx.fillStyle = L.col
    ctx.fillText(L.text, L.sx, ly)
  }
}

// Storage AREAS: a translucent bounding box around all member storage nodes,
// so a batch pickup/drop group reads as one zone on the map.
function drawAreas(ctx: CanvasRenderingContext2D, map: FleetMap, areas: StorageArea[], storages: Storage[], t: Transform, cfg: MapViewConfig) {
  const pad = 2.0 // metres of padding so the box clears the crates
  for (const a of areas) {
    if (!a.enabled) continue
    const members = storages.filter(s => s.areaId === a.id && s.enabled)
    const pts = members.map(s => map.points.find(p => p.id === s.nodeId)).filter((p): p is MapPoint => !!p)
    if (pts.length < 1) continue
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad
    const a1 = worldToScreen(minX, maxY, t)   // top-left (maxY = up)
    const a2 = worldToScreen(maxX, minY, t)   // bottom-right
    const x = a1.sx, y = a1.sy, w = a2.sx - a1.sx, h = a2.sy - a1.sy
    const col = a.kind === 'PICK' ? '#2563eb' : a.kind === 'DROP' ? '#f59e0b' : '#7c3aed'
    // soft fill + a clean rounded dashed border (round caps read smoother)
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8)
    ctx.fillStyle = col + '10'; ctx.fill()
    ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.setLineDash([6, 5]); ctx.stroke()
    ctx.setLineDash([]); ctx.lineCap = 'butt'; ctx.globalAlpha = 1

    // name in a solid pill straddling the top-left corner (readable over content)
    if (t.scale >= cfg.labelZoomThreshold) {
      const lblPx = Math.max(9, cfg.labelSize - 1)
      ctx.font = `bold ${lblPx}px Roboto Mono, "Noto Sans JP", monospace`
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      const text = a.name
      const tw = ctx.measureText(text).width
      const chipH = lblPx + 7, chipW = tw + 14
      ctx.save()
      ctx.shadowColor = 'rgba(26,34,48,0.22)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1
      ctx.beginPath(); ctx.roundRect(x + 6, y - chipH / 2, chipW, chipH, 5)
      ctx.fillStyle = col; ctx.fill()
      ctx.restore()
      ctx.fillStyle = '#ffffff'; ctx.fillText(text, x + 13, y + 0.5)
      ctx.textBaseline = 'alphabetic'
    }
  }
}

// TRAFFIC AREAS: operator-defined mutual-exclusion zones (red hatched box).
// distinct colour per traffic zone (cycled)
const TRAFFIC_COLORS = ['#dc2626', '#7c3aed', '#0891b2', '#ea7a00', '#16a34a', '#db2777', '#2563eb', '#f59e0b']
function drawTrafficAreas(ctx: CanvasRenderingContext2D, map: FleetMap, zones: TrafficArea[], t: Transform, _cfg: MapViewConfig) {
  // a small DASHED ring per node in each zone — no box, no name label
  const r = Math.max(5, t.scale * 0.5)
  const dash = Math.max(2, r * 0.5)
  ctx.lineWidth = 1.4; ctx.lineCap = 'round'
  zones.forEach((z, zi) => {
    if (!z.enabled) return
    const col = TRAFFIC_COLORS[zi % TRAFFIC_COLORS.length]
    for (const id of z.nodeIds) {
      const p = map.points.find(n => n.id === id)
      if (!p) continue
      const { sx, sy } = worldToScreen(p.x, p.y, t)
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fillStyle = col + '14'; ctx.fill()
      ctx.strokeStyle = col + 'dd'; ctx.setLineDash([dash, dash]); ctx.stroke()
    }
  })
  ctx.setLineDash([]); ctx.lineCap = 'butt'
}

// DOCKS: parking & charging points — a solid colour badge with a white glyph
// (⚡ bolt for CHARGE, P for PARK) so they read clearly over the lanes/nodes.
const DOCK_ICON = { PARK: '/assets/icons/standbyStation.svg', CHARGE: '/assets/icons/chargeStation.svg' }
const DOCK_M = 1.05  // badge footprint in metres (scales true-to-map, with a floor)

function drawDocks(ctx: CanvasRenderingContext2D, map: FleetMap, docks: Dock[], t: Transform) {
  const sz = Math.max(13, DOCK_M * t.scale)
  const half = sz / 2
  const rad = sz * 0.28
  for (const d of docks) {
    if (!d.enabled) continue
    const node = map.points.find(p => p.id === d.nodeId)
    if (!node) continue
    const { sx, sy } = worldToScreen(node.x, node.y, t)
    const charge = d.type === 'CHARGE'
    const col = charge ? '#ea7a00' : '#2563eb'

    // colour badge with a drop shadow + white outline so it pops off the map
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.30)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1
    ctx.beginPath(); ctx.roundRect(sx - half, sy - half, sz, sz, rad)
    ctx.fillStyle = col; ctx.fill()
    ctx.restore()
    ctx.beginPath(); ctx.roundRect(sx - half, sy - half, sz, sz, rad)
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.2, sz * 0.07); ctx.stroke()

    // white glyph centred (the SVGs are white-filled, made for a colour bg)
    const g = getCachedImg(charge ? DOCK_ICON.CHARGE : DOCK_ICON.PARK)
    const gs = sz * 0.6
    if (g.complete && g.naturalWidth > 0) {
      ctx.drawImage(g, sx - gs / 2, sy - gs / 2, gs, gs)
    } else {
      ctx.fillStyle = '#fff'; ctx.font = `bold ${sz * 0.55}px Roboto Mono, "Noto Sans JP", monospace`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(charge ? '⚡' : 'P', sx, sy + 0.5); ctx.textBaseline = 'alphabetic'
    }

    // bound robot id under the badge
    if (d.agvId) {
      ctx.font = `bold ${Math.max(8, sz * 0.34)}px Roboto Mono, "Noto Sans JP", monospace`
      ctx.textAlign = 'center'
      const lw = ctx.measureText(d.agvId).width
      const ly = sy + half + Math.max(9, sz * 0.34)
      ctx.fillStyle = getCanvas().labelBg; ctx.fillRect(sx - lw / 2 - 2, ly - Math.max(8, sz * 0.34), lw + 4, Math.max(10, sz * 0.4))
      ctx.fillStyle = col; ctx.fillText(d.agvId, sx, ly)
    }
  }
}

// NB: map `advancedAreaList` (area-control zones) is intentionally NOT rendered
// in the fleet view — area control + AMR-area mapping is handled by the robots'
// low-level controller, not this dashboard.

// A small triangular arrowhead at (x,y) pointing along `angle` (canvas radians).
function drawArrowhead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, color: string) {
  ctx.save()
  ctx.translate(x, y); ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(size, 0)
  ctx.lineTo(-size * 0.7, size * 0.7)
  ctx.lineTo(-size * 0.7, -size * 0.7)
  ctx.closePath()
  ctx.fillStyle = color; ctx.fill()
  ctx.restore()
}

// World point on a curve at parameter t (line or bezier), for arrow placement.
function curveWorld(c: FleetMap['curves'][number], t: number): { x: number; y: number } {
  if (c.type === 'bezier' && c.cp.length >= 2) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t
    return { x: a * c.sx + b * c.cp[0].x + d * c.cp[1].x + e * c.ex, y: a * c.sy + b * c.cp[0].y + d * c.cp[1].y + e * c.ey }
  }
  if (c.type === 'bezier' && c.cp.length === 1) {
    const u = 1 - t
    return { x: u * u * c.sx + 2 * u * t * c.cp[0].x + t * t * c.ex, y: u * u * c.sy + 2 * u * t * c.cp[0].y + t * t * c.ey }
  }
  return { x: c.sx + (c.ex - c.sx) * t, y: c.sy + (c.ey - c.sy) * t }
}

// Red +X / green +Y axes at the world origin (matches the reference frame marker).
function drawAxes(ctx: CanvasRenderingContext2D, t: Transform) {
  const o = worldToScreen(0, 0, t)
  const len = Math.max(34, Math.min(70, t.scale * 14))
  ctx.lineWidth = 2.5; ctx.setLineDash([])
  // +X (east) → right, red
  ctx.strokeStyle = '#e0492f'; ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(o.sx + len, o.sy); ctx.stroke()
  drawArrowhead(ctx, o.sx + len, o.sy, 0, 6, '#e0492f')
  // +Y (north) → up, green
  ctx.strokeStyle = '#2fa84a'; ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(o.sx, o.sy - len); ctx.stroke()
  drawArrowhead(ctx, o.sx, o.sy - len, -Math.PI / 2, 6, '#2fa84a')
  ctx.font = '600 12px Inter, "Noto Sans JP", sans-serif'; ctx.textAlign = 'left'
  ctx.fillStyle = '#e0492f'; ctx.fillText('X', o.sx + len + 3, o.sy + 4)
  ctx.fillStyle = '#2fa84a'; ctx.fillText('Y', o.sx + 4, o.sy - len - 3)
}

function drawEdges(ctx: CanvasRenderingContext2D, map: FleetMap, t: Transform, cfg: MapViewConfig) {
  if (!cfg.showEdges) return
  const lw = Math.max(0.75, t.scale * 0.12)
  const tc = getCanvas()
  const EDGE = tc.edge          // soft steel-blue lane (theme-aware)
  const ARROW = tc.edgeArrow    // a darker shade of the lane, in-family
  // round caps + joins keep bezier lanes smooth and modern (no harsh corners)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([])
  for (const c of map.curves) {
    const { sx: ax, sy: ay } = worldToScreen(c.sx, c.sy, t)
    const { sx: bx, sy: by } = worldToScreen(c.ex, c.ey, t)
    if (Math.max(ax, bx) < -10 || Math.min(ax, bx) > ctx.canvas.width + 10) continue
    ctx.beginPath(); ctx.lineWidth = lw; ctx.strokeStyle = EDGE
    if (c.type === 'bezier' && c.cp.length >= 2) {
      const { sx: c1x, sy: c1y } = worldToScreen(c.cp[0].x, c.cp[0].y, t)
      const { sx: c2x, sy: c2y } = worldToScreen(c.cp[1].x, c.cp[1].y, t)
      ctx.moveTo(ax, ay); ctx.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by)
    } else if (c.type === 'bezier' && c.cp.length === 1) {
      const { sx: cpx, sy: cpy } = worldToScreen(c.cp[0].x, c.cp[0].y, t)
      ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cpx, cpy, bx, by)
    } else {
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
    }
    ctx.stroke()

    // direction arrow at the edge midpoint (travel is always sNode→eNode);
    // size scales with zoom like the nodes/labels (hidden in far overview)
    if (t.scale >= 2.5) {
      const wm = curveWorld(c, 0.5), wn = curveWorld(c, 0.54)
      const m = worldToScreen(wm.x, wm.y, t), n = worldToScreen(wn.x, wn.y, t)
      const ang = Math.atan2(n.sy - m.sy, n.sx - m.sx)
      drawArrowhead(ctx, m.sx, m.sy, ang, Math.max(2, Math.min(7, t.scale * 0.42)), ARROW)
    }
  }
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.setLineDash([])
}

// Heat ramp green→amber→red for a normalized value 0..1.
function heatColor(v: number): string {
  const stops = [[22, 163, 74], [245, 158, 11], [220, 38, 38]]  // green, amber, red
  const x = Math.max(0, Math.min(1, v)) * 2
  const i = Math.min(1, Math.floor(x))
  const f = x - i
  const a = stops[i], b = stops[i + 1]
  const c = a.map((ch, k) => Math.round(ch + (b[k] - ch) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

// EDGE HEATMAP: overlay each travelled lane with a translucent colour band
// whose hue (green→red) and width grow with how many times AGVs crossed it,
// so congestion / bottleneck corridors stand out. Sim-accumulated (edgeHeat).
function drawEdgeHeat(ctx: CanvasRenderingContext2D, map: FleetMap, heat: Map<string, number>, t: Transform) {
  if (!heat.size) return
  let max = 0
  for (const v of heat.values()) if (v > max) max = v
  if (max <= 0) return
  ctx.lineCap = 'round'
  for (const c of map.curves) {
    const h = heat.get(c.id)
    if (!h) continue
    const v = h / max                       // normalized density 0..1
    const { sx: ax, sy: ay } = worldToScreen(c.sx, c.sy, t)
    const { sx: bx, sy: by } = worldToScreen(c.ex, c.ey, t)
    if (Math.max(ax, bx) < -10 || Math.min(ax, bx) > ctx.canvas.width + 10) continue
    ctx.beginPath()
    ctx.lineWidth = Math.max(1.5, t.scale * (0.12 + v * 0.45))
    ctx.strokeStyle = heatColor(v)
    ctx.globalAlpha = 0.30 + v * 0.45
    if (c.type === 'bezier' && c.cp.length >= 2) {
      const { sx: c1x, sy: c1y } = worldToScreen(c.cp[0].x, c.cp[0].y, t)
      const { sx: c2x, sy: c2y } = worldToScreen(c.cp[1].x, c.cp[1].y, t)
      ctx.moveTo(ax, ay); ctx.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by)
    } else if (c.type === 'bezier' && c.cp.length === 1) {
      const { sx: cpx, sy: cpy } = worldToScreen(c.cp[0].x, c.cp[0].y, t)
      ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cpx, cpy, bx, by)
    } else {
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function drawNodes(ctx: CanvasRenderingContext2D, map: FleetMap, t: Transform, cfg: MapViewConfig, hiddenNodes: Set<string>) {
  // Dot radius scales with zoom (tiny in the overview, larger when zoomed in);
  // the "Node px" slider nudges it around the default of 3.
  const r = Math.max(1.2, Math.min(9, t.scale * 0.4 * (cfg.nodeSize / 3)))
  const showLbl = t.scale >= cfg.labelZoomThreshold
  // first pass: dots; second pass: labels with collision-skip so dense
  // clusters don't turn into an unreadable pile of overlapping text.
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = []
  type Vis = { p: typeof map.points[number]; sx: number; sy: number }
  const visible: Vis[] = []
  for (const p of map.points) {
    if (hiddenNodes.has(p.id)) continue
    if (p.cls === 'LocationMark' && !cfg.showLM) continue
    if (p.cls === 'ActionPoint'  && !cfg.showAP) continue
    if (p.cls === 'Charge'       && !cfg.showCH) continue
    const { sx, sy } = worldToScreen(p.x, p.y, t)
    if (sx < -20 || sx > ctx.canvas.width + 20) continue
    if (sy < -20 || sy > ctx.canvas.height + 20) continue
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2)
    if (p.cls === 'Charge') {
      ctx.fillStyle = 'rgba(245,158,11,0.55)'; ctx.strokeStyle = '#b45309'; ctx.lineWidth = 1.2
    } else if (p.cls === 'ActionPoint') {
      ctx.fillStyle = 'rgba(234,122,0,0.35)'; ctx.strokeStyle = '#c2410c'; ctx.lineWidth = 1.1
    } else {
      ctx.fillStyle = 'rgba(37,99,235,0.35)'; ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 1.1
    }
    ctx.fill(); ctx.stroke()
    visible.push({ p, sx, sy })
  }
  if (!showLbl) return
  // Label size grows with zoom: small in the overview, detailed when zoomed in
  // (capped at the toolbar "Label px"). 9px floor keeps it readable on a wall
  // display; the node dot above already carries the class colour, so the id
  // text stays a neutral ink for hierarchy (type vs. name read on two channels).
  const lblPx = Math.round(Math.max(9, Math.min(cfg.labelSize, t.scale * 1.2)))
  const tc = getCanvas()
  ctx.font = `500 ${lblPx}px Roboto Mono, "Noto Sans JP", monospace`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const padX = 4, padY = 2
  for (const { p, sx, sy } of visible) {
    const tw = ctx.measureText(p.id).width
    const bw = tw + padX * 2, bh = lblPx + padY * 2
    const cy = sy + r + 2 + bh / 2          // chip sits just below the node dot
    const bx = sx - bw / 2, by = cy - bh / 2
    const box = { x1: bx, y1: by, x2: bx + bw, y2: by + bh }
    // skip labels that would overlap one already drawn (declutters clusters)
    if (placed.some(q => box.x1 < q.x2 && box.x2 > q.x1 && box.y1 < q.y2 && box.y2 > q.y1)) continue
    placed.push(box)
    // rounded chip lifts the id off the lanes/grid behind it
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 3)
    ctx.fillStyle = tc.labelBg; ctx.fill()
    ctx.lineWidth = 1; ctx.strokeStyle = tc.labelBorder; ctx.stroke()
    ctx.fillStyle = tc.labelText
    ctx.fillText(p.id, sx, cy + 0.5)
  }
  ctx.textBaseline = 'alphabetic'   // reset so other text (storage labels) is unaffected
}

function drawRobotPath(ctx: CanvasRenderingContext2D, map: FleetMap, r: Robot, t: Transform, cfg: MapViewConfig) {
  if (!cfg.showPaths || r.path.length < 2) return
  const col = r.color ?? STATUS_COLOR[r.status]   // AMR identity colour
  const lw = Math.max(1, t.scale * 0.22)

  // Build the whole route once (following lane geometry) into a Path2D so we
  // can stroke it twice: a soft wide casing that lifts the route off the
  // steel-blue lanes, then crisp "marching ants" on top for the active path.
  const route = new Path2D()
  for (let i = 0; i < r.path.length - 1; i++) {
    const a = r.path[i], b = r.path[i + 1]
    const c = map.curves.find(e => e.sNode === a && e.eNode === b)
      ?? map.curves.find(e => (e.sNode === b && e.eNode === a)) // fallback if listed reversed
    if (c) {
      const { sx: ax, sy: ay } = worldToScreen(c.sx, c.sy, t)
      const { sx: bx, sy: by } = worldToScreen(c.ex, c.ey, t)
      // draw in travel order a→b regardless of how the curve is stored
      const fwd = c.sNode === a
      const p0 = fwd ? { x: ax, y: ay } : { x: bx, y: by }
      const p1 = fwd ? { x: bx, y: by } : { x: ax, y: ay }
      route.moveTo(p0.x, p0.y)
      if (c.type === 'bezier' && c.cp.length >= 2) {
        const c1 = worldToScreen(c.cp[0].x, c.cp[0].y, t), c2 = worldToScreen(c.cp[1].x, c.cp[1].y, t)
        if (fwd) route.bezierCurveTo(c1.sx, c1.sy, c2.sx, c2.sy, p1.x, p1.y)
        else route.bezierCurveTo(c2.sx, c2.sy, c1.sx, c1.sy, p1.x, p1.y)
      } else if (c.type === 'bezier' && c.cp.length === 1) {
        const cp = worldToScreen(c.cp[0].x, c.cp[0].y, t)
        route.quadraticCurveTo(cp.sx, cp.sy, p1.x, p1.y)
      } else {
        route.lineTo(p1.x, p1.y)
      }
    } else {
      const na = map.points.find(p => p.id === a), nb = map.points.find(p => p.id === b)
      if (!na || !nb) continue
      const pa = worldToScreen(na.x, na.y, t), pb = worldToScreen(nb.x, nb.y, t)
      route.moveTo(pa.sx, pa.sy); route.lineTo(pb.sx, pb.sy)
    }
  }

  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  // casing
  ctx.setLineDash([]); ctx.lineDashOffset = 0
  ctx.strokeStyle = col + '26'; ctx.lineWidth = lw * 2.6; ctx.stroke(route)
  // marching ants on top
  const dash = Math.max(4, t.scale * 0.9)
  ctx.strokeStyle = col + 'e6'; ctx.lineWidth = lw
  ctx.setLineDash([dash, dash * 0.7])
  ctx.lineDashOffset = -(Date.now() / 40) % (dash * 1.7)
  ctx.stroke(route)
  ctx.setLineDash([]); ctx.lineDashOffset = 0

  // destination marker at the route's final node: a ring + dot so the operator
  // sees where this robot is headed without tracing the whole line.
  const dest = map.points.find(p => p.id === r.path[r.path.length - 1])
  if (dest) {
    const e = worldToScreen(dest.x, dest.y, t)
    const rr = Math.max(4, lw * 2.3)
    ctx.beginPath(); ctx.arc(e.sx, e.sy, rr, 0, Math.PI * 2)
    ctx.strokeStyle = col + 'cc'; ctx.lineWidth = Math.max(1.5, lw * 0.7); ctx.stroke()
    ctx.beginPath(); ctx.arc(e.sx, e.sy, Math.max(1.5, rr * 0.34), 0, Math.PI * 2)
    ctx.fillStyle = col; ctx.fill()
  }
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'
}

function drawRobot(ctx: CanvasRenderingContext2D, r: Robot, t: Transform, cfg: MapViewConfig, selId: string | null) {
  const { sx, sy } = worldToScreen(r.pose.x, r.pose.y, t)
  // Size the robot in METRES so it stays true-to-scale with the map.
  // cfg.robotSize is the real footprint length in metres (slider 1–4 m),
  // converted to pixels via the current zoom, with a small floor so it
  // never disappears when zoomed far out.
  const sz = Math.max(10, cfg.robotSize * t.scale); const half = sz / 2
  if (sx < -sz * 2 || sx > ctx.canvas.width + sz * 2) return
  const col = STATUS_COLOR[r.status]
  const idc = r.color ?? col          // AMR identity colour (distinguishes robots)
  // Glow
  if (r.status === 'EXECUTING' || r.status === 'ERROR') {
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sz)
    g.addColorStop(0, col + '15'); g.addColorStop(1, col + '00')
    ctx.beginPath(); ctx.arc(sx, sy, sz, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill()
  }
  // Robot image
  const imgSrc = AGV_ASSET_PATH(r.model, r.status)
  const img    = getCachedImg(imgSrc)
  ctx.save(); ctx.translate(sx, sy)
  ctx.rotate(thetaToScreenRot(r.pose.theta))
  if (img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, -half, -half, sz, sz)
  } else {
    ctx.beginPath(); ctx.roundRect(-half, -half, sz, sz, 4)
    ctx.fillStyle = col + '30'; ctx.strokeStyle = col; ctx.lineWidth = 1.5
    ctx.fill(); ctx.stroke()
  }
  ctx.restore()
  // Carried load: an orange cargo box on the robot's deck, drawn pick → drop.
  // Spec (AGV_CARGO_HANDOFF): 0.9 m square, +0.15 m Y offset in the robot's
  // local frame, rotates with the robot heading, fill #de8d36 @ 0.9.
  if (r.carrying) {
    const CARGO = { size: 1.29, offsetX: 0, offsetY: 0.15 }  // metres (0.9 +~43%)
    const cs = Math.max(8, CARGO.size * t.scale)
    const ox = CARGO.offsetX * t.scale, oy = CARGO.offsetY * t.scale
    ctx.save()
    ctx.translate(sx, sy)
    ctx.rotate(thetaToScreenRot(r.pose.theta))   // same rotation as the robot icon
    ctx.shadowColor = 'rgba(0,0,0,0.30)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1
    ctx.beginPath(); ctx.roundRect(-cs / 2 + ox, -cs / 2 + oy, cs, cs, Math.max(1, cs * 0.12))
    ctx.fillStyle = 'rgba(222,141,54,0.9)'       // #de8d36
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = '#b9701f'; ctx.lineWidth = Math.max(0.6, cs * 0.06); ctx.stroke()
    ctx.restore()
  }
  // Label (in the identity colour)
  const lblSz = Math.max(8, cfg.labelSize - 1)
  ctx.font = `bold ${lblSz}px Roboto Mono, "Noto Sans JP", monospace`; ctx.textAlign = 'center'
  const lw = ctx.measureText(r.id).width; const lby = sy + half + lblSz + 4
  ctx.fillStyle = getCanvas().labelBg
  ctx.fillRect(sx - lw / 2 - 2, lby - lblSz, lw + 4, lblSz + 2)
  ctx.fillStyle = idc; ctx.fillText(r.id, sx, lby)
  // Selection ring
  if (selId === r.id) {
    ctx.beginPath(); ctx.arc(sx, sy, half * 1.6, 0, Math.PI * 2)
    ctx.strokeStyle = idc + '66'; ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([])
  }
}
