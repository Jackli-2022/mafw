// 窗口内容坐标 → 显示器截图像素矩形（纯函数，无 electron 依赖，可 node 测试）。
export type CaptureRect = { x: number; y: number; width: number; height: number }

/**
 * display/content 均为 DIP；scale 为显示器缩放；rect 为窗口内容区内 CSS px。
 * 越界裁剪；退化（<2px）返回 null。
 */
export function windowRegionToImageRect(input: {
  content: { x: number; y: number }
  display: { x: number; y: number; width: number; height: number }
  scale: number
  rect: CaptureRect
  image: { width: number; height: number }
}): CaptureRect | null {
  const s = input.scale || 1
  const x = Math.round((input.content.x + input.rect.x - input.display.x) * s)
  const y = Math.round((input.content.y + input.rect.y - input.display.y) * s)
  const width = Math.round(input.rect.width * s)
  const height = Math.round(input.rect.height * s)
  const x2 = Math.max(0, Math.min(input.image.width, x + width))
  const y2 = Math.max(0, Math.min(input.image.height, y + height))
  const x1 = Math.max(0, Math.min(input.image.width, x))
  const y1 = Math.max(0, Math.min(input.image.height, y))
  const w = x2 - x1
  const h = y2 - y1
  if (w < 2 || h < 2) return null
  return { x: x1, y: y1, width: w, height: h }
}
