// Pending captures（G1 截屏批注 / G2 元素点选）：composer 上方的待发草稿。
// 与代码批注（annotation-store）同型：内存态、发送时打包进消息、take 即清空。
// 图片本体在捕获时进 attachments（走既有媒体管道）；这里存缩略图与评注。
import { createSignal } from "solid-js"

export type PendingCaptureMeta = {
  tag?: string
  selector?: string
  text?: string
  rect?: { x: number; y: number; width: number; height: number }
  outerHTML?: string
  attrs?: Record<string, string>
}

export type PendingCapture = {
  id: string
  sessionID: string
  kind: "screenshot" | "element"
  comment: string
  /** 缩略图 dataUrl（列表展示用；发送走 attachments 的媒体指针）。 */
  dataUrl: string
  createdAt: number
  meta?: PendingCaptureMeta
}

export function createPendingCaptureStore() {
  const [bySession, setBySession] = createSignal<Record<string, PendingCapture[]>>({})
  let seq = 0

  const pendingFor = (sessionID: string | null): PendingCapture[] =>
    (sessionID ? bySession()[sessionID] : undefined) ?? []

  const add = (input: Omit<PendingCapture, "id" | "createdAt">): PendingCapture => {
    const item: PendingCapture = { ...input, id: `cap-${Date.now()}-${++seq}`, createdAt: Date.now() }
    setBySession(prev => ({ ...prev, [item.sessionID]: [...(prev[item.sessionID] ?? []), item] }))
    return item
  }

  const updateComment = (sessionID: string, id: string, comment: string) => {
    setBySession(prev => ({
      ...prev,
      [sessionID]: (prev[sessionID] ?? []).map(x => (x.id === id ? { ...x, comment } : x)),
    }))
  }

  const remove = (sessionID: string, id: string) => {
    setBySession(prev => ({ ...prev, [sessionID]: (prev[sessionID] ?? []).filter(x => x.id !== id) }))
  }

  const clear = (sessionID: string) => {
    setBySession(prev => ({ ...prev, [sessionID]: [] }))
  }

  /** 发送即消耗：返回当前草稿并清空。 */
  const take = (sessionID: string): PendingCapture[] => {
    const items = bySession()[sessionID] ?? []
    if (items.length > 0) clear(sessionID)
    return items
  }

  return { pendingFor, add, updateComment, remove, clear, take }
}

let singleton: ReturnType<typeof createPendingCaptureStore> | null = null
export function getPendingCaptures(): ReturnType<typeof createPendingCaptureStore> {
  if (!singleton) singleton = createPendingCaptureStore()
  return singleton
}

/** 打包为消息文本块（与 buildAnnotationBatch 同风格）。 */
export function formatCaptureBatch(items: PendingCapture[]): string {
  const lines = items.map((c, i) => {
    const no = i + 1
    const comment = c.comment.trim() || "（无评注）"
    if (c.kind === "element") {
      const label = [c.meta?.tag, c.meta?.selector].filter(Boolean).join(" ") || "元素"
      const text = c.meta?.text ? `「${c.meta.text}」` : ""
      const attrs = c.meta?.attrs
        ? Object.entries(c.meta.attrs).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(" ")
        : ""
      return `【元素点选 ${no}】${label}${text} — ${comment}${attrs ? `\n  ${attrs}` : ""}`
    }
    return `【截屏批注 ${no}】${comment}`
  })
  return lines.join("\n")
}

/** capture 附件名（带 id，删除 capture 时联动移除附件）。 */
export function captureAttachmentName(id: string): string {
  return `capture-${id}.png`
}
