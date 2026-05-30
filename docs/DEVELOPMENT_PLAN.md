# AiTEN Fleet Digital Twin — Development Plan (4 Weeks)

## Goal
Production-ready Fleet Management Digital Twin ที่:
- แสดง AMR position real-time ผ่าน VDA5050 v2.0 / MQTT
- ใช้ map จริงจาก AiTEN system (`.json` format)
- แสดง robot model SVG จาก AiTEN asset ถูก model/status
- รองรับ 10+ robots พร้อมกัน, refresh < 100ms

---

## Week 1 — Foundation & Map Engine
**Owner:** Frontend Lead + Backend Dev

### Day 1–2: Project Setup
- [ ] Clone repo, `npm install`, verify Vite dev server ขึ้น
- [ ] Configure `.env` ให้ชี้ MQTT broker จริง
- [ ] ตรวจสอบ asset paths ทั้งหมดใน `public/assets/agv/`
- [ ] ทดสอบ `loadMap()` โหลด `origin_20260120205139.json` ได้

### Day 3–4: Map Canvas (2D)
- [ ] Wire `MapCanvas.tsx` เข้า `App.tsx` พร้อม `useMapTransform`
- [ ] ตรวจสอบ coordinate transform (Y-flip, zoom-at-cursor)
- [ ] ทดสอบ Bezier curve ด้วย control points จริง
- [ ] ตรวจสอบ robot rotation formula: `π/2 − theta_rad`

### Day 5: Robot Simulation (Dev Mode)
- [ ] สร้าง `src/services/simulation.service.ts` — จำลอง robot movement
- [ ] Wire simulation เข้า Zustand store แทน MQTT (dev fallback)
- [ ] ตรวจสอบ theta calculation จาก movement vector

**Deliverable:** Map render ถูกต้อง + robot เดินบน path simulation

---

## Week 2 — MQTT Integration & Real Data
**Owner:** Backend Dev + Frontend Lead

### Day 1–2: MQTT Service
- [ ] Connect `MqttService` กับ broker จริง (Mosquitto/EMQX)
- [ ] Subscribe VDA5050 `state` + `visualization` topics
- [ ] Wire `updateFromVDA5050()` เข้า Zustand store
- [ ] Log latency (timestamp diff ระหว่าง robot clock กับ browser)

### Day 3: Robot State Sync
- [ ] Map VDA5050 `operatingMode` → `AgvStatus` enum
- [ ] Update robot pose จาก `agvPosition` (x, y, theta)
- [ ] Update battery จาก `batteryState.batteryCharge`
- [ ] แสดง VDA5050 error list ใน tooltip

### Day 4–5: Order Management
- [ ] ออกแบบ Order UI (create, assign, track)
- [ ] Send VDA5050 Order message ผ่าน `mqttService.sendOrder()`
- [ ] Track order progress จาก `state.lastNodeSequenceId`
- [ ] แสดง active orders ใน right panel

**Deliverable:** Robot เคลื่อนที่บน map จาก MQTT data จริง

---

## Week 3 — UI Polish & Features
**Owner:** Full Team

### Day 1–2: Robot Detail Panel
- [ ] Click robot → แสดง detail panel (full VDA5050 state)
- [ ] แสดง error/warning list พร้อม severity badge
- [ ] แสดง current order + node sequence progress bar
- [ ] Quick actions: Pause, Resume, Cancel Order

### Day 3: Fleet Metrics Dashboard
- [ ] Throughput calculation (orders/hr rolling window)
- [ ] Utilization % (active / total)
- [ ] Battery heatmap ใน sidebar
- [ ] Alert system: low battery (< 20%), error robot highlight

### Day 4: Minimap + Navigation
- [ ] Minimap canvas (overview + viewport rect)
- [ ] Click minimap → jump to location
- [ ] "Follow Robot" mode (pan ตาม robot ที่ select)
- [ ] Zoom to robot button

### Day 5: Multi-Floor Support (ถ้ามี)
- [ ] Map selector dropdown (ถ้ามีหลาย floor)
- [ ] Robot ย้าย floor → switch map view
- [ ] Elevator node visualization

**Deliverable:** UI ครบ, usable โดยทีม operations

---

## Week 4 — Stability, Testing & Deploy
**Owner:** Full Team

### Day 1–2: Performance & Edge Cases
- [ ] Profile canvas FPS กับ 10+ robots (ต้องการ > 30 FPS)
- [ ] Off-screen culling สำหรับ nodes ที่ไม่อยู่ใน viewport
- [ ] Handle MQTT disconnect/reconnect gracefully
- [ ] Handle map load failure + retry logic

### Day 3: Testing
- [ ] Unit test `canvas.ts` (coordinate transforms)
- [ ] Unit test `map.service.ts` (parse ไฟล์ map)
- [ ] Integration test MQTT mock → store → render
- [ ] Manual QA: ทดสอบกับ robot จริงใน Lat Krabang

### Day 4: Deployment
- [ ] `npm run build` → ตรวจสอบ bundle size
- [ ] Setup web server (Nginx / static serve)
- [ ] Deploy บน internal network (หรือ VPS)
- [ ] Configure CORS + MQTT WebSocket port

### Day 5: Documentation & Handoff
- [ ] README.md: setup, config, deployment steps
- [ ] API docs: VDA5050 topic structure ที่ใช้
- [ ] สอนทีม operations ใช้งาน fleet map

**Deliverable:** Production build พร้อมใช้งานจริง

---

## Technical Risks & Mitigation
| Risk | Impact | Mitigation |
|---|---|---|
| MQTT broker ไม่รองรับ WebSocket | High | ติดตั้ง Mosquitto plugin `mosquitto-plugin-websocket` port 9001 |
| Robot theta format ต่างจาก spec | Medium | Log raw VDA5050 state แล้วเทียบกับการเคลื่อนที่จริง |
| Canvas performance กับ 10+ robots | Medium | RequestAnimationFrame + offscreen culling + image cache |
| Map format เปลี่ยนใน update ใหม่ | Low | Isolate map parser ใน `map.service.ts` เดียว |

## Team Roles
| Role | งาน |
|---|---|
| Frontend Lead | MapCanvas, transforms, robot rendering |
| Frontend Dev | Sidebar, panels, toolbar, styling |
| Backend Dev | MQTT broker setup, VDA5050 bridge, API |
| QA / Ops | Test กับ robot จริง, UAT |
