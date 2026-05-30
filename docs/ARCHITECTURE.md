# ATP-RMS-V2 — Architecture

## Stack
| Layer | Technology | ทำไม |
|---|---|---|
| Frontend Framework | React 18 + TypeScript | Type-safe, component-based |
| State Management | Zustand | Lightweight, no boilerplate |
| Map Rendering | Canvas API (raw) | Performance สูงสุดสำหรับ real-time |
| MQTT | mqtt.js v5 over WebSocket | VDA5050 v2.0 standard |
| Build | Vite | Fast HMR, optimized bundle |
| Styling | Inline styles + CSS vars | No extra deps, design token ready |

## Coordinate System
```
Map space:    +X = East,  +Y = North (standard math)
Screen space: +X = Right, +Y = Down  (canvas default)
Y transform:  sy = offsetY - (y * scale)
Robot rotation: screenRot = π/2 - theta_rad
  theta=0°   (East)  → 90° CW  → face right
  theta=90°  (North) → 0°      → face up
  theta=180° (West)  → -90° CW → face left
  theta=-90° (South) → 180°    → face down
```

## VDA5050 MQTT Topics
```
uagv/v2/{manufacturer}/{serialNumber}/state         ← robot state (1Hz)
uagv/v2/{manufacturer}/{serialNumber}/visualization ← pose (10Hz)
uagv/v2/{manufacturer}/{serialNumber}/order         → send orders
uagv/v2/{manufacturer}/{serialNumber}/connection    ← online/offline
uagv/v2/{manufacturer}/{serialNumber}/factsheet     ← capabilities
```

## Directory Structure
```
src/
├── types/          — TypeScript interfaces (VDA5050 + UI)
├── constants/      — Status colors, asset paths, defaults
├── services/
│   ├── mqtt.service.ts   — MQTT broker connection
│   └── map.service.ts    — Load & parse ATP map JSON
├── store/
│   └── fleet.store.ts    — Zustand global state
├── utils/
│   └── canvas.ts         — Coordinate transforms, zoom/pan
├── hooks/
│   └── useMapTransform.ts — Canvas transform hook
├── components/
│   ├── map/
│   │   ├── MapCanvas.tsx  — Main 2D renderer
│   │   └── MapToolbar.tsx — Controls (sliders, checkboxes)
│   ├── sidebar/
│   │   └── RobotList.tsx  — Fleet list with status
│   └── panels/
│       ├── VdaStream.tsx  — MQTT message log
│       └── MetricsPanel.tsx — Fleet KPIs
└── App.tsx — Layout shell
```
