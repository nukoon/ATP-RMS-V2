/**
 * Canvas utility functions for map rendering
 * Coordinate system: Map +Y = North (up) ↔ Screen +Y = Down
 */

export interface ScreenPos { sx: number; sy: number }
export interface WorldPos  { x:  number; y:  number }

export interface Transform {
  scale: number
  offsetX: number
  offsetY: number
}

/** Map world coords → canvas screen coords */
export function worldToScreen(x: number, y: number, t: Transform): ScreenPos {
  return {
    sx: t.offsetX + x * t.scale,
    sy: t.offsetY - y * t.scale,   // Y-flip: map +Y = screen -Y
  }
}

/** Canvas screen coords → Map world coords */
export function screenToWorld(sx: number, sy: number, t: Transform): WorldPos {
  return {
    x:  (sx - t.offsetX) / t.scale,
    y: -(sy - t.offsetY) / t.scale,
  }
}

/**
 * Compute screen rotation angle for a robot with given map theta.
 * SVG robots face UP (north) by default.
 * Map theta: 0=East, 90=North, 180=West, -90=South
 * Screen rotation (canvas CW+): π/2 − theta_rad
 */
export function thetaToScreenRot(thetaDeg: number): number {
  return Math.PI / 2 - (thetaDeg * Math.PI) / 180
}

/**
 * Compute map theta from movement vector (map coords, +Y=North)
 * Returns angle in degrees: 0=East, 90=North, ±180=West, -90=South
 */
export function calcTheta(dx: number, dy: number): number {
  return Math.atan2(dy, dx) * (180 / Math.PI)
}

/** Fit map bounds into canvas with padding */
export function fitTransform(
  mapW: number, mapH: number, minX: number, minY: number,
  canvasW: number, canvasH: number, padding = 50
): Transform {
  const sw = canvasW - padding * 2
  const sh = canvasH - padding * 2
  const scale = Math.min(sw / mapW, sh / mapH) * 0.90
  return {
    scale,
    offsetX: (canvasW - mapW * scale) / 2 - minX * scale,
    offsetY: canvasH - (canvasH - mapH * scale) / 2 + minY * scale,
  }
}

/** Zoom toward a screen point */
export function zoomAt(
  t: Transform, factor: number,
  pivotX: number, pivotY: number,
  minScale = 0.15, maxScale = 50
): Transform {
  const newScale = Math.max(minScale, Math.min(maxScale, t.scale * factor))
  return {
    scale:   newScale,
    offsetX: pivotX - (pivotX - t.offsetX) * (newScale / t.scale),
    offsetY: pivotY - (pivotY - t.offsetY) * (newScale / t.scale),
  }
}

/** Pan transform */
export function pan(t: Transform, dx: number, dy: number): Transform {
  return { ...t, offsetX: t.offsetX + dx, offsetY: t.offsetY + dy }
}
