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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { FleetMap, Robot, MapViewConfig, MapCurve, AgvModel } from '@/types'
import type { Storage } from '@/types/fleet'
import { STATUS_COLOR } from '@/constants'
import { getMapBounds } from '@/services/map.service'
import { useStorageStore } from '@/store/storage.store'
import { useThemeStore } from '@/store/theme.store'
import { getCanvas } from '@/theme'

interface Props {
  map: FleetMap
  robots: Robot[]
  config: MapViewConfig
  selectedRobotId: string | null
  onRobotClick: (id: string | null) => void
}

// AGV product model → reused glb (public/assets/agv3d, copied from the Aipa
// unreal asset set — ATP's own product models, not customer data).
const MODEL_FILE: Partial<Record<AgvModel, string>> = {
  AM15: 'am', AS15: 'am', APe15: 'ape', MP10S: 'mp10', AL02: 'mp10',
  TP30: 'tp', TP60: 'tp', TT15: 'tp', TT30: 'tp', TT60: 'tp',
}
const DEFAULT_MODEL = 'mp10'
const AGV3D_URL = (file: string) => `/assets/agv3d/${file}.glb`
const FLOOR_URL = '/assets/agv3d/floor.jpg'    // warehouse floor texture
const CHARGE_FILE = 'chargeStation'            // glb placed at every Charge node

// Extra factory scenery: add any glb under public/assets/agv3d/ at a world map
// coordinate (metres, +X east / +Y north) and it shows up in the 3D view.
// e.g. { file: 'elevator', x: 12, y: 40, rotDeg: 90, size: 3 }
const SCENERY: { file: string; x: number; y: number; rotDeg?: number; size?: number }[] = [
]

const gltfLoader = new GLTFLoader()
// yaw offset (deg) so a model's own forward aligns with local +X = heading dir.
// All four glb share one export convention, so a single offset applies.
const MODEL_YAW_DEG = 90
const DEBUG_HEADING = false   // temporary: draw a red +X arrow to tune MODEL_YAW_DEG

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

// Billboard text label as a canvas-texture sprite. depthTest off so it stays
// readable on top of geometry; a Sprite always faces the camera.
function makeLabel(text: string, fg: string, bg: string, heightM: number): THREE.Sprite {
  const fontPx = 64, padX = 18, padY = 12, rr = 16
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  const font = `bold ${fontPx}px "Roboto Mono", monospace`
  ctx.font = font
  c.width = Math.ceil(ctx.measureText(text).width) + padX * 2
  c.height = fontPx + padY * 2
  const w = c.width, h = c.height
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.beginPath(); ctx.moveTo(rr, 0)
  ctx.arcTo(w, 0, w, h, rr); ctx.arcTo(w, h, 0, h, rr); ctx.arcTo(0, h, 0, 0, rr); ctx.arcTo(0, 0, w, 0, rr)
  ctx.closePath(); ctx.fillStyle = bg; ctx.fill()
  ctx.fillStyle = fg; ctx.fillText(text, w / 2, h / 2 + 1)
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  sp.scale.set(heightM * w / h, heightM, 1)
  sp.renderOrder = 20
  return sp
}
const hex6 = (n: number) => '#' + n.toString(16).padStart(6, '0')

