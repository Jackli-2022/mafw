// G1 截屏：捕获当前显示器整屏（desktopCapturer），裁剪在 renderer 的裁剪浮层完成。
// spec 2026-10-26-workbench-merge-design §G1（轻版：框选即标注 + 侧车文字评注）。
// 取舍：不做每屏 BrowserWindow 遮罩（多 preload/DPI 面），仍走真实整屏捕获——
// 「app 外内容可截」成立；Wayland 等平台失败返回 null，renderer toast 降级。
import { BrowserWindow, desktopCapturer, ipcMain, screen, type IpcMain } from "electron"
import { windowRegionToImageRect, type CaptureRect } from "./window-region"

export type CaptureShot = { dataUrl: string; width: number; height: number }

/** 捕获窗口内容区内的指定区域（G2 元素截图；走 desktopCapturer，绕开 guest capturePage 悬挂）。 */
export async function captureWindowRegion(win: BrowserWindow | null, rect: CaptureRect): Promise<CaptureShot | null> {
  if (!win) return null
  try {
    const content = win.getContentBounds()
    const display = screen.getDisplayMatching(content)
    const scale = display.scaleFactor || 1
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.max(1, Math.round(display.bounds.width * scale)),
        height: Math.max(1, Math.round(display.bounds.height * scale)),
      },
    })
    if (!sources.length) return null
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    const thumb = source.thumbnail
    const size = thumb.getSize()
    const crop = windowRegionToImageRect({ content, display: display.bounds, scale, rect, image: size })
    if (!crop) return null
    const img = thumb.crop(crop)
    return { dataUrl: img.toDataURL(), width: crop.width, height: crop.height }
  } catch {
    return null
  }
}

/** 捕获窗口所在显示器的整屏（按 scaleFactor 取原生像素）。 */
export async function captureScreenForWindow(win: BrowserWindow | null): Promise<CaptureShot | null> {
  try {
    const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()
    const scale = display.scaleFactor || 1
    const width = Math.max(1, Math.round(display.bounds.width * scale))
    const height = Math.max(1, Math.round(display.bounds.height * scale))
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } })
    if (!sources.length) return null
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    const img = source.thumbnail
    const size = img.getSize()
    if (!size.width || !size.height) return null
    return { dataUrl: img.toDataURL(), width: size.width, height: size.height }
  } catch {
    return null
  }
}

export function installCaptureIpc(ipc: Pick<IpcMain, "handle">): void {
  ipc.handle("mafw-capture-start", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return captureScreenForWindow(win)
  })
  // G2 元素截图：窗口内容区矩形（CSS px）→ 屏幕捕获裁剪（绕开 guest capturePage 悬挂）
  ipc.handle("mafw-capture-window-region", async (event, args: { rect: CaptureRect }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return captureWindowRegion(win, args.rect)
  })
}
