/**
 * Todo 呈现层（opencode/most agents 的 todo 是"整表替换"语义）。
 *
 * 业界已知 UX 陷阱（opencode #18071 评论）：模型为聚焦子任务重写列表时，
 * 会把仍未完成的相关项从列表里"藏掉"。这里保留一份 per-session 的
 * "已移出计划（未完成）"集合，作为只读提示，不改模型写入的当前列表。
 *
 * 另一个收敛规则：Codex/Gemini 都约束"同时只有一个 in_progress"。模型偶尔
 * 会写多个——展示层只让第一个渲染为运行中，其余降级为 pending（数据不改）。
 */
export type TodoItem = {
  content?: string
  status?: string
  priority?: string
  [k: string]: unknown
}

export const todoKey = (t: TodoItem | null | undefined): string =>
  String(t?.content ?? "").trim()

const UNFINISHED = new Set(["pending", "in_progress"])

export function mergeHiddenTodos(
  hidden: TodoItem[] | null | undefined,
  prev: TodoItem[] | null | undefined,
  next: TodoItem[] | null | undefined,
): TodoItem[] {
  const nextList = Array.isArray(next) ? next : []
  const nextKeys = new Set(nextList.map(todoKey).filter(Boolean))

  // 重新出现在当前列表里的项不再算"被移出"
  const kept = (Array.isArray(hidden) ? hidden : []).filter((h) => {
    const k = todoKey(h)
    return k && !nextKeys.has(k)
  })
  const hiddenKeys = new Set(kept.map(todoKey))

  // 上一版里未完成、这一版消失的项 → 进入提示集合
  for (const t of Array.isArray(prev) ? prev : []) {
    if (!UNFINISHED.has(String(t?.status))) continue
    const k = todoKey(t)
    if (!k || nextKeys.has(k) || hiddenKeys.has(k)) continue
    kept.push(t)
    hiddenKeys.add(k)
  }
  return kept
}

/** 第一个 in_progress 是当前进行项；-1 = 无。 */
export function activeTodoIndex(todos: TodoItem[] | null | undefined): number {
  if (!Array.isArray(todos)) return -1
  return todos.findIndex((t) => String(t?.status) === "in_progress")
}

/** 展示状态：只有第一个 in_progress 保持 running，后续 in_progress 降级为 pending。 */
export function displayStatus(todos: TodoItem[] | null | undefined, index: number): string {
  const status = String(todos?.[index]?.status ?? "pending")
  if (status !== "in_progress") return status
  return index === activeTodoIndex(todos) ? "in_progress" : "pending"
}
