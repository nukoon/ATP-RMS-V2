# Aiten Fleet Management System — Architecture & Feature Reference
### For ATP-RMS-V2 Development Team

> **Source:** Live system analysis of Aiten/Aipa RDS v1.7.16 running at `C:\Aipa\System`  
> **Analyzed:** 2026-05-24 / 2026-06-02  
> **Purpose:** Reference architecture and feature inventory for ATP-RMS-V2 development  
> **Note:** This document reflects observed behavior of a production-deployed system — includes both strengths and identified deficiencies.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Service Architecture](#2-service-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Data Architecture](#4-data-architecture)
5. [AGV Communication Protocol](#5-agv-communication-protocol)
6. [Map & Topology System](#6-map--topology-system)
7. [Traffic Management (Control Areas)](#7-traffic-management-control-areas)
8. [Order & Task Lifecycle](#8-order--task-lifecycle)
9. [Complete Feature List](#9-complete-feature-list)
10. [Known Deficiencies (Design Gaps)](#10-known-deficiencies-design-gaps)
11. [Recommended Improvements for ATP-RMS-V2](#11-recommended-improvements-for-atp-rms-v2)

---

## 1. System Overview

Aiten/Aipa is an **AGV Fleet Management System** built on top of **openTCS** (open Traffic Control System). It provides a full stack for controlling, dispatching, monitoring, and simulating Automated Guided Vehicles (AGVs) in warehouse and manufacturing environments.

### Core Responsibilities

| Domain | Responsibility |
|--------|---------------|
| Map Management | Floor topology, points, paths, zones |
| Traffic Control | AGV routing, path locking, zone concurrency |
| Order Dispatch | Task creation, assignment, priority scheduling |
| AGV Monitoring | Real-time position, battery, status |
| Device Integration | Doors, gates, elevators, charge stations, call devices |
| Warehouse Steps | Step-by-step action execution at each point (pick/place/scan) |
| Simulation | Virtual AGV movement without physical hardware |
| 3D Visualization | Digital twin via Unreal Engine |
| Authentication | Role-based access control |
| Analytics | Task statistics, AGV uptime, order history |

---

## 2. Service Architecture

### 2.1 System Topology

```
┌─────────────────────────────────────────────────────────────┐
│                   Frontend Layer                             │
│  RDS UI :12200 (rdsFront 3.7.12)                           │
│  Simulation UI :12201 (simFront 3.7.12)                    │
│  [Nginx Reverse Proxy — routes /aipa/* to backend]          │
└────────────────────┬────────────────────────────────────────┘
                     │ REST API (JSON over HTTP)
          ┌──────────┼───────────┐
          ▼          ▼           ▼
   ┌────────────┐ ┌──────┐ ┌─────────┐
   │  Platform  │ │  RDS │ │   WCS   │
   │   :12310   │ │:12210│ │  :8070  │
   └─────┬──────┘ └──┬───┘ └────┬────┘
         │           │          │
         └───────────┼──────────┘
                     │ REST API
               ┌─────▼──────┐
               │  openTCS   │
               │  Kernel    │
               │  :55200    │
               └─────┬──────┘
                     │ MQTT / VDA5050 v2.0
               ┌─────▼──────┐
               │    AGVs    │
               │ (real/sim) │
               └────────────┘

Shared Infrastructure:
  MySQL :3306 │ Redis :6379 │ MQTT Broker :1883 │ MinIO :9000
```

### 2.2 Services Detail

#### Platform Service
- **Port:** 12310
- **Role:** Authentication, authorization, user management, file/map storage
- **Key Functions:**
  - Sa-Token based auth (custom headers: `Authorize-Code`, `Client-Code`)
  - Role-based access control (RBAC)
  - MinIO file management (map files, models)
  - Hardware license validation (MAC address + hardware fingerprint)
- **Database:** `aipa_platform` (MySQL)
- **Redis DB:** 0

#### RDS — Route Dispatch System
- **Port:** 12210
- **Role:** Core AGV dispatching engine — the brain of the system
- **Key Functions:**
  - Order creation, queuing, and assignment
  - AGV state tracking and monitoring
  - Map configuration management
  - Control Area / Standby Area / Monitor Area management
  - Charge station and sleep plan management
  - Alert and error monitoring (email notifications via SMTP)
  - Schedule-based task automation (cron)
  - Segment-based routing logic
- **Database:** `aipa_rds` (MySQL)
- **Redis DB:** 1
- **MQTT Client:** `Aipa_Rds`

#### WCS — Warehouse Control System
- **Port:** 8070
- **Role:** Step-by-step action execution at pick/place points
- **Key Functions:**
  - Template-based workflow definition (TDS — Template Definition System)
  - Step execution at each map point (pick, place, scan, door open, etc.)
  - External device integration (conveyors, scanners, PLCs)
  - Order step tracking and retry logic
- **Database:** `aipa_wcs` (MySQL)
- **Redis DB:** 11

#### openTCS / TCS Kernel
- **Port:** 55200 (public API), 55100 (admin), 55000–55010 (RMI)
- **Role:** Path planning, topology management, AGV assignment, order scheduling
- **Key Functions:**
  - Dijkstra/A* shortest path calculation
  - Path locking and Control Area enforcement
  - VDA5050 command dispatch to AGVs
  - Transport order lifecycle management
  - Vehicle state machine management
- **Config:** `openTCS-Kernel/config/`

#### DTS — Digital Twin System
- **Port:** 12212
- **Role:** 3D real-time visualization
- **Key Functions:**
  - 3D scene rendering (Unreal Engine)
  - Real-time AGV position mirroring
  - 3D model management (MinIO)
- **Database:** `aipa_dts` (MySQL)
- **Redis DB:** 4

#### Simulate Service
- **Port:** 8033 (backend)
- **Role:** Virtual AGV engine for testing without physical hardware
- **Key Functions:**
  - Simulated AGV movement along planned paths
  - Configurable simulation speed (1x–Nx)
  - Full VDA5050 protocol simulation over MQTT
  - Order simulation modes: Standard / Loop / Timed / Random
- **Database:** `aipa_simulate` (MySQL)
- **Redis DB:** 8

### 2.3 Shared Infrastructure

| Service | Port | Role |
|---------|------|------|
| MySQL 8.x | 3306 | Persistent data — separate DB per service |
| Redis | 6379 | Cache, session, real-time state |
| MQTT Broker | 1883 | AGV ↔ openTCS communication (VDA5050) |
| MinIO | 9000 | Object storage (map files `.amap`/`.smap`, 3D models) |
| Nginx | 12200/12201 | Reverse proxy, routes `/aipa/*` to backend services |

---

## 3. Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend Runtime | Java 17 | All services are Spring Boot fat JARs |
| Service Manager | WinSW (Windows Service Wrapper) | Windows-native service management |
| Web Framework | Spring Boot | REST APIs, dependency injection |
| ORM | MyBatis-Plus | SQL mapping layer |
| Traffic Control Engine | openTCS 5.17.7.74 | Modified/forked from open-source |
| AGV Protocol | VDA5050 v2.0 over MQTT | Industry standard AGV communication |
| Authentication | Sa-Token | Stateless token auth |
| DB Connection Pool | Lettuce (Redis), Alibaba Druid (MySQL) | |
| Network Layer | Netty | High-performance async I/O |
| Frontend Framework | UmiJS + React | SPA architecture |
| Map Rendering | Web Workers | Multi-threaded canvas rendering |
| 3D Engine | Unreal Engine | Via DTS service |
| Object Storage | MinIO | S3-compatible local storage |
| Message Broker | MQTT (local broker) | VDA5050 AGV messaging |
| License System | Hardware fingerprint | MAC + serial number validation |

---

## 4. Data Architecture

### 4.1 Database Summary

| Database | Owner Service | Key Tables |
|----------|--------------|-----------|
| `aipa_platform` | Platform | user, role, file_info_record |
| `aipa_rds` | RDS | task, agv_info, agv_state_record, area, rds_map, station, charge_station, segment, tcs_order, schedule_task, agv_error, sleep_plan, monitor_area |
| `aipa_wcs` | WCS | tds_template, tds_template_parameter, tds_order, tds_order_step, tds_external_step_config |
| `aipa_dts` | DTS | digital_twin, model, scene |
| `aipa_simulate` | Simulate | (simulation state) |

### 4.2 Key RDS Data Entities

```
rds_map          — map metadata (name, floor, MinIO file reference)
  └── area       — zone definitions (STANDBY / CONTROL / MONITOR)
  └── station    — pickup/dropoff station definitions
  └── segment    — logical path segments

agv_info         — AGV configuration (dimensions, IP, thresholds)
  └── agv_state_record  — historical position/battery/status logs

task             — individual AGV task record
  └── task_type  — task type definitions (Transport, Park, etc.)
  └── task_template — reusable task templates

tcs_order        — openTCS transport order linkage

charge_station   — charger physical configuration
schedule_task    — cron-based automation rules
agv_error        — error event log
sleep_plan       — AGV sleep/wake schedule
```

### 4.3 Map File Format

- **Extension:** `.amap` (primary), `.smap` (legacy)
- **Storage:** MinIO bucket `aipa`
- **Content:** JSON-based topology (points, paths, areas, equipment)
- **Transfer:** Uploaded via Platform API, referenced by `rds_map` record

---

## 5. AGV Communication Protocol

### VDA5050 v2.0 (over MQTT)

All AGV ↔ system communication uses the **VDA5050 v2.0** standard protocol published over MQTT.

#### MQTT Topic Structure (VDA5050)
```
uagv/v2/{manufacturer}/{serialNumber}/order          → System → AGV (movement commands)
uagv/v2/{manufacturer}/{serialNumber}/instantActions → System → AGV (immediate actions)
uagv/v2/{manufacturer}/{serialNumber}/state          → AGV → System (status updates)
uagv/v2/{manufacturer}/{serialNumber}/visualization  → AGV → System (position stream)
uagv/v2/{manufacturer}/{serialNumber}/connection     → AGV → System (online/offline)
uagv/v2/{manufacturer}/{serialNumber}/factsheet      → AGV → System (capabilities)
```

#### VDA5050 Message Flow
```
1. openTCS → AGV: Order message (nodeIds, edgeIds, actions)
2. AGV → openTCS: State message (position, battery, orderId, actionStates)
3. openTCS → AGV: InstantActions (cancel, pause, resume, startPaused)
4. AGV → openTCS: Visualization (real-time X/Y/theta at high frequency)
```

#### AGV State Machine
```
IDLE ──► MOVING ──► ACTION_EXECUTING ──► IDLE
  │                                       │
  └──► CHARGING ────────────────────────►─┘
  │
  └──► ERROR ──► (manual recovery) ──► IDLE
```

#### Supported Action Types (at nodes)
- Pick / Place (cargo handling)
- Charge (at charge stations)
- Park (at standby areas)
- Custom actions (scanner, door, gate, conveyor via WCS)

---

## 6. Map & Topology System

### 6.1 Map Elements

| Element | Description | Naming Convention |
|---------|-------------|------------------|
| Action Point (AP) | Pick/drop/action locations | AP1, AP2, ... APn |
| Landmark Point (LM) | Navigation waypoints | LM48, LM72, ... |
| Path | Bidirectional edge between two points | auto-generated |
| Control Area | Zone for AGV concurrency control | Control Area-N |
| Standby Area | Designated AGV resting zone | Standby Area-N |
| Monitor Area | Speed-limiting zone | Monitor Area-N |
| Charge Station | Physical charger location | Charge Station-N |
| Automatic Door | Door integration point | — |
| Barrier Gate | Gate integration point | — |

### 6.2 Map Configuration Observed (duni facility, Floor 1)

| Element | Count |
|---------|-------|
| Navigation Points | 132 (AP + LM series) |
| Paths | 259 bidirectional |
| Control Areas | 13 |
| Standby Areas | 3 (one per AGV) |
| Monitor Areas | 0 (none configured) |
| Charge Stations | 3 |
| Named Zones | 5 (storage_duni, pallet_stacker, trash_bin, production_line_1/2) |
| AGVs | 3 (AGV-56, AGV-58, AGV-60) |

### 6.3 Map Management Workflow
```
1. Design map in editor (points, paths, areas)
2. Save → uploads .amap to MinIO via Platform API
3. RDS loads map reference from rds_map table
4. openTCS Kernel ingests topology from RDS
5. Frontend renders map from MinIO file via Web Workers
```

---

## 7. Traffic Management (Control Areas)

### 7.1 Area Types

| Type | Purpose | Mechanism |
|------|---------|-----------|
| **Control Area** | Limit concurrent AGVs in a zone | `maxAgvNum` — AGV must wait if zone full |
| **Standby Area** | AGV resting location when idle | One-to-one AGV assignment |
| **Monitor Area** | Speed limiting | Max speed enforced when AGV inside area |

### 7.2 Control Area Behavior
- Each Control Area contains a list of map points
- When an AGV's path passes through a Control Area, it acquires a **lock token**
- If `maxAgvNum` AGVs are already inside, the next AGV **waits** at the boundary
- On exit, the lock is released and the waiting AGV proceeds

### 7.3 Path Planning Strategy Options

| Strategy | Behavior |
|---------|---------|
| `IGNORE_PATH_LOCKS` | Ignores locks during re-plan — highest throughput, highest collision risk |
| `PAUSE_IMMEDIATELY` | Pauses AGV immediately when lock acquired |
| `PAUSE_AT_PATH_LOCK` | Pauses at boundary of locked path |
| `REPLAN_ON_FUTURE_LOCKS` | Re-routes around locked paths — safest |

### 7.4 Shortest Path Algorithm Options
- `DISTANCE` — minimizes total path distance
- `TRAVELTIME` — minimizes estimated travel time
- `EXPLICIT_PROPERTIES` — uses custom weight properties on edges
- `HOPS` — minimizes number of intermediate nodes

---

## 8. Order & Task Lifecycle

### 8.1 Full Order Flow

```
Step 1:  External system / UI creates order → POST /aipa/rds/task/create
Step 2:  RDS validates, stores in aipa_rds.task (status: WAITING)
Step 3:  RDS scheduler scans tasks every 60s (configurable)
Step 4:  RDS selects AGV by priority: BY_DEADLINE + IDLE_FIRST
Step 5:  RDS sends transport order to openTCS REST API (:55200)
Step 6:  openTCS plans path (Dijkstra) through 132 points / 259 paths
Step 7:  openTCS assigns order to AGV, sends VDA5050 Order via MQTT
Step 8:  AGV begins movement, sends State/Visualization messages
Step 9:  WCS executes step actions at each point (pick/place/scan)
Step 10: AGV reaches destination, completes actions
Step 11: openTCS notifies RDS → task marked COMPLETED
Step 12: Frontend (Kanban / Task view) updates
```

### 8.2 Task States
```
WAITING → RUNNING → COMPLETED
                 → FAILED
                 → CANCELLED
```

### 8.3 Order Priority System

| Priority | Assignment Rule |
|---------|----------------|
| BY_DEADLINE | Orders closest to deadline dispatched first |
| BY_AGE | Oldest orders dispatched first (FIFO) |
| DEADLINE_AT_RISK_FIRST | Orders within urgent threshold (60s) jump queue |
| BY_NAME | Alphabetical (for testing) |

### 8.4 AGV Assignment Priority

| Priority | Rule |
|---------|------|
| IDLE_FIRST | Prefer AGVs not currently executing orders |
| BY_ENERGY_LEVEL | Prefer AGVs with higher battery |
| BY_NAME | Alphabetical |

### 8.5 Auto-Charging Logic
- Threshold: Battery < 30% triggers automatic charging task
- Strategy: `Continuously charge until full` (configurable)
- Charging task interrupts idle AGVs, not active delivery tasks
- Charge station assigned per AGV in configuration

---

## 9. Complete Feature List

### 9.1 Map & Topology

- [x] Visual map editor (point/path/area creation)
- [x] Multi-floor map support
- [x] Map import/export (`.amap`, `.smap`)
- [x] MinIO-based map file storage
- [x] Background image overlay (with offset/zoom/rotation/opacity)
- [x] Action Points (AP) — pick/drop nodes
- [x] Landmark Points (LM) — navigation waypoints
- [x] Bidirectional path definition
- [x] Area definition (Control / Standby / Monitor)
- [x] Equipment placement (doors, gates, charge stations)
- [x] Point-level search within map editor
- [x] Named zone overlay (Kanban view)
- [x] Map minimap (navigation aid)
- [x] Measure tool (distance on map)
- [x] Undo/redo in map editor

### 9.2 AGV Management

- [x] AGV registration and configuration
- [x] AGV physical dimensions (L/W/H, front/rear length, safety width)
- [x] AGV IP address configuration
- [x] Per-AGV standby area assignment
- [x] Per-AGV charge station assignment
- [x] Battery level monitoring (real-time %)
- [x] Battery low threshold configuration (default 30%)
- [x] Last charge timestamp tracking
- [x] Real-time position display (X/Y/angle)
- [x] Real-time speed display
- [x] AGV online/offline status
- [x] AGV processing status (Free / Moving / Charging / Error)
- [x] Order receiving status (Enable/Disable per AGV)
- [x] Path color per AGV (visual differentiation)
- [x] Points task can occupy (multi-point reservation)
- [x] Cargo dimensions per AGV
- [x] Manual navigation mode
- [x] Maintenance mode
- [x] Assign/Approve controls per AGV
- [x] Sleep plan (scheduled shutdown/wake)

### 9.3 Order & Task Management

- [x] Transport order creation
- [x] Park order creation
- [x] Task type configuration (extensible)
- [x] Task templates (reusable order definitions)
- [x] Order queue management
- [x] Real-time order status tracking
- [x] Order priority management (Deadline / Age / Risk)
- [x] AGV assignment priority configuration
- [x] Urgent deadline threshold (configurable ms)
- [x] Task scan interval (configurable)
- [x] Outdated order cleanup (configurable interval)
- [x] Historical task records (30,147+ observed)
- [x] Task filtering (by AGV, type, date range, status)
- [x] Task export (CSV/Excel)
- [x] Order simulator (test mode)
- [x] Order simulation modes: Standard / Loop / Timed / Random
- [x] Schedule-based automatic task creation (cron)
- [x] Random task generation
- [x] External order intake (Inbound Mode)

### 9.4 Traffic Management

- [x] Control Areas (zone-based AGV concurrency)
- [x] Standby Areas (idle AGV positioning)
- [x] Monitor Areas (speed limiting zones) *(defined, none deployed in observed facility)*
- [x] Path locking mechanism
- [x] 4 path re-plan strategies (IGNORE / PAUSE_IMMEDIATELY / PAUSE_AT_PATH_LOCK / REPLAN)
- [x] Shortest path algorithm selection (DISTANCE / TRAVELTIME / EXPLICIT_PROPERTIES / HOPS)
- [x] Multi-algorithm combination (DISTANCE + EXPLICIT_PROPERTIES observed)
- [x] Edge attribute weighting for path planning
- [x] Topology auto-save on state change
- [x] Re-plan on topology change (toggle)
- [x] Re-plan on driver command completion (toggle)
- [x] Allow same-direction entry per area (toggle)
- [x] External device rescheduling interval

### 9.5 Charging & Parking

- [x] Automatic charge task creation for low-battery AGVs
- [x] Manual charge task creation
- [x] Continuous charge until full mode
- [x] Parking instruction creation for idle AGVs
- [x] Parking spot priority consideration
- [x] Re-park to higher priority location
- [x] Multiple charge stations (3 observed)
- [x] Per-AGV charge station assignment

### 9.6 WCS — Step Execution

- [x] Template Definition System (TDS)
- [x] Step-based workflow execution
- [x] Pick-up height configuration
- [x] Drop-off height configuration
- [x] Cargo placement process definition
- [x] Cargo retrieval process definition
- [x] External step configuration (PLC, conveyor, scanner)
- [x] External step parameter mapping
- [x] Template import/export
- [x] Step retry logic
- [x] Automatic (single step) mapping generation

### 9.7 Device Integration

- [x] Automatic Door integration (MQTT/API trigger)
- [x] Barrier Gate integration
- [x] Elevator integration
- [x] Charge Station integration
- [x] Button Box (worker call device)
- [x] PDA (worker mobile device)
- [x] Call Tablet (worker tablet station)
- [x] External step device integration (PLC, conveyor)

### 9.8 Monitoring & Alerting

- [x] Real-time AGV status monitoring
- [x] AGV error logging (agv_error table)
- [x] AGV error monitoring rules (agv_error_monitor)
- [x] Email alert on AGV error (SMTP)
- [x] AGV maintenance records
- [x] Kanban board (live facility overview)
- [x] Equipment status summary (doors, chargers, elevators)
- [x] Server status indicator
- [x] Statistics page (AGV online time, order counts)
- [x] PDF/Excel export of statistics

### 9.9 Simulation

- [x] Full AGV simulation (without physical hardware)
- [x] VDA5050 protocol simulation over MQTT
- [x] Configurable simulation speed (1x–Nx multiplier)
- [x] Order simulation: Standard / Loop / Timed / Random modes
- [x] Simulation statistics (per-AGV online time)
- [x] Simulation start/pause/stop controls
- [x] Multiple simulated AGVs simultaneously

### 9.10 3D Digital Twin

- [x] 3D scene creation and management
- [x] 3D model library (MinIO-stored)
- [x] Real-time AGV position mirroring in 3D
- [x] Unreal Engine rendering pipeline

### 9.11 User & Access Management

- [x] User account management
- [x] Role-based access control (RBAC)
- [x] Role creation and permission assignment
- [x] Authorization management (user-role mapping)
- [x] Hardware license (MAC + fingerprint)
- [x] Session management (Sa-Token)
- [x] Multi-language UI (language switcher observed)

### 9.12 System Configuration

- [x] Rule engine (automation trigger rules — UI present, no rules deployed)
- [x] Data dictionary management
- [x] Client configuration (frontend display settings)
- [x] Inbound mode (external system integration)
- [x] Bulk import / export of configuration data
- [x] System version display
- [x] Log download (date range selection)
- [x] Newbie guide / onboarding reset

---

## 10. Known Deficiencies (Design Gaps)

These are issues observed in the Aiten v1.7.16 production installation that ATP-RMS-V2 should avoid or improve upon.

### 10.1 🔴 Critical — Traffic Control Not Functional

| Issue | Detail |
|-------|--------|
| `maxAgvNum = null` on ALL 13 Control Areas | No AGV concurrency limit is enforced — any number of AGVs can enter any zone simultaneously |
| No UI field to set `maxAgvNum` | The map editor form only shows Name, Points list, and "Allow same direction entry" — maxAgvNum must be set via direct API call |
| Strategy = `IGNORE_PATH_LOCKS` | System ignores path locks during re-planning — even if maxAgvNum were set, re-routes could violate it |
| 0 Monitor Areas deployed | No speed limiting zones configured anywhere in the facility |

### 10.2 🟠 High — Topology Design Issues

| Issue | Detail |
|-------|--------|
| Point overlap between Control Areas | LM129/LM130 in both Area-2 & Area-10; LM131 in Area-2 & Area-6; LM133 in Area-7 & Area-8 — potential deadlock points |
| Area ID gaps (1, 3, 9, 11 missing) | Areas were deleted; coverage they provided is now absent |
| Control Area-5 covers 34 points | Overly large single area reduces traffic management granularity |

### 10.3 🟡 Medium — Architecture Observations

| Issue | Detail |
|-------|--------|
| Windows-only deployment | WinSW service management limits deployment to Windows; no containerization observed |
| Single MQTT broker, no clustering | Single point of failure for all AGV communication |
| Hardcoded China SMTP for alerts | smtp.163.com — may not be suitable for non-China deployments |
| License = hardware fingerprint | Difficult to move between machines or virtualize |
| No Monitor Area UI tested | Whether Monitor Area speed limits work at runtime is untested in this installation |

---

## 11. Recommended Improvements for ATP-RMS-V2

Based on the Aiten system analysis, the following improvements are recommended for ATP-RMS-V2:

### Architecture

| Recommendation | Reason |
|----------------|--------|
| Containerize all services (Docker/Kubernetes) | Remove Windows dependency, enable scaling |
| Cluster MQTT broker (EMQX/HiveMQ) | Eliminate single point of failure for AGV comms |
| Expose maxAgvNum in UI | Critical traffic control parameter must be UI-accessible |
| Pluggable alert channel (not just SMTP) | Support LINE Notify, Slack, Teams, SMS in addition to email |
| Multi-region / multi-facility support | Single platform managing multiple facilities |

### Traffic Management

| Recommendation | Reason |
|----------------|--------|
| Default `maxAgvNum = 1` on Control Area creation | Prevent "no limit" configuration by default |
| Validate path locks before strategy selection | Prevent `IGNORE_PATH_LOCKS` without explicit confirmation |
| Overlap detection when creating areas | Warn operator if a point is added to multiple Control Areas |
| Required Monitor Areas on narrow paths | System-level recommendation during map validation |
| Dead-lock detection algorithm | Proactively detect circular waits between AGVs |

### Order Management

| Recommendation | Reason |
|----------------|--------|
| Real-time order creation API (WebSocket/SSE) | Faster than 60-second polling |
| Order priority override (urgent button) | Allow operator to jump specific orders to front of queue |
| Multi-cargo transport support | Single AGV trip handles multiple destinations |
| SLA tracking per order type | Alert when orders exceed expected duration |

### Monitoring

| Recommendation | Reason |
|----------------|--------|
| AGV heatmap (traffic density per path) | Identify bottleneck paths visually |
| Predictive battery management | Dispatch charge task before threshold hit |
| Anomaly detection on AGV state changes | Alert on unexpected state transitions |
| Dashboard with KPIs | Orders/hour, AGV utilization %, average task time |

### Protocol

| Recommendation | Reason |
|----------------|--------|
| VDA5050 v2.0 full compliance | Enables plug-and-play with any compliant AGV brand |
| Manufacturer-agnostic AGV adapter layer | Abstract AGV-specific quirks behind standard interface |
| MQTT topic namespace isolation | Prevent cross-facility message pollution |

---

*Document compiled from live system analysis of Aiten/Aipa RDS v1.7.16*  
*For ATP-RMS-V2 internal use — Nugle / Development Team*  
*Last updated: 2026-06-02*
