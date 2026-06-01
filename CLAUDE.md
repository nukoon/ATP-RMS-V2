# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ATP-RMS-V2 — a real-time Fleet Management Dashboard ("Digital Twin") for ATP's autonomous mobile robots (AMRs/AGVs). The browser talks **VDA5050 v2.0 over MQTT** and renders robots on a **2D canvas** map built from the **ATP map format**. There is no backend in this repo — the MQTT broker is the integration boundary. A built-in **simulator** drives the whole UI without any broker, so the app is fully usable offline. UI/docs mix English and Thai.

## Commands

```bash
npm install          # install dependencies
npm run dev          # Vite dev server → http://localhost:5173 ( /api proxied to :8080 )
npm run build        # tsc (type-check) then vite build  — run this to verify; it must pass
npm run preview      # serve the production build
npm run lint         # eslint src --ext ts,tsx --report-unused-disable-directives
npm run type-check   # tsc --noEmit
```

Node.js 18+. **No test runner is configured** — don't assume `npm test`. The build runs `tsc` with `noUnusedLocals`/`noUnusedParameters`, so unused vars/imports fail the build; keep it clean.

## Three run modes (top-bar buttons)

1. **START SIM** — `simulationService` drives 2 AGVs with no broker. This is the default way to see everything working.
2. **CONNECT** (live) — connects `mqttService` to a real broker using the operator's saved AMR/broker config. Mutually exclusive with SIM (SIM disables while LIVE).
3. Neither — static map only.

## Architecture

```
              ┌─ simulationService ─┐
AGV ─VDA5050/MQTT─► mqtt.service ──┼─► useFleetStore (Zustand) ─► React (inline-styled HUD) ─► 2D <canvas>
                                   └─ both feed the SAME store.updateFromVDA5050 pipeline
```

Stack: React 18 + TypeScript 5 + Vite, **Zustand** stores (`zustand` + `persist`), **mqtt.js v5** over WebSocket, a hand-written **2D canvas** renderer (NOT react-konva/Leaflet despite those being in package.json — the map is drawn imperatively in `MapCanvas.tsx` via `utils/canvas.ts`). Styling is **inline styles, dark cyber-HUD theme** (Tailwind/PostCSS are installed but unused).

Key design point: **the simulator and a real broker are interchangeable** — both push synthetic/real VDA5050 `state` into `useFleetStore.updateFromVDA5050`, so every panel works identically in SIM or LIVE.

### Layout ([src/App.tsx](src/App.tsx))
top bar (status pills + CONFIG / CONNECT / START SIM) → `MapToolbar` → **[ left `FleetSidebar` | center `MapCanvas` | right panel ]** → bottom `StatusBar`.
Right panel = `RobotDetail` when a robot is selected, else tabbed **STREAM / MISSIONS / ALARMS** with `MetricsPanel` pinned below.

### Two Zustand stores
- **[src/store/fleet.store.ts](src/store/fleet.store.ts)** (`useFleetStore`) — live runtime state: `robots: Map<id,Robot>`, `missions`, `alarms`, `orders`, `mqttLog` (ring 100), `metrics`, `mqttConnected`, UI (`mapConfig`, `selectedRobotId`).
  - `upsertRobot()` is how a robot first enters; `updateFromVDA5050(id, state)` **only updates an existing robot** (early-returns otherwise), accumulates `totalDistance` from pose delta, then `recomputeMetrics()`.
  - missions: `addMission/updateMission/cancelMission`; alarms: `pushAlarm` (de-dups active by agvId+code) / `resolveAlarm`.
- **[src/store/config.store.ts](src/store/config.store.ts)** (`useConfigStore`, **persisted to localStorage** key `atp-rms-config`) — operator setup: registered `amrs` (serial/model/ip/colour), `maps` (builtin + uploaded), active map id, and the MQTT `broker` (WebSocket URL + auth + manufacturer).

### MQTT / VDA5050 contract
[src/services/mqtt.service.ts](src/services/mqtt.service.ts) — singleton `mqttService`. Topics: `${MQTT_BASE_TOPIC}/${manufacturer}/${robotId}/${topic}`, `MQTT_BASE_TOPIC='uagv/v2'`, QoS 1 (in [src/constants/index.ts](src/constants/index.ts)). `connect(config, robotIds)` subscribes per explicit robotId to `state`/`visualization`/`connection`; `sendOrder()` is the only outbound path. **Browsers can only do MQTT over WebSocket** — real robots that speak TCP 1883 need a Mosquitto bridge (TCP listener + `protocol websockets` on 9001). This is surfaced to the user in the Broker config tab.

