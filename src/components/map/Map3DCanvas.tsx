/**
 * Map3DCanvas — imperative three.js renderer for the fleet map (v1 scaffold).
 *
 * Mirrors the MapCanvas approach: a hand-written renderer (NO react-three-fiber)
 * that reads the SAME useFleetStore data the 2D canvas does, so SIM and LIVE
 * drive it identically. The scene is built once per map (floor, grid, nodes,
 * lanes); robots are reconciled every frame from the latest `robots` prop.
 *
 * Coordinates: map is metres, +X East / +Y North. three.js is Y-up, so we map
 * world (x, y) → scene (x, 0, -y) and keep everything on the ground plane.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { FleetMap, Robot, MapViewConfig, MapCurve } from '@/types'
import { STATUS_COLOR } from '@/constants'
import { getMapBounds } from '@/services/map.service'

interface Props {
  map: FleetMap
  robots: Robot[]
  config: MapViewConfig
  selectedRobotId: string | null
  onRobotClick: (id: string | null) => void
}

// class → fill colour (kept in step with the 2D node palette)
const NODE_COLOR: Record<string, number> = {
  Charge: 0xf59e0b, ActionPoint: 0xea7a00, LocationMark: 0x2563eb,
}

// world (metres) → scene vector on the ground plane
const vec = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y)

// sample a curve into world points (line = 2, bezier = N) for the lane mesh
function sampleCurve(c: MapCurve, n = 18): { x: number; y: number }[] {
  if (c.type === 'bezier' && c.cp.length >= 2) {
    const out: { x: number; y: number }[] = []
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t
      const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t
      out.push({
        x: a * c.sx + b * c.cp[0].x + d * c.cp[1].x + e * c.ex,
        y: a * c.sy + b * c.cp[0].y + d * c.cp[1].y + e * c.ey,
      })
    }
    return out
  }
  if (c.type === 'bezier' && c.cp.length === 1) {
    const out: { x: number; y: number }[] = []
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t
      out.push({
        x: u * u * c.sx + 2 * u * t * c.cp[0].x + t * t * c.ex,
        y: u * u * c.sy + 2 * u * t * c.cp[0].y + t * t * c.ey,
      })
    }
    return out
  }
  return [{ x: c.sx, y: c.sy }, { x: c.ex, y: c.ey }]
}

export function Map3DCanvas({ map, robots, config, selectedRobotId, onRobotClick }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  // latest props read by the render loop without re-running setup
  const robotsRef = useRef(robots);          robotsRef.current = robots
  const configRef = useRef(config);          configRef.current = config
  const selRef    = useRef(selectedRobotId); selRef.current = selectedRobotId
  const clickRef  = useRef(onRobotClick);    clickRef.current = onRobotClick

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const W = mount.clientWidth || 1, H = mount.clientHeight || 1

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xeef1f5)

    const b = getMapBounds(map)
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2
    const span = Math.max(b.width, b.height, 10)
    const center = vec(cx, cy)

    const camera = new THREE.PerspectiveCamera(50, W / H, 0.5, span * 8)
    camera.position.set(cx + span * 0.35, span * 0.85, -cy + span * 0.7)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(W, H)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.copy(center)
    controls.maxPolarAngle = Math.PI * 0.495   // don't let the camera go under the floor
    controls.update()

    // ── lights ──
    scene.add(new THREE.AmbientLight(0xffffff, 0.85))
    const sun = new THREE.DirectionalLight(0xffffff, 0.9)
    sun.position.set(cx + span, span, -cy + span)
    scene.add(sun)

    // ── floor + grid ──
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(span * 1.4, span * 1.4),
      new THREE.MeshStandardMaterial({ color: 0xe7ebf1, roughness: 1 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.set(cx, -0.02, -cy)
    scene.add(floor)

    const grid = new THREE.GridHelper(Math.ceil(span * 1.4), Math.ceil(span * 1.4 / 5), 0xc2cad6, 0xd9dfe8)
    grid.position.set(cx, 0, -cy)
    scene.add(grid)

    // ── lanes (one merged LineSegments for the whole graph) ──
    if (config.showEdges) {
      const pos: number[] = []
      for (const c of map.curves) {
        const pts = sampleCurve(c)
        for (let i = 0; i < pts.length - 1; i++) {
          pos.push(pts[i].x, 0.04, -pts[i].y, pts[i + 1].x, 0.04, -pts[i + 1].y)
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8fa6c5 })))
    }

    // ── nodes (a small puck per point, coloured by class) ──
    const nodeGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12)
    const nodeGroup = new THREE.Group()
    for (const p of map.points) {
      const show = p.cls === 'Charge' ? config.showCH : p.cls === 'ActionPoint' ? config.showAP : config.showLM
      if (!show) continue
      const m = new THREE.Mesh(nodeGeo, new THREE.MeshStandardMaterial({ color: NODE_COLOR[p.cls] ?? 0x2563eb }))
      m.position.set(p.x, 0.06, -p.y)
      nodeGroup.add(m)
    }
    scene.add(nodeGroup)

    // ── robots (reconciled every frame from robotsRef) ──
    const robotMeshes = new Map<string, THREE.Group>()
    const robotLayer = new THREE.Group()
    scene.add(robotLayer)

    const makeRobot = (col: number): THREE.Group => {
      const g = new THREE.Group()
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.1 }),
      )
      body.name = 'body'
      g.add(body)
      // nose marker (local +X = forward) so heading is legible
      const nose = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.4, 12),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      )
      nose.name = 'nose'
      nose.rotation.z = -Math.PI / 2   // point the cone along +X
      g.add(nose)
      return g
    }

    const syncRobots = () => {
      const list = robotsRef.current
      const cfg = configRef.current
      const seen = new Set<string>()
      const len = Math.max(0.6, cfg.robotSize)         // footprint length (m)
      const wid = len * 0.62, ht = 0.7
      for (const r of list) {
        seen.add(r.id)
        const col = new THREE.Color(r.color ?? STATUS_COLOR[r.status]).getHex()
        let g = robotMeshes.get(r.id)
        if (!g) { g = makeRobot(col); robotMeshes.set(r.id, g); robotLayer.add(g) }
        const body = g.getObjectByName('body') as THREE.Mesh
        const nose = g.getObjectByName('nose') as THREE.Mesh
        body.scale.set(len, ht, wid)
        body.position.y = ht / 2
        ;(body.material as THREE.MeshStandardMaterial).color.setHex(col)
        const selected = selRef.current === r.id
        ;(body.material as THREE.MeshStandardMaterial).emissive.setHex(selected ? 0x2563eb : 0x000000)
        ;(body.material as THREE.MeshStandardMaterial).emissiveIntensity = selected ? 0.45 : 0
        nose.position.set(len / 2, ht / 2, 0)
        g.position.set(r.pose.x, 0, -r.pose.y)
        g.rotation.y = THREE.MathUtils.degToRad(r.pose.theta)
      }
      // drop robots that disappeared
      for (const [id, g] of robotMeshes) {
        if (!seen.has(id)) { robotLayer.remove(g); robotMeshes.delete(id) }
      }
    }

    // ── click → select robot (raycast against robot bodies) ──
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let downAt = { x: 0, y: 0 }
    const onDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY } }
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return // was a drag/orbit
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(robotLayer.children, true)
      if (hits.length) {
        let o: THREE.Object3D | null = hits[0].object
        while (o && !robotMeshes.has(o.uuid) && o.parent !== robotLayer) o = o.parent
        const entry = [...robotMeshes.entries()].find(([, g]) => g === o)
        clickRef.current(entry ? entry[0] : null)
      } else {
        clickRef.current(null)
      }
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)

    // ── loop ──
    let raf = 0
    const tick = () => {
      syncRobots()
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    // ── resize ──
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    ro.observe(mount)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      controls.dispose()
      renderer.dispose()
      scene.traverse(o => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mat => mat.dispose())
      })
      mount.removeChild(renderer.domElement)
    }
    // rebuild only when the map changes; robots/config/selection are read live via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  return <div ref={mountRef} style={{ width: '100%', height: '100%', cursor: 'grab' }} />
}
