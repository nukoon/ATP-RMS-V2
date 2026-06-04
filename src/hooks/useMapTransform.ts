import { useCallback, useRef, useState } from 'react'
import type { Transform } from '@/utils/canvas'
import { fitTransform, zoomAt, pan } from '@/utils/canvas'
import type { FleetMap } from '@/types'
import { getMapBounds } from '@/services/map.service'

export function useMapTransform(map: FleetMap | null) {
  const [transform, setTransform] = useState<Transform>({ scale: 1, offsetX: 0, offsetY: 0 })
  const isDragging = useRef(false)
  const lastPos    = useRef({ x: 0, y: 0 })
  const sizeRef    = useRef({ w: 0, h: 0 })

  const fitToCanvas = useCallback((canvasW?: number, canvasH?: number) => {
    if (!map) return
    const w = canvasW ?? sizeRef.current.w
    const h = canvasH ?? sizeRef.current.h
    if (canvasW && canvasH) sizeRef.current = { w: canvasW, h: canvasH }
    if (!w || !h) return
    const b = getMapBounds(map)
    setTransform(fitTransform(b.width, b.height, b.minX, b.minY, w, h))
  }, [map])

  const handleWheel = useCallback((e: WheelEvent, pivotX: number, pivotY: number) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.15 : 0.87
    setTransform(t => zoomAt(t, factor, pivotX, pivotY))
  }, [])

  const handleMouseDown = useCallback((x: number, y: number) => {
    isDragging.current = true
    lastPos.current = { x, y }
  }, [])

  const handleMouseMove = useCallback((x: number, y: number) => {
    if (!isDragging.current) return
    const dx = x - lastPos.current.x
    const dy = y - lastPos.current.y
    lastPos.current = { x, y }
    setTransform(t => pan(t, dx, dy))
  }, [])

  const handleMouseUp = useCallback(() => { isDragging.current = false }, [])

  // zoom about the canvas centre so the view stays put (not the top-left corner)
  const zoomIn  = useCallback(() => setTransform(t => zoomAt(t, 1.3,  sizeRef.current.w / 2, sizeRef.current.h / 2)), [])
  const zoomOut = useCallback(() => setTransform(t => zoomAt(t, 0.77, sizeRef.current.w / 2, sizeRef.current.h / 2)), [])

  return { transform, fitToCanvas, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp, zoomIn, zoomOut }
}
