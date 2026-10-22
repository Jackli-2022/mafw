// 编辑器打开请求的跨组件通道（FilesDock → MafwShell → EditorDock）。
// workspace 级模块单例：FilesDock 只表达"请求打开"；实际读取/挂载由 EditorDock 消费。
import { createSignal } from "solid-js"

export interface EditorOpenRequest {
  root: string
  rel: string
}

const [pending, setPending] = createSignal<EditorOpenRequest | null>(null)

/** 待消费的打开请求（Task 5 消费；null = 无）。 */
export function pendingEditorOpen(): EditorOpenRequest | null {
  return pending()
}

/** FilesDock 点击文件时调用（Set 覆盖，同一时刻只有一个待处理请求）。 */
export function requestOpenEditor(root: string, rel: string): void {
  setPending({ root, rel })
}

/** 消费并清空（EditorDock 的 effect 调用）。 */
export function consumeEditorOpen(): EditorOpenRequest | null {
  const p = pending()
  if (p) setPending(null)
  return p
}
