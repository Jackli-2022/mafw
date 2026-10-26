// ScreenshotCropper：G1 截屏裁剪浮层（整屏图 → 拖拽框选 → 生成裁剪图）。
// 纯坐标换算在 ../capture/crop-math.ts；本组件只做交互与 canvas 裁剪。
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { clampRect, containFit, normalizeDrag, toImageRect, type Rect } from "../capture/crop-math"

export type CaptureShot = { dataUrl: string; width: number; height: number }

export function ScreenshotCropper(props: {
  shot: CaptureShot
  onCancel: () => void
  onConfirm: (dataUrl: string) => void
}) {
  let host: HTMLDivElement | undefined
  const [viewport, setViewport] = createSignal({ width: 0, height: 0 })
  const [sel, setSel] = createSignal<Rect | null>(null)
  const [busy, setBusy] = createSignal(false)
  let startPoint: { x: number; y: number } | null = null

  const display = () => containFit({ width: props.shot.width, height: props.shot.height }, viewport())

  const measure = () => {
    if (!host) return
    setViewport({ width: host.clientWidth, height: host.clientHeight })
  }

  const pointOf = (e: PointerEvent) => {
    const r = host!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onDown = (e: PointerEvent) => {
    if (!host) return
    const p = pointOf(e)
    const d = display()
    if (p.x < d.x || p.y < d.y || p.x > d.x + d.width || p.y > d.y + d.height) return
    startPoint = p
    setSel({ x: p.x, y: p.y, width: 0, height: 0 })
    try { host.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  const onMove = (e: PointerEvent) => {
    if (!startPoint) return
    const p = pointOf(e)
    setSel(clampRect(normalizeDrag(startPoint, p), display()))
  }

  const onUp = () => {
    startPoint = null
    const s = sel()
    if (s && (s.width < 3 || s.height < 3)) setSel(null)
  }

  const confirm = async () => {
    const s = sel()
    if (!s || busy()) return
    setBusy(true)
    try {
      const img = new Image()
      img.src = props.shot.dataUrl
      await img.decode()
      const r = toImageRect(s, display(), { width: img.naturalWidth, height: img.naturalHeight })
      if (!r) { setBusy(false); return }
      const canvas = document.createElement("canvas")
      canvas.width = r.width
      canvas.height = r.height
      const ctx = canvas.getContext("2d")
      if (!ctx) { setBusy(false); return }
      ctx.drawImage(img, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height)
      props.onConfirm(canvas.toDataURL("image/png"))
    } finally {
      setBusy(false)
    }
  }

  onMount(() => {
    measure()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onCancel() }
    window.addEventListener("resize", measure)
    window.addEventListener("keydown", onKey)
    onCleanup(() => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("keydown", onKey)
    })
  })

  return (
    <div
      class="mafw-shot-crop"
      ref={host}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <img
        class="mafw-shot-crop-img"
        src={props.shot.dataUrl}
        style={{
          left: `${display().x}px`,
          top: `${display().y}px`,
          width: `${display().width}px`,
          height: `${display().height}px`,
        }}
        alt=""
        draggable={false}
      />
      <Show when={sel()}>
        {(s) => (
          <div
            class="mafw-shot-crop-sel"
            style={{
              left: `${s().x}px`,
              top: `${s().y}px`,
              width: `${s().width}px`,
              height: `${s().height}px`,
            }}
          />
        )}
      </Show>
      <div class="mafw-shot-crop-bar">
        <span>{sel() ? "松手后可点「使用截图」；Esc 取消" : "拖拽框选要发送的区域 · Esc 取消"}</span>
        <ButtonV2 variant="ghost" size="small" onClick={() => props.onCancel()}>取消</ButtonV2>
        <ButtonV2 variant="contrast" size="small" disabled={!sel() || busy()} onClick={() => void confirm()}>
          {busy() ? "处理中…" : "使用截图"}
        </ButtonV2>
      </div>
    </div>
  )
}
