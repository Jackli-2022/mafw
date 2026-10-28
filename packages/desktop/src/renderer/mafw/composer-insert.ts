// packages/desktop/src/renderer/mafw/composer-insert.ts
// B2（W5b）：把外部动作（文件选区引用）产生的文本投递到 composer 草稿。
// 模块单例 + Solid signal；ChatPane 订阅后按当前会话取走并追加到输入框。
// 语义：不发送、不落盘（草稿由 session-drafts 随输入变化持久化）。
import { createSignal } from "solid-js"

interface PendingInsert {
  sid: string
  text: string
}

const [pendingInserts, setPendingInserts] = createSignal<PendingInsert[]>([])

/** chat 订阅用：任何插入都会 bump 本 signal。 */
export { pendingInserts }

export function pushComposerInsert(sessionID: string, text: string): void {
  const sid = (sessionID ?? "").trim()
  const body = (text ?? "").trim()
  if (!sid || !body) return
  setPendingInserts((prev) => [...prev, { sid, text: body }])
}

/** 取走当前会话的第一条（FIFO）；无则 null。 */
export function takeComposerInsert(sessionID: string): string | null {
  const sid = (sessionID ?? "").trim()
  if (!sid) return null
  const list = pendingInserts()
  const idx = list.findIndex((x) => x.sid === sid)
  if (idx < 0) return null
  const item = list[idx]
  setPendingInserts((prev) => prev.filter((_, i) => i !== idx))
  return item.text
}

/** 测试隔离。 */
export function resetComposerInsertsForTest(): void {
  setPendingInserts([])
}
