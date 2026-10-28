export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

const DEFAULT_MENU_SIZE: Size = { width: 240, height: 220 }
const MARGIN = 8

export function clampMenuPoint(point: Point, viewport: Size, size: Size = DEFAULT_MENU_SIZE): Point {
  const maxX = Math.max(MARGIN, viewport.width - size.width - MARGIN)
  const maxY = Math.max(MARGIN, viewport.height - size.height - MARGIN)
  return {
    x: Math.min(Math.max(point.x, MARGIN), maxX),
    y: Math.min(Math.max(point.y, MARGIN), maxY),
  }
}
