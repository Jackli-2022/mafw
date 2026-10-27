// 图片拖框批注纯逻辑 + 裁剪（spec 2026-10-27 预览批注 A4）：
// px 拖框 → 归一化矩形；归一化矩形 → 原图像素裁剪盒；canvas 裁剪为 dataURL。
export type Rect01 = { x: number; y: number; w: number; h: number }
export type PxRect = { left: number; top: number; w: number; h: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** 拖拽两点 → 图片盒内 px 矩形；小于 minPx 视为误触。 */
export function dragRectPx(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  boxW: number,
  boxH: number,
  minPx = 8,
): PxRect | null {
  if (boxW <= 0 || boxH <= 0) return null
  const left = clamp(Math.min(x0, x1), 0, boxW)
  const top = clamp(Math.min(y0, y1), 0, boxH)
  const w = clamp(Math.abs(x1 - x0), 0, boxW - left)
  const h = clamp(Math.abs(y1 - y0), 0, boxH - top)
  if (w < minPx || h < minPx) return null
  return { left, top, w, h }
}

/** 归一化矩形 → 原图像素裁剪盒（round + clamp，最小 1px）。 */
export function cropBox(rect: Rect01, natW: number, natH: number): { sx: number; sy: number; sw: number; sh: number } {
  const sx = clamp(Math.round(rect.x * natW), 0, Math.max(0, natW - 1))
  const sy = clamp(Math.round(rect.y * natH), 0, Math.max(0, natH - 1))
  const sw = Math.max(1, Math.min(Math.round(rect.w * natW), natW - sx))
  const sh = Math.max(1, Math.min(Math.round(rect.h * natH), natH - sy))
  return { sx, sy, sw, sh }
}

/** canvas 裁剪为 PNG dataURL（图片须 crossOrigin=anonymous 且协议带 ACAO，否则 canvas 被污染）。 */
export async function cropImageDataUrl(img: HTMLImageElement, rect: Rect01): Promise<string> {
  const natW = img.naturalWidth
  const natH = img.naturalHeight
  if (!natW || !natH) throw new Error("图片尚未加载")
  const { sx, sy, sw, sh } = cropBox(rect, natW, natH)
  const canvas = document.createElement("canvas")
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("canvas 不可用")
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  return canvas.toDataURL("image/png")
}