export function Map3DCanvas({ map, robots, config, selectedRobotId, onRobotClick }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const storages = useStorageStore(s => s.storages)   // stock (live FULL/EMPTY)
  const areas = useStorageStore(s => s.areas)          // storage-area groupings
  const theme = useThemeStore(s => s.theme)            // rebuild scene on theme change
  // latest props read by the render loop without re-running setup
  const robotsRef = useRef(robots);          robotsRef.current = robots
  const configRef = useRef(config);          configRef.current = config
  const selRef    = useRef(selectedRobotId); selRef.current = selectedRobotId
  const clickRef  = useRef(onRobotClick);    clickRef.current = onRobotClick
  const stockRef  = useRef<Storage[]>(storages); stockRef.current = storages
  const areasRef  = useRef(areas); areasRef.current = areas

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const W = mount.clientWidth || 1, H = mount.clientHeight || 1

    const tc = getCanvas()
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(tc.bg3d)

    const b = getMapBounds(map)
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2
    const span = Math.max(b.width, b.height, 10)
    const center = vec(cx, cy)

    const camera = new THREE.PerspectiveCamera(50, W / H, 0.5, span * 8)
    if (DEBUG_HEADING) camera.position.set(cx, span * 0.9, -cy + 0.01)     // top-down for tuning
    else camera.position.set(cx + span * 0.22, span * 0.5, -cy + span * 0.4)   // start closer in

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
    const floorMat = new THREE.MeshStandardMaterial({ color: tc.bg3d, roughness: 1 })
    new THREE.TextureLoader().load(FLOOR_URL, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(Math.max(1, Math.round(span * 1.4 / 4)), Math.max(1, Math.round(span * 1.4 / 4)))
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      floorMat.map = tex; floorMat.color.setHex(tc.floorTint); floorMat.needsUpdate = true
    })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.4, span * 1.4), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(cx, -0.02, -cy)
    scene.add(floor)

    const grid = new THREE.GridHelper(Math.ceil(span * 1.4), Math.ceil(span * 1.4 / 5), tc.grid3dMajor, tc.grid3dMinor)
    grid.position.set(cx, 0, -cy)
    scene.add(grid)

    // node lookup for stock placement + route geometry. Nodes themselves are
    // NOT drawn in 3D — this view shows only stock and the robots' run paths.
    const nodeById = new Map(map.points.map(p => [p.id, p]))

    // ── lanes: faint ground context only (one merged LineSegments) ──
    if (config.showEdges) {
      const pos: number[] = []
      for (const c of map.curves) {
        const pts = sampleCurve(c)
        for (let i = 0; i < pts.length - 1; i++) {
          pos.push(pts[i].x, 0.03, -pts[i].y, pts[i + 1].x, 0.03, -pts[i + 1].y)
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: tc.lane3d, transparent: true, opacity: 0.9 })))
    }

    // Load + normalize any glb to a "footprint 1, resting on y=0" template, then
    // clone it per use. Cache is local to this mount so shared geometry/materials
    // aren't disposed out from under a later mount. (Used for AGVs + goods.)
    const GOODS_FILE = 'goods'
    const STOCK_SIZE = 1.4    // goods footprint (m) when parked in a storage
    const CARGO_SIZE = STOCK_SIZE   // carried goods = same footprint as a stock crate
    const CARGO_Y = 0.22      // sit the load on the forks, not floating above
    const DEBUG_CARGO = false  // set true to force the load on every robot (tune CARGO_Y)
    const modelCache = new Map<string, Promise<THREE.Group>>()
    const loadGlbTemplate = (file: string): Promise<THREE.Group> => {
      let p = modelCache.get(file)
      if (!p) {
        p = new Promise<THREE.Group>((resolve, reject) => {
          gltfLoader.load(AGV3D_URL(file), (gltf) => {
            const inner = new THREE.Group(); inner.add(gltf.scene)
            inner.updateMatrixWorld(true)
            const box = new THREE.Box3().setFromObject(inner)
            const size = new THREE.Vector3(); box.getSize(size)
            const center = new THREE.Vector3(); box.getCenter(center)
            const footprint = Math.max(size.x, size.z) || 1
            gltf.scene.position.set(-center.x, -box.min.y, -center.z)  // centre X/Z, base on ground
            inner.scale.setScalar(1 / footprint)                       // normalize footprint → 1
            const template = new THREE.Group(); template.add(inner)
            resolve(template)
          }, undefined, reject)
        })
        modelCache.set(file, p)
      }
      return p
    }

    // ── static scenery: charge stations at Charge nodes + operator-defined props
    //    (SCENERY). Placed once; gives the floor a factory feel. ──
    const sceneryLayer = new THREE.Group(); scene.add(sceneryLayer)
    const placeProp = (file: string, x: number, y: number, rotDeg = 0, size = 1.5) => {
      loadGlbTemplate(file).then(tpl => {
        const inst = tpl.clone(true); inst.scale.setScalar(size)
        inst.position.set(x, 0, -y); inst.rotation.y = THREE.MathUtils.degToRad(rotDeg)
        sceneryLayer.add(inst)
      }).catch(() => { /* skip a prop that fails to load */ })
    }
    for (const p of map.points) if (p.cls === 'Charge') placeProp(CHARGE_FILE, p.x, p.y, 0, 1.0)
    for (const s of SCENERY) placeProp(s.file, s.x, s.y, s.rotDeg ?? 0, s.size ?? 1.5)

    // ── stock: a goods glb shown when a storage is FULL; a faint flat marker
    //    when EMPTY so the location stays visible. ──
    const stockLayer = new THREE.Group(); scene.add(stockLayer)
    const emptyGeo = new THREE.BoxGeometry(1.3, 0.12, 1.3)
    const stockGroups = new Map<string, THREE.Group>()
    const syncStock = () => {
      const seen = new Set<string>()
      for (const s of stockRef.current) {
        if (!s.enabled) continue
        const node = nodeById.get(s.nodeId); if (!node) continue
        seen.add(s.id)
        let g = stockGroups.get(s.id)
        if (!g) {
          g = new THREE.Group(); g.position.set(node.x, 0, -node.y)
          const empty = new THREE.Mesh(emptyGeo, new THREE.MeshStandardMaterial({ color: 0x9aa8bb, transparent: true, opacity: 0.3 }))
          empty.name = 'empty'; empty.position.y = 0.06
          g.add(empty)
          stockGroups.set(s.id, g); stockLayer.add(g)
        }
        const full = s.state === 'FULL'
        const empty = g.getObjectByName('empty'); if (empty) empty.visible = !full
        // The goods glb is heavy, so clone it lazily and ONLY for FULL storages
        // (cloning one per storage up-front overwhelmed the renderer). Reused
        // and toggled once created.
        let goods = g.getObjectByName('goods')
        if (full && !goods && !g.userData.goodsLoading) {
          g.userData.goodsLoading = true
          const captured = g
          loadGlbTemplate(GOODS_FILE).then(tpl => {
            if (stockGroups.get(s.id) !== captured || captured.getObjectByName('goods')) return
            const inst = tpl.clone(true); inst.name = 'goods'; inst.scale.setScalar(STOCK_SIZE)
            captured.add(inst)
          }).catch(() => { /* keep the empty marker if goods fails to load */ })
        }
        if (goods) goods.visible = full
      }
      for (const [id, g] of stockGroups) if (!seen.has(id)) { stockLayer.remove(g); stockGroups.delete(id) }
    }

    // ── stock areas: a translucent floor zone + border + name label grouping
    //    the member storages (PICK=blue, DROP=amber, BOTH=purple). ──
    const areaLayer = new THREE.Group(); scene.add(areaLayer)
    const areaGroups = new Map<string, THREE.Group>()
    const areaColor = (k: string) => k === 'PICK' ? 0x2563eb : k === 'DROP' ? 0xf59e0b : 0x7c3aed
    const syncAreas = () => {
      const seen = new Set<string>()
      for (const a of areasRef.current) {
        if (!a.enabled) continue
        const pts = stockRef.current.filter(s => s.areaId === a.id && s.enabled)
          .map(s => nodeById.get(s.nodeId)).filter((p): p is NonNullable<typeof p> => !!p)
        if (!pts.length) continue
        seen.add(a.id)
        if (areaGroups.has(a.id)) continue   // zone geometry is static; build once
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y), pad = 1.6
        const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad
        const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad
        const w = maxX - minX, d = maxY - minY, cx2 = (minX + maxX) / 2, cy2 = (minY + maxY) / 2
        const col = areaColor(a.kind)
        const g = new THREE.Group()
        const padMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }))
        padMesh.rotation.x = -Math.PI / 2; padMesh.position.set(cx2, 0.015, -cy2)
        g.add(padMesh)
        const border = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(minX, 0.02, -minY), new THREE.Vector3(maxX, 0.02, -minY),
          new THREE.Vector3(maxX, 0.02, -maxY), new THREE.Vector3(minX, 0.02, -maxY), new THREE.Vector3(minX, 0.02, -minY),
        ])
        g.add(new THREE.Line(border, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.65 })))
        const lbl = makeLabel(`${a.name} · ${a.kind}`, '#ffffff', hex6(col), 1.1)
        lbl.position.set(cx2, 1.5, -cy2)
        g.add(lbl)
        areaGroups.set(a.id, g); areaLayer.add(g)
      }
      for (const [id, g] of areaGroups) if (!seen.has(id)) { areaLayer.remove(g); areaGroups.delete(id) }
    }

    // ── robot running paths: a coloured tube along the remaining route ──
    const pathLayer = new THREE.Group(); scene.add(pathLayer)
    const pathTubes = new Map<string, { mesh: THREE.Mesh; key: string }>()
    const buildRouteTube = (r: Robot): THREE.BufferGeometry | null => {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i < r.path.length - 1; i++) {
        const a = r.path[i], b = r.path[i + 1]
        const c = map.curves.find(e => e.sNode === a && e.eNode === b) ?? map.curves.find(e => e.sNode === b && e.eNode === a)
        let seg: { x: number; y: number }[]
        if (c) { const s = sampleCurve(c); seg = c.sNode === a ? s : s.slice().reverse() }
        else { const na = nodeById.get(a), nb = nodeById.get(b); if (!na || !nb) continue; seg = [na, nb] }
        for (const p of seg) pts.push(new THREE.Vector3(p.x, 0.09, -p.y))
      }
      const clean = pts.filter((p, i) => i === 0 || p.distanceToSquared(pts[i - 1]) > 1e-5)
      if (clean.length < 2) return null
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(clean), Math.max(8, clean.length * 2), 0.08, 6, false)
    }

    // ── robots (reconciled every frame from robotsRef) ──
    const robotMeshes = new Map<string, THREE.Group>()
    const robotLayer = new THREE.Group()
    scene.add(robotLayer)

    const ringGeo = new THREE.RingGeometry(0.46, 0.5, 36)
    const makeRobot = (col: number): THREE.Group => {
      const g = new THREE.Group()
      // identity ring on the ground (also the selection indicator)
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide }))
      ring.name = 'ring'; ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04
      g.add(ring)
      // placeholder box shown until the glb model loads
      const ph = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.1 }))
      ph.name = 'placeholder'
      g.add(ph)
      if (DEBUG_HEADING) {
        // bright arrow along local +X (= the intended heading direction)
        const fwd = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 10), new THREE.MeshBasicMaterial({ color: 0xff0000 }))
        fwd.name = 'fwd'; fwd.rotation.z = -Math.PI / 2; fwd.position.set(1.6, 0.6, 0)
        g.add(fwd)
      }
      return g
    }

    const syncRobots = () => {
      const list = robotsRef.current
      const cfg = configRef.current
      const seen = new Set<string>()
      const len = Math.max(0.6, cfg.robotSize)         // footprint length (m)
      for (const r of list) {
        seen.add(r.id)
        const col = new THREE.Color(r.color ?? STATUS_COLOR[r.status]).getHex()
        let g = robotMeshes.get(r.id)
        if (!g) {
          g = makeRobot(col); robotMeshes.set(r.id, g); robotLayer.add(g)
          // kick off the glb load; swap the placeholder for the model when ready
          const captured = g
          loadGlbTemplate(MODEL_FILE[r.model] ?? DEFAULT_MODEL).then(tpl => {
            if (robotMeshes.get(r.id) !== captured || captured.getObjectByName('model')) return
            const inst = tpl.clone(true); inst.name = 'model'
            inst.rotation.y = THREE.MathUtils.degToRad(MODEL_YAW_DEG)
            captured.add(inst)
            const ph = captured.getObjectByName('placeholder'); if (ph) captured.remove(ph)
          }).catch(() => { /* keep the placeholder box if the model fails to load */ })
          // floating id label (white text on the robot's identity colour)
          const label = makeLabel(r.id, '#ffffff', hex6(col), 0.9)
          label.name = 'label'; captured.add(label)
        }
        const selected = selRef.current === r.id
        const label = g.getObjectByName('label'); if (label) label.position.y = len * 0.55 + 1.3
        const ring = g.getObjectByName('ring') as THREE.Mesh
        const rm = ring.material as THREE.MeshBasicMaterial
        rm.color.setHex(col); rm.opacity = selected ? 1 : 0.8
        ring.scale.setScalar(len * (selected ? 1.18 : 1.02))
        const model = g.getObjectByName('model')
        const ph = g.getObjectByName('placeholder') as THREE.Mesh | null
        if (model) {
          model.scale.setScalar(len)
        } else if (ph) {
          ph.scale.set(len, 0.7, len * 0.62); ph.position.y = 0.35
          ;(ph.material as THREE.MeshStandardMaterial).color.setHex(col)
          ;(ph.material as THREE.MeshStandardMaterial).emissive.setHex(selected ? 0x2563eb : 0x000000)
          ;(ph.material as THREE.MeshStandardMaterial).emissiveIntensity = selected ? 0.4 : 0
        }

        // carried cargo: a goods glb rides on the robot while transporting
        // (r.carrying, set by the sim pick → drop); lazy-loaded, then toggled
        let cargo = g.getObjectByName('cargo')
        if ((r.carrying || DEBUG_CARGO) && !cargo && !g.userData.cargoLoading) {
          g.userData.cargoLoading = true
          const cg = g
          loadGlbTemplate(GOODS_FILE).then(tpl => {
            if (robotMeshes.get(r.id) !== cg || cg.getObjectByName('cargo')) return
            const inst = tpl.clone(true); inst.name = 'cargo'
            inst.scale.setScalar(CARGO_SIZE); inst.position.set(len * 0.05, CARGO_Y, 0)
            cg.add(inst)
          }).catch(() => {})
        }
        if (cargo) { cargo.visible = !!r.carrying || DEBUG_CARGO; cargo.scale.setScalar(CARGO_SIZE); cargo.position.y = CARGO_Y }

        g.position.set(r.pose.x, 0, -r.pose.y)
        g.rotation.y = THREE.MathUtils.degToRad(r.pose.theta)

        // running path: a coloured tube along the remaining route, rebuilt only
        // when the node sequence changes (the robot just slides along it)
        const key = r.path.join('>')
        let pt = pathTubes.get(r.id)
        if (r.path.length >= 2) {
          if (!pt) {
            const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92 }))
            mesh.frustumCulled = false; pt = { mesh, key: '' }; pathTubes.set(r.id, pt); pathLayer.add(mesh)
          }
          if (pt.key !== key) {
            pt.mesh.geometry.dispose()
            const geo = buildRouteTube(r)
            if (geo) { pt.mesh.geometry = geo; pt.mesh.visible = true } else { pt.mesh.geometry = new THREE.BufferGeometry(); pt.mesh.visible = false }
            pt.key = key
          }
          ;(pt.mesh.material as THREE.MeshBasicMaterial).color.setHex(col)
        } else if (pt) { pt.mesh.visible = false }
      }
      // drop robots that disappeared
      for (const [id, g] of robotMeshes) {
        if (!seen.has(id)) {
          robotLayer.remove(g); robotMeshes.delete(id)
          const pt = pathTubes.get(id); if (pt) { pathLayer.remove(pt.mesh); pt.mesh.geometry.dispose(); pathTubes.delete(id) }
        }
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
      grid.visible = configRef.current.showGrid
      robotLayer.visible = configRef.current.showRobots
      syncStock()
      syncAreas()
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
    // rebuild when the map or theme changes; robots/config/selection read live via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, theme])

  return <div ref={mountRef} style={{ width: '100%', height: '100%', cursor: 'grab' }} />
}
