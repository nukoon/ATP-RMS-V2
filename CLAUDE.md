# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ATP-RMS-V2 — a real-time Fleet Management Dashboard ("Digital Twin") for ATP's autonomous mobile robots (AMRs/AGVs). The browser connects directly to an MQTT broker over WebSocket, consumes **VDA5050 v2.0** messages from the fleet, and renders robots on a **2D canvas** map built from the **ATP map format**. There is no backend in this repo — the MQTT broker is the integration boundary. UI/docs mix English and Thai.

## Commands

```bash
npm install          # install dependencies
npm run dev          # Vite dev server → http://localhost:5173 ( /api proxied to :8080 )
npm run build        # tsc (type-check) then vite build
npm run preview      # serve the production build
npm run lint         # eslint src --ext ts,tsx --report-unused-disable-directives
npm run type-check   # tsc --noEmit
```

Requires Node.js 18+ and an MQTT broker with WebSocket enabled (Mosquitto example in [README.md](README.md): TCP `1883` + websockets `9001`). Copy `.env.example` to `.env` first.

**No test runner is configured** — there is no `test` script and no vitest/jest in devDependencies. Don't assume `npm test` exists.

## Configuration

Vite env vars, prefixed `VITE_` to reach the client — see [.env.example](.env.example):
`VITE_MQTT_BROKER_URL`, `VITE_MQTT_USERNAME`, `VITE_MQTT_PASSWORD`, `VITE_MQTT_MANUFACTURER` (`ATP`), `VITE_API_BASE_URL`. Note: the map URL is currently **hardcoded** in [src/App.tsx](src/App.tsx) (`/maps/origin_20260120205139.json`), not driven by env. Path alias `@` → `src/` (see [vite.config.ts](vite.config.ts) and `tsconfig.json`).

## Architecture

```
AGV ─VDA5050/MQTT─► mqtt.service ─► useFleetStore (Zustand) ─► React components ─► react-konva canvas
                         ▲
                  order published back to AGV  (mqttService.sendOrder)
```

Stack: React 18 + TypeScript 5 + Vite, **Zustand** global store, **mqtt.js v5** over WebSocket, **react-konva** for the 2D canvas map (NOT Leaflet / map tiles), **recharts** for charts. Styling is **inline styles + a CSS-variable cyber-HUD theme** (Tailwind/PostCSS are installed but `App.tsx` uses inline styles).

Layout is a fixed HUD shell in [src/App.tsx](src/App.tsx): top status bar → `MapToolbar` → (left `RobotList` sidebar | center `MapCanvas` | right `VdaStream` + `MetricsPanel`) → bottom status bar. Source dirs: `components/{map,panels,sidebar,common}`, `hooks/` (`useMapTransform`), `utils/` (`canvas.ts`), `services/`, `store/`, `constants/`, `types/`.

### MQTT / VDA5050 — the integration contract

[src/services/mqtt.service.ts](src/services/mqtt.service.ts) is a class exported **as a singleton `mqttService`**. Topics follow `${MQTT_BASE_TOPIC}/${manufacturer}/${robotId}/${topic}` where `MQTT_BASE_TOPIC = 'uagv/v2'` and `MQTT_QOS = 1` (both in [src/constants/index.ts](src/constants/index.ts)).
- `connect(config, robotIds)` subscribes per **explicit robotId** (no `+` wildcard) to `state`, `visualization`, `connection`.
- A single `message` handler parses JSON and routes `state`/`visualization` payloads to the `onStateUpdate` callback; register callbacks via `onStateUpdate()` / `onConnectionChange()`.
- `sendOrder(robotId, order)` publishes JSON to the `.../order` topic — the only outbound path.

### State store

[src/store/fleet.store.ts](src/store/fleet.store.ts) (`useFleetStore`, Zustand + `subscribeWithSelector`) is the single source of truth: `robots: Map<robotId, Robot>`, plus `map`, `orders`, `mqttLog` (ring buffer capped at 100), `mqttConnected`/`mqttLatency`, derived `metrics`, and UI state (`mapConfig`, `selectedRobotId`).
- `upsertRobot()` creates/replaces a robot (and is how a robot first enters the store).
- `updateFromVDA5050(robotId, state)` **only updates an already-existing robot** (early-returns otherwise); it sets `status = state.operatingMode` cast to `AgvStatus`, merges pose/battery/velocity/errors, and preserves the existing `pose.mapId`.
- Both mutators call `recomputeMetrics()` (counts by status, avg battery, utilization = active/total).

### Types are the contract

[src/types/index.ts](src/types/index.ts) holds three groups: **VDA5050** wire shapes (`VDA5050State`, `AgvPose`, `AgvBattery`, `VDA5050Error`…), **ATP map** shapes (`FleetMap`, `MapPoint` with `cls: LocationMark|ActionPoint|Charge`, `MapCurve`, `MapArea`), and the **UI** model **`Robot`** (the per-robot aggregate the store holds — the UI model is `Robot`, not `Vehicle`). Also `FleetOrder`, `FleetMetrics`, `MapViewConfig`, `MqttLogEntry`.

### Map loading & coordinates

[src/services/map.service.ts](src/services/map.service.ts) is **plain exported functions** (not a class/singleton): `loadMap(url)` fetches ATP map JSON from `public/maps/*.json` and normalizes `advancedPointList`/`advancedCurveList`/`advancedAreaList` into a `FleetMap`; plus `buildNodeMap()` and `getMapBounds()`.

Coordinate transform — map space is meters, +X East / +Y North; canvas is pixels, +Y down, so **flip Y** (`sy = offsetY - y*scale`). Robot heading: `screenRot = π/2 - theta`, implemented as `MAP_COORD.thetaToScreenRot` in `constants/index.ts`, which treats `theta` as **degrees**. Caveat: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) prose describes `theta` as radians while the code (and the `AgvPose` comment) use degrees — verify against real robot data; theta-format mismatch is flagged as a known risk in [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

## State of the codebase

Early scaffold (~Week 1 of the 4-week plan in [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)). The store, services, types, and all the layout components exist and render, but the live wiring is incomplete: `App.tsx` loads the map and renders panels, yet **MQTT is not connected on startup** and the store is not yet fed from `mqttService` (the robot list will be empty until that loop is wired). When implementing data flow, connect `mqttService.onStateUpdate` → `useFleetStore.updateFromVDA5050` and seed robots via `upsertRobot`.

## Conventions

- Import services via their singleton (`mqttService`); import map helpers as named functions.
- Colors/labels: `STATUS_COLOR`, `STATUS_LABEL`, asset-path helpers `AGV_ASSET_PATH(model, status)` / `AGV_POSTER_PATH(model)`, and `DEFAULT_MAP_CONFIG` all live in [src/constants/index.ts](src/constants/index.ts).
- AGV SVG assets: `public/assets/agv/<MODEL>/<MODEL>_<STATUS>.svg` (statuses IDLE/EXECUTING/CHARGING/ERROR/PAUSE/TRAFFIC); models enumerated in `AGV_MODELS` / the `AgvModel` type. Map element icons under `public/assets/icons/`.
- `npm run lint` reports unused eslint-disable directives — run it before considering work done.