### Simulator ([src/services/simulation.service.ts](src/services/simulation.service.ts))
Singleton `simulationService`, the most logic-heavy file. Acts as a mini dispatcher:
- Builds a **directed node graph** from `map.curves` (each curve carries `sNode`/`eNode`; traversed start→end only, so **one-way edges are respected**).
- 2 AGVs **park at the map's Charge nodes**; idle = wait & charge there.
- On a PENDING mission it dispatches the **nearest free AGV by Dijkstra `shortestPath` cost**, routes it node→node, marks the mission FINISHED on arrival, then routes the AGV **home** to its parking node.
- **Traffic control** (`resolveTraffic`): a moving AGV reserves a look-ahead zone (`TRAFFIC_RADIUS`); if a higher-priority AGV occupies it the lower one yields (status `TRAFFIC`). Priority: heading-to-target > returning-home.
- Raises alarms: low-battery WARNING + random transient FATAL faults (auto-recover). Emits VDA5050 state every tick + throttled stream log.

### Map & coordinates
[src/services/map.service.ts](src/services/map.service.ts) — plain functions: `loadMap(url)` / `loadMapFromJson(string)` both call `parseMap(raw)` to normalize `advancedPointList`/`advancedCurveList`/`advancedAreaList` into a `FleetMap`; plus `buildNodeMap()`, `getMapBounds()`. The bundled map is ~**61×160 m** (`public/maps/origin_20260120205139.json`).
Coordinates: map = metres +X East/+Y North; canvas = pixels +Y down → **flip Y** (`worldToScreen`/`screenToWorld` in [src/utils/canvas.ts](src/utils/canvas.ts)). Heading `screenRot = π/2 - theta` (theta in **degrees** in code). **AGVs are drawn true-to-scale in metres** (`robotSize` = footprint metres × zoom, px floor) so they match the map; the toolbar "Robot m" slider sets that.

### Types
[src/types/index.ts](src/types/index.ts) — VDA5050 wire shapes, ATP map shapes (`MapCurve` has `sNode`/`eNode`), and the UI model **`Robot`** (not `Vehicle`). [src/types/fleet.ts](src/types/fleet.ts) — domain types adapted from the legacy system: `Mission`, `Alarm`, `AgvTypeSpec`, `AmrConfig`, `MapConfig`, `BrokerConfig`, RBAC. **Import `Mission`/`Alarm`/config types from `@/types/fleet`, NOT `@/types`** (the barrel does not re-export them, to avoid a cycle).

## Fleet & specs
- [src/constants/fleet-roster.ts](src/constants/fleet-roster.ts) — our own ATP demo fleet (`ATP-01..06`, mixed models). The simulator uses the first 2.
- [src/constants/agv-specs.ts](src/constants/agv-specs.ts) — per-model physical specs (`AGV_SPECS`, `speedMaxOf()`); the sim drives each model at its real top speed.
- [db/schema.sql](db/schema.sql) — clean `atp_rms` MySQL schema (agv_type/map/mission/alarm/…), structure adapted from the legacy system, kept for when a real backend is added.

## Legacy system (reference only)
Adapted *structure* (not data) from the old Aiten RDS at `C:\Aipa\System` (Spring Boot + MySQL `aipa_rds` + openTCS; real UI on :12200, sim on :12201). Its rows are other customers' leftover data — **build our own maps/fleet, don't import theirs.** The expanded status bar + cursor readout were modelled on that UI. See the `legacy-aiten-rds-system` memory for DB access details.

## Conventions
- Import services via their singletons (`mqttService`, `simulationService`); map helpers are named functions.
- Status colours/labels + asset paths (`AGV_ASSET_PATH(model,status)`) + `DEFAULT_MAP_CONFIG` live in [src/constants/index.ts](src/constants/index.ts). SVG assets: `public/assets/agv/<MODEL>/<MODEL>_<STATUS>.svg`.
- Run `npm run build` before considering work done (it type-checks). Work is committed in small `feat:`/`fix:` commits; nothing has been pushed to a remote in this session.
