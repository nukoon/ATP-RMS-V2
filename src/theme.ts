/**
 * Theme system — Light + Dark. The UI uses CSS variables (set on :root) so the
 * whole inline-styled app re-colours by swapping the variable values. Canvas /
 * three.js can't read CSS vars, so they pull colours from CANVAS[current] via
 * getCanvas(), read fresh each frame so the map re-themes live.
 *
 * Dark palette goal: modern, easy on the eyes (soft slate-navy, not pure black),
 * with clear contrast — body text ≈ #e6ecf3 on #0f1722 is well above WCAG AA.
 */
export type ThemeName = 'light' | 'dark'

export const PALETTES: Record<ThemeName, Record<string, string>> = {
  light: {
    '--bg': '#eef1f5', '--surface': '#ffffff', '--surface-2': '#f3f6fa', '--border': '#d4dae3',
    '--text': '#1a2230', '--text-2': '#4a5568', '--text-muted': '#64748b', '--text-faint': '#94a3b4',
    '--accent': '#2563eb',
  },
  dark: {
    '--bg': '#0f1722', '--surface': '#18222f', '--surface-2': '#1f2b3a', '--border': '#2c3a4d',
    '--text': '#e6ecf3', '--text-2': '#aebccd', '--text-muted': '#8497ab', '--text-faint': '#5d6e82',
    '--accent': '#4d8bf0',
  },
}

export interface CanvasColors {
  grid: string; edge: string; edgeArrow: string
  labelBg: string; labelText: string; labelBorder: string
  bg3d: number; floorTint: number; grid3dMajor: number; grid3dMinor: number; lane3d: number
}
export const CANVAS: Record<ThemeName, CanvasColors> = {
  light: {
    grid: 'rgba(100,116,139,0.10)', edge: 'rgba(143,166,197,0.92)', edgeArrow: 'rgba(90,124,166,0.95)',
    labelBg: 'rgba(255,255,255,0.92)', labelText: '#334155', labelBorder: 'rgba(208,215,226,0.85)',
    bg3d: 0xeef1f5, floorTint: 0xffffff, grid3dMajor: 0xc2cad6, grid3dMinor: 0xd9dfe8, lane3d: 0x6b8cc4,
  },
  dark: {
    grid: 'rgba(148,163,184,0.13)', edge: 'rgba(120,152,196,0.7)', edgeArrow: 'rgba(150,182,224,0.95)',
    labelBg: 'rgba(20,30,43,0.92)', labelText: '#cdd9e8', labelBorder: 'rgba(72,92,118,0.9)',
    bg3d: 0x0f1722, floorTint: 0x424f61, grid3dMajor: 0x2c3a4d, grid3dMinor: 0x21303f, lane3d: 0x5f86c4,
  },
}

let current: ThemeName = 'light'
export const getTheme = (): ThemeName => current
export const getCanvas = (): CanvasColors => CANVAS[current]

export function applyTheme(name: ThemeName): void {
  current = name
  const root = document.documentElement
  for (const [k, v] of Object.entries(PALETTES[name])) root.style.setProperty(k, v)
  root.style.setProperty('color-scheme', name)
  root.style.background = PALETTES[name]['--bg']
  root.setAttribute('data-theme', name)
}
