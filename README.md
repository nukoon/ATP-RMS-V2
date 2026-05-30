# AiTEN Fleet Digital Twin

Real-time Fleet Management Dashboard สำหรับ AMR ของ AiTEN  
รองรับ **VDA5050 v2.0** ผ่าน MQTT · แผนที่จาก AiTEN map format

![Stack](https://img.shields.io/badge/React-18-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![VDA5050](https://img.shields.io/badge/VDA5050-v2.0-green) ![MQTT](https://img.shields.io/badge/MQTT-5-orange)

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/AutomationPro/aiten-fleet-dt.git
cd aiten-fleet-dt

# 2. Install
npm install

# 3. Config
cp .env.example .env
# แก้ไข VITE_MQTT_BROKER_URL ให้ชี้ broker จริง

# 4. Dev server
npm run dev
# → http://localhost:5173

# 5. Build for production
npm run build
```

---

## Environment Variables

| Variable | ค่าตัวอย่าง | คำอธิบาย |
|---|---|---|
| `VITE_MQTT_BROKER_URL` | `ws://192.168.1.100:9001` | MQTT broker WebSocket URL |
| `VITE_MQTT_MANUFACTURER` | `AiTEN` | VDA5050 manufacturer name |
| `VITE_API_BASE_URL` | `http://192.168.1.100:8080` | Backend REST API |

---

## Project Structure

```
aiten-fleet-dt/
├── public/
│   ├── assets/
│   │   ├── agv/          ← SVG icons per model+status (AM15, MP10S, …)
│   │   ├── board/        ← UI icons
│   │   ├── brand/        ← AiTEN logo, favicon
│   │   └── icons/        ← Map element icons (chargeStation, autodoor)
│   └── maps/             ← Map JSON files
├── src/
│   ├── types/            ← TypeScript interfaces (VDA5050 + UI)
│   ├── constants/        ← Colors, asset paths, defaults
│   ├── services/         ← MQTT + Map loader
│   ├── store/            ← Zustand global state
│   ├── utils/            ← Canvas transforms
│   ├── hooks/            ← useMapTransform
│   └── components/       ← React components
├── docs/
│   ├── ARCHITECTURE.md   ← Tech decisions
│   └── DEVELOPMENT_PLAN.md ← 4-week plan
└── .env.example
```

---

## MQTT Broker Setup (Mosquitto)

```conf
# mosquitto.conf
listener 1883
listener 9001
protocol websockets
allow_anonymous true
```

---

## Map Format

ใช้ AiTEN map format (`advancedPointList` / `advancedCurveList`)  
วางไฟล์ `.json` ไว้ที่ `public/maps/` แล้วแก้ URL ใน `App.tsx`

---

## AGV Models ที่รองรับ

| Model | SVG Assets |
|---|---|
| AM15 | ✅ IDLE, EXECUTING, CHARGING, ERROR, PAUSE, TRAFFIC |
| MP10S | ✅ ครบ |
| AL02, APe15, AS15, TP30, TP60, TT15, TT30, TT60 | ✅ ครบ |

---

## License
© 2026 Automation Pro Co., Ltd. (AiTEN) — Internal use only
