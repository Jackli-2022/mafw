// 最近内容：项目首页的“最近打开”列表。按项目持久化，跨重启恢复。
// 只记录内容 scope 内的文件打开；Goal revision 条目留给后续意图视图过滤。
export type RecentContentEntry = {
  rel: string
  scopeKey: string
  scopeKind: "project" | "goal"
  scopeLabel: string
  at: number
  /** Goal revision 最近项：重新打开时校验 worktree 并恢复该 revision scope。 */
  goalId?: string
  revision?: number
  worktreeDir?: string
}

export type RecentContentStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const MAX_RECENT_CONTENT = 8

const PREFIX = "mafw-recent-content:"

function normalize(projectDir: string): string {
  return projectDir.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

export function recentContentStorageKey(projectDir: string): string {
  return `${PREFIX}${normalize(projectDir)}`
}

function isEntry(value: unknown): value is RecentContentEntry {
  if (!value || typeof value !== "object") return false
  const entry = value as Record<string, unknown>
  const base = (
    typeof entry.rel === "string" && entry.rel.length > 0
    && typeof entry.scopeKey === "string" && entry.scopeKey.length > 0
    && (entry.scopeKind === "project" || entry.scopeKind === "goal")
    && typeof entry.scopeLabel === "string"
    && typeof entry.at === "number" && Number.isFinite(entry.at)
  )
  if (!base) return false
  if (entry.goalId !== undefined && typeof entry.goalId !== "string") return false
  if (entry.revision !== undefined && (typeof entry.revision !== "number" || !Number.isFinite(entry.revision))) return false
  if (entry.worktreeDir !== undefined && typeof entry.worktreeDir !== "string") return false
  return true
}

export function parseRecentContent(raw: string | null): RecentContentEntry[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter(isEntry).slice(0, MAX_RECENT_CONTENT).map((entry) => ({ ...entry }))
}

export function pushRecentContent(
  list: readonly RecentContentEntry[],
  entry: RecentContentEntry,
  max: number = MAX_RECENT_CONTENT,
): RecentContentEntry[] {
  if (max <= 0) return []
  const key = `${entry.scopeKey}\0${entry.rel}`
  const rest = list.filter((item) => `${item.scopeKey}\0${item.rel}` !== key)
  return [{ ...entry }, ...rest].slice(0, max)
}

export function readRecentContent(
  projectDir: string | null | undefined,
  storage: RecentContentStorage,
): RecentContentEntry[] {
  if (!projectDir) return []
  try {
    return parseRecentContent(storage.getItem(recentContentStorageKey(projectDir)))
  } catch {
    return []
  }
}

export function recordRecentContent(
  projectDir: string | null | undefined,
  entry: RecentContentEntry,
  storage: RecentContentStorage,
): RecentContentEntry[] {
  if (!projectDir) return []
  const next = pushRecentContent(readRecentContent(projectDir, storage), entry)
  try {
    storage.setItem(recentContentStorageKey(projectDir), JSON.stringify(next))
  } catch {
    /* storage blocked — keep the in-session list */
  }
  return next
}

/** 最近内容列表展示：拆出目录与文件名，名称在前、路径在后。 */
export function splitRelPath(rel: string): { dir: string; name: string } {
  const normalized = rel.replace(/\\/g, "/")
  const index = normalized.lastIndexOf("/")
  if (index < 0) return { dir: "", name: normalized }
  return { dir: normalized.slice(0, index), name: normalized.slice(index + 1) }
}
