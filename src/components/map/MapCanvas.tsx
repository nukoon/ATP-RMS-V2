/**
 * MapCanvas — Main 2D fleet map renderer (Canvas API)
 * Draws: grid, zones, edges (bezier+line), nodes, robot paths, robots
 */
import { useEffect, useRef, useCallback } from 'react'
import type { FleetMap, Robot, MapViewConfig } from '@/types'
import type { Storage } from '@/types/fleet'
import type { Transform } from '@/utils/canvas'
import { worldToScreen, screenToWorld, thetaToScreenRot } from '@/utils/canvas'
import { STATUS_COLOR, AGV_ASSET_PATH } from '@/constants'
import { useStorageStore } from '@/store/storage.store'
import type { useMapTransform } from '@/hooks/useMapTransform'

interface Props {
  map:       FleetMap
  robots:    Robot[]
  config:    MapViewConfig
  selectedRobotId: string | null
  onRobotClick:  (id: string | null) => void
  onHover?: (world: { x: number; y: number } | null) => void
  ctrl: ReturnType<typeof useMapTransform>
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

export function MapCanvas({ map, robots, config, selectedRobotId, onRobotClick, onHover, ctrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef   = useRef<number>()
  const t = ctrl.transform
  const tRef = useRef(t)
  tRef.current = t
  const fittedRef = useRef(false)
  const movedRef  = useRef(false)
  // storages are read from the store and drawn each frame via a ref
  const storages = useStorageStore(s => s.storages)
  const storagesRef = useRef<Storage[]>(storages)
  storagesRef.current = storages

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

    drawGrid(ctx, canvas.width, canvas.height, tt)
    drawZones(ctx, map, tt, config)
    drawEdges(ctx, map, tt, config)
    robots.forEach(r => drawRobotPath(ctx, map, r, tt, config))
    // when storage is shown, its icon stands in for the bound node (hide that node)
    const storageNodes = config.showStorage
      ? new Set(storagesRef.current.filter(s => s.enabled).map(s => s.nodeId))
      : EMPTY_SET
    drawNodes(ctx, map, tt, config, storageNodes)
    if (config.showStorage) drawStorages(ctx, map, storagesRef.current, tt, config)
    robots.forEach(r => drawRobot(ctx, r, tt, config, selectedRobotId))

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
    ctrl.handleMouseDown(x, y)
  }, [ctrl])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (e.buttons === 1) movedRef.current = true
    const { x, y } = pos(e)
    ctrl.handleMouseMove(x, y)
    onHover?.(screenToWorld(x, y, tRef.current))
  }, [ctrl, onHover])

  const onMouseUp = useCallback(() => ctrl.handleMouseUp(), [ctrl])
  const onLeave = useCallback(() => { ctrl.handleMouseUp(); onHover?.(null) }, [ctrl, onHover])

  // Click → robot selection (suppressed if the click was a drag)
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (movedRef.current) return
    const { x: mx, y: my } = pos(e)
    const hitR = Math.max(14, config.robotSize * 0.6)
    for (const r of robots) {
      const { sx, sy } = worldToScreen(r.pose.x, r.pose.y, tRef.current)
      if (Math.hypot(mx - sx, my - sy) < hitR) {
        onRobotClick(selectedRobotId === r.id ? null : r.id)
        return
      }
    }
    onRobotClick(null)
  }, [robots, config.robotSize, selectedRobotId, onRobotClick])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }}
      onClick={handleClick}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onLeave}
    />
  )
}

