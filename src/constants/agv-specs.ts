// ============================================================
// ATP-RMS-V2 — AGV model specifications
// Real fleet specs carried over from the legacy AIPA RDS v2
// (agv_type table). Single source of truth for per-model specs.
// ============================================================
import type { AgvModel } from '@/types'
import type { AgvTypeSpec } from '@/types/fleet'

export const AGV_SPECS: Record<AgvModel, AgvTypeSpec> = {
  AM15:  { code: 'AM15',  name: 'AMR 1500kg',        category: 'AMR',      loadKg: 1500, speedMax: 1.5, lengthMm: 1200, widthMm: 800,  heightMm: 320,  turnRadiusMm: 0,    batteryKwh: 1.2 },
  MP10S: { code: 'MP10S', name: 'Mouse Pallet 1T',   category: 'AMR',      loadKg: 1000, speedMax: 1.8, lengthMm: 1000, widthMm: 600,  heightMm: 280,  turnRadiusMm: 0,    batteryKwh: 0.9 },
  AL02:  { code: 'AL02',  name: 'Auto Lifter 200',   category: 'Lifter',   loadKg: 200,  speedMax: 1.2, lengthMm: 700,  widthMm: 500,  heightMm: 1800, turnRadiusMm: 600,  batteryKwh: 0.6 },
  APe15: { code: 'APe15', name: 'Auto Pallet 1.5T',  category: 'Forklift', loadKg: 1500, speedMax: 1.6, lengthMm: 2000, widthMm: 900,  heightMm: 2100, turnRadiusMm: 1200, batteryKwh: 2.4 },
  AS15:  { code: 'AS15',  name: 'Auto Stacker 1.5T', category: 'Forklift', loadKg: 1500, speedMax: 1.3, lengthMm: 1900, widthMm: 1000, heightMm: 2300, turnRadiusMm: 1400, batteryKwh: 2.4 },
  TP30:  { code: 'TP30',  name: 'Tow Pallet 3T',     category: 'Tug',      loadKg: 3000, speedMax: 2.0, lengthMm: 1300, widthMm: 700,  heightMm: 400,  turnRadiusMm: 0,    batteryKwh: 1.5 },
  TP60:  { code: 'TP60',  name: 'Tow Pallet 6T',     category: 'Tug',      loadKg: 6000, speedMax: 1.8, lengthMm: 1500, widthMm: 800,  heightMm: 450,  turnRadiusMm: 0,    batteryKwh: 2.0 },
  TT15:  { code: 'TT15',  name: 'Tunnel Tug 1.5T',   category: 'Tug',      loadKg: 1500, speedMax: 2.0, lengthMm: 1100, widthMm: 600,  heightMm: 300,  turnRadiusMm: 0,    batteryKwh: 1.2 },
  TT30:  { code: 'TT30',  name: 'Tunnel Tug 3T',     category: 'Tug',      loadKg: 3000, speedMax: 1.9, lengthMm: 1300, widthMm: 700,  heightMm: 350,  turnRadiusMm: 0,    batteryKwh: 1.5 },
  TT60:  { code: 'TT60',  name: 'Tunnel Tug 6T',     category: 'Tug',      loadKg: 6000, speedMax: 1.7, lengthMm: 1600, widthMm: 850,  heightMm: 500,  turnRadiusMm: 0,    batteryKwh: 2.2 },
}

/** Max speed (m/s) for a model — used by the simulator to drive realistic per-model speeds. */
export const speedMaxOf = (model: AgvModel): number => AGV_SPECS[model]?.speedMax ?? 1.5
