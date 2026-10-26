// 截屏裁剪纯函数（G1）：显示坐标（contain-fit）→ 原图像素。
export type Rect = { x: number; y: number; width: number; height: number }

/** 任意拖向 → 正向矩形。 */
export function normalizeDrag(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

/** 选区与显示区求交（越界部分裁掉；完全在外时贴边 0 尺寸）。 */
export function clampRect(rect: Rect, bounds: Rect): Rect {
  const x = Math.max(bounds.x, rect.x)
  const y = Math.max(bounds.y, rect.y)
  const right = Math.min(bounds.x + bounds.width, rect.x + rect.width)
  const bottom = Math.min(bounds.y + bounds.height, rect.y + rect.height)
  const width = Math.max(0, right - x)
  const height = Math.max(0, bottom - y)
  if (width === 0 || height === 0) {
    return {
      x: Math.min(x, bounds.x + bounds.width),
      y: Math.min(y, bounds.y + bounds.height),
      width: 0,
      height: 0,
    }
  }
  return { x, y, width, height }
}

/** 图片在视口中的 contain-fit 显示矩形（居中）。 */
export function containFit(image: { width: number; height: number }, viewport: { width: number; height: number }): Rect {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height)
  const width = image.width * scale
  const height = image.height * scale
  return { x: (viewport.width - width) / 2, y: (viewport.height - height) / 2, width, height }
}

/** 显示坐标选区 → 原图像素矩形；空/退化返回 null。 */
export function toImageRect(selection: Rect, display: Rect, image: { width: number; height: number }): Rect | null {
  if (display.width <= 0 || display.height <= 0) return null
  const sx = image.width / display.width
  const sy = image.height / display.height
  const x = Math.max(0, Math.round((selection.x - display.x) * sx))
  const y = Math.max(0, Math.round((selection.y - display.y) * sy))
  const width = Math.min(image.width - x, Math.round(selection.width * sx))
  const height = Math.min(image.height - y, Math.round(selection.height * sy))
  if (width < 3 || height < 3) return null
  return { x, y, width, height }
}