// ── Draw helpers ─────────────────────────────────────────

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, t: Transform) {
  const step = 5 * t.scale
  if (step < 8) return
  ctx.strokeStyle = 'rgba(100,116,139,0.10)'
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
const STORAGE_M = 1.6   // carton footprint in metres — scales true-to-map like robots

function drawStorages(ctx: CanvasRenderingContext2D, map: FleetMap, storages: Storage[], t: Transform, cfg: MapViewConfig) {
  // Proportional to the map (metres × zoom) so it tracks zoom smoothly, with a
  // small px floor so it stays visible when zoomed far out. No upper clamp.
  const sz = Math.max(14, STORAGE_M * t.scale)
  const half = sz / 2
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

    // name label above the icon (respect the label zoom threshold)
    if (t.scale >= cfg.labelZoomThreshold) {
      const lbl = s.name
      ctx.font = `bold ${Math.max(8, cfg.labelSize - 2)}px Roboto Mono, "Noto Sans JP", monospace`
      ctx.textAlign = 'center'
      const lw = ctx.measureText(lbl).width
      const ly = sy - half - 3
      ctx.fillStyle = 'rgba(255,255,255,0.82)'
      ctx.fillRect(sx - lw / 2 - 2, ly - 9, lw + 4, 11)
      ctx.fillStyle = col
      ctx.fillText(lbl, sx, ly)
    }
  }
}

function drawZones(ctx: CanvasRenderingContext2D, map: FleetMap, t: Transform, cfg: MapViewConfig) {
  if (!cfg.showZones) return
  for (const area of map.areas) {
    if (!area.poly.length) continue
    ctx.beginPath()
    const { sx, sy } = worldToScreen(area.poly[0].x, area.poly[0].y, t)
    ctx.moveTo(sx, sy)
    for (let i = 1; i < area.poly.length; i++) {
      const { sx: x2, sy: y2 } = worldToScreen(area.poly[i].x, area.poly[i].y, t)
      ctx.lineTo(x2, y2)
    }
    ctx.closePath()
    ctx.fillStyle = 'rgba(37,99,235,0.05)'
    ctx.strokeStyle = 'rgba(37,99,235,0.30)'
    ctx.lineWidth = 1.2
    ctx.fill(); ctx.stroke()
    if (t.scale > 0.8) {
      const cx = area.poly.reduce((s, p) => s + p.x, 0) / area.poly.length
      const cy = area.poly.reduce((s, p) => s + p.y, 0) / area.poly.length
      const { sx: lx, sy: ly } = worldToScreen(cx, cy, t)
      ctx.font = `${Math.round(cfg.labelSize * 0.85)}px Inter, "Noto Sans JP", sans-serif`
      ctx.fillStyle = 'rgba(37,99,235,0.45)'
      ctx.textAlign = 'center'
      ctx.fillText(area.id, lx, ly)
    }
  }
}

function drawEdges(ctx: CanvasRenderingContext2D, map: FleetMap, t: Transform, cfg: MapViewConfig) {
  if (!cfg.showEdges) return
  const lw = Math.max(1.2, t.scale * 0.45)
  for (const c of map.curves) {
    const { sx: ax, sy: ay } = worldToScreen(c.sx, c.sy, t)
    const { sx: bx, sy: by } = worldToScreen(c.ex, c.ey, t)
    if (Math.max(ax, bx) < -10 || Math.min(ax, bx) > ctx.canvas.width + 10) continue
    ctx.beginPath(); ctx.lineWidth = lw
    if (c.type === 'bezier' && c.cp.length >= 2) {
      ctx.strokeStyle = 'rgba(37,99,235,0.55)'; ctx.setLineDash([])
      const { sx: c1x, sy: c1y } = worldToScreen(c.cp[0].x, c.cp[0].y, t)
      const { sx: c2x, sy: c2y } = worldToScreen(c.cp[1].x, c.cp[1].y, t)
      ctx.moveTo(ax, ay); ctx.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by)
    } else if (c.type === 'bezier' && c.cp.length === 1) {
      ctx.strokeStyle = 'rgba(37,99,235,0.55)'; ctx.setLineDash([])
      const { sx: cpx, sy: cpy } = worldToScreen(c.cp[0].x, c.cp[0].y, t)
      ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cpx, cpy, bx, by)
    } else {
      ctx.strokeStyle = 'rgba(100,116,139,0.6)'; ctx.setLineDash([3, 3])
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
    }
    ctx.stroke()
  }
  ctx.setLineDash([])
}

