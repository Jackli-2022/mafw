// 最后内容 scope 持久化：按项目隔离，应用重启/切项目回来后恢复。
// 只存 scope 身份，不存树/编辑器状态（那些是会话内状态）。
import {
  contentScopeBelongsToProject,
  goalContentScope,
  projectContentScope,
  type ContentScope,
} from "./content-scope"

export type ContentScopeStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

const PREFIX = "mafw-content-scope:"

function normalize(projectDir: string): string {
  return projectDir.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

export function contentScopeStorageKey(projectDir: string): string {
  return `${PREFIX}${normalize(projectDir)}`
}

type PersistedScope = {
  kind?: unknown
  projectDir?: unknown
  goalId?: unknown
  revision?: unknown
  worktreeDir?: unknown
  title?: unknown
}

export function readPersistedContentScope(
  projectDir: string | null | undefined,
  storage: ContentScopeStorage,
): ContentScope | null {
  if (!projectDir) return null
  let raw: string | null = null
  try {
    raw = storage.getItem(contentScopeStorageKey(projectDir))
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: PersistedScope
  try {
    parsed = JSON.parse(raw) as PersistedScope
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  if (parsed.kind === "project") {
    const saved = typeof parsed.projectDir === "string" ? parsed.projectDir : projectDir
    const scope = projectContentScope(saved)
    return scope && contentScopeBelongsToProject(scope, projectDir) ? scope : null
  }
  if (parsed.kind !== "goal") return null
  if (typeof parsed.goalId !== "string" || typeof parsed.worktreeDir !== "string") return null
  if (typeof parsed.revision !== "number") return null
  const scope = goalContentScope({
    projectDir,
    goalId: parsed.goalId,
    revision: parsed.revision,
    worktreeDir: parsed.worktreeDir,
    title: typeof parsed.title === "string" ? parsed.title : null,
  })
  if (!scope || !contentScopeBelongsToProject(scope, projectDir)) return null
  return scope
}

export function persistContentScope(
  scope: ContentScope | null | undefined,
  storage: ContentScopeStorage,
): void {
  if (!scope) return
  const payload = scope.kind === "project"
    ? { kind: "project" as const, projectDir: scope.projectDir }
    : {
        kind: "goal" as const,
        goalId: scope.goalId,
        revision: scope.revision,
        worktreeDir: scope.worktreeDir,
        title: scope.title,
      }
  try {
    storage.setItem(contentScopeStorageKey(scope.projectDir), JSON.stringify(payload))
  } catch { /* storage full/unavailable */ }
}
