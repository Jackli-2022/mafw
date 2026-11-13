// 会话信息补全判定（2026-10-31）：store.session 的 tab 条目初始只有 `directory: "."`
// 占位；权威 directory 来自 sessions.get。工作台根（benchRoot）与 worktree 徽标
// 依赖真实 directory，激活时需要补一次。
//
// E6-2（F5）：补全同时把权威元数据写进 entity 缓存（Rail/徽标/折叠面板都读 entity）；
// store.session 仍保留给 tab 本地展示。title 不在其中——标题有独立写入口
// （session-title-writer），水合不能覆盖用户改名。
export type SessionInfoLite = { directory?: string } | null | undefined

/** 缺少条目 / 只有 "." 占位 / 缺 directory → 需要补全。 */
export function needsSessionInfoHydration(entry: SessionInfoLite): boolean {
  if (!entry) return true
  return !entry.directory || entry.directory === "."
}

export type SessionInfoEntityFields = {
  id: string
  directory?: string
  projectID?: string
  agent?: string
  parentID?: string
  time?: { created?: number; updated?: number }
}

/** sessions.get 的权威元数据 → entity 缓存字段（不含 title）。 */
export function sessionInfoEntityFields(info: any): SessionInfoEntityFields | null {
  if (!info || typeof info.id !== "string" || !info.id) return null
  const out: SessionInfoEntityFields = { id: info.id }
  if (typeof info.directory === "string") out.directory = info.directory
  if (typeof info.projectID === "string") out.projectID = info.projectID
  if (typeof info.agent === "string") out.agent = info.agent
  if (typeof info.parentID === "string") out.parentID = info.parentID
  if (info.time && (typeof info.time.created === "number" || typeof info.time.updated === "number")) {
    out.time = info.time
  }
  return out
}