function drawNodes(ctx: CanvasRenderingContext2D, map: FleetMap, t: Transform, cfg: MapViewConfig, hiddenNodes: Set<string>) {
  const r = cfg.nodeSize
  const showLbl = t.scale >= cfg.labelZoomThreshold
  for (const p of map.points) {
    // a storage icon stands in for this node (until Store is toggled off)
    if (hiddenNodes.has(p.id)) continue
    if (p.cls === 'LocationMark' && !cfg.showLM) continue
    if (p.cls === 'ActionPoint'  && !cfg.showAP) continue
    if (p.cls === 'Charge'       && !cfg.showCH) continue
    const { sx, sy } = worldToScreen(p.x, p.y, t)
    if (sx < -20 || sx > ctx.canvas.width + 20) continue
    if (sy < -20 || sy > ctx.canvas.height + 20) continue
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2)
    if (p.cls === 'Charge') {
      ctx.fillStyle = 'rgba(245,158,11,0.55)'; ctx.strokeStyle = '#b45309'; ctx.lineWidth = 1.6
    } else if (p.cls === 'ActionPoint') {
      ctx.fillStyle = 'rgba(234,122,0,0.35)'; ctx.strokeStyle = '#c2410c'; ctx.lineWidth = 1.4
    } else {
      ctx.fillStyle = 'rgba(37,99,235,0.35)'; ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 1.4
    }
    ctx.fill(); ctx.stroke()
    if (showLbl) {
      ctx.font = `${cfg.labelSize}px Roboto Mono, "Noto Sans JP", monospace`
      ctx.textAlign = 'center'
      const tw = ctx.measureText(p.id).width
      const ly = sy + r + cfg.labelSize + 1
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.fillRect(sx - tw / 2 - 1, ly - cfg.labelSize + 1, tw + 2, cfg.labelSize + 1)
      ctx.fillStyle = p.cls === 'Charge' ? '#b45309' : p.cls === 'ActionPoint' ? '#c2410c' : '#1d4ed8'
      ctx.fillText(p.id, sx, ly)
    }
  }
}

function drawRobotPath(ctx: CanvasRenderingContext2D, map: FleetMap, r: Robot, t: Transform, cfg: MapViewConfig) {
  if (!cfg.showPaths || r.path.length < 2) return
  const nodeMap = new Map(map.points.map(p => [p.id, p]))
  const col = STATUS_COLOR[r.status]
  ctx.beginPath(); ctx.strokeStyle = col + '66'
  ctx.lineWidth = Math.max(2, t.scale * 0.7); ctx.setLineDash([])
  let first = true
  for (const id of r.path) {
    const n = nodeMap.get(id); if (!n) continue
    const { sx, sy } = worldToScreen(n.x, n.y, t)
    if (first) { ctx.moveTo(sx, sy); first = false } else ctx.lineTo(sx, sy)
  }
  ctx.stroke()
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
  // Label
  const lblSz = Math.max(8, cfg.labelSize - 1)
  ctx.font = `bold ${lblSz}px Roboto Mono, "Noto Sans JP", monospace`; ctx.textAlign = 'center'
  const lw = ctx.measureText(r.id).width; const lby = sy + half + lblSz + 4
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(sx - lw / 2 - 2, lby - lblSz, lw + 4, lblSz + 2)
  ctx.fillStyle = col; ctx.fillText(r.id, sx, lby)
  // Selection ring
  if (selId === r.id) {
    ctx.beginPath(); ctx.arc(sx, sy, half * 1.6, 0, Math.PI * 2)
    ctx.strokeStyle = col + '44'; ctx.lineWidth = 1
    ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([])
  }
}
