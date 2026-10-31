// 会话信息补全判定（2026-10-31）：store.session 的 tab 条目初始只有 `directory: "."`
// 占位；权威 directory 来自 sessions.get。工作台根（benchRoot）与 worktree 徽标
// 依赖真实 directory，激活时需要补一次。
export type SessionInfoLite = { directory?: string } | null | undefined

/** 缺少条目 / 只有 "." 占位 / 缺 directory → 需要补全。 */
export function needsSessionInfoHydration(entry: SessionInfoLite): boolean {
  if (!entry) return true
  return !entry.directory || entry.directory === "."
}
