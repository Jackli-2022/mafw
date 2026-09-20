// 历史分页的 user-turn 预算判定（纯函数）。
// 根因背景：cursor 分页按原始消息条数计（100/页），assistant 密集会话
// （自治长跑 10:1）首窗可能 0~4 个 user turn → 打开会话只见「加载更早」
// 按钮的空窗（"内容静默不可见"预算饥饿族，同 NotesDock 截断）。
// 终解方向（mem_1789616908701）：分页按 user turn 补齐——取页循环直到
// 窗口内 user turn ≥ target，或 cursor 耗尽 / 页数封顶。

export function countUserTurns(msgs: { role?: string }[]): number {
  let n = 0
  for (const m of msgs) if (m?.role === "user") n++
  return n
}

export function shouldKeepPaging(opts: {
  collected: number
  target: number
  nextCursor: string | null
  pageCount: number
  maxPages: number
}): boolean {
  if (opts.collected >= opts.target) return false
  if (!opts.nextCursor) return false
  return opts.pageCount < opts.maxPages
}
