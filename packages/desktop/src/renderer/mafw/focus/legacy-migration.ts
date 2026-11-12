// 把旧的 content scope 状态迁移成焦点栈：只做纯转换，不读存储。
import {
  createWorkbenchState,
  keepSubject,
  openSubject,
  updatePlace,
  type Place,
  type Scope,
  type WorkbenchState,
} from "./focus-model"
import type { ContentScopeState } from "../content-scope-state"
import {
  contentScopeKey,
  contentScopeRoot,
  goalContentScope,
  projectContentScope,
  type ContentScope,
} from "../content-scope"

export function migrateContentScopeState(input: {
  worldId: string
  root: string
  scope: Scope
  state: ContentScopeState
}): WorkbenchState {
  const active = input.state.activeFile
  if (!active) return createWorkbenchState(input.worldId)

  let next = openSubject(
    createWorkbenchState(input.worldId),
    input.scope,
    { kind: "file", root: input.root, rel: active },
    "read",
  )

  const place: Place = {}
  const scroll = input.state.readingPositions[active]
  if (scroll !== undefined) place.scroll = scroll
  const selection = input.state.selections[active]
  if (selection) place.selection = { anchor: selection.anchor, head: selection.head }
  if (place.scroll !== undefined || place.selection) next = updatePlace(next, place)

  for (const rel of input.state.openFiles) {
    next = keepSubject(next, { kind: "file", root: input.root, rel })
  }

  return next
}

/** 退役的 `mafw-content-scope:<project>` 键（与旧持久化模块同一算法）。 */
export function retiredContentScopeKey(projectDir: string): string {
  const normalized = projectDir.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
  return `mafw-content-scope:${normalized}`
}

/** 读取旧 scope 键并迁移成焦点栈；坏 JSON / 非法 scope 返回 null。 */
export function migrateLegacyContentScope(input: {
  worldId: string
  projectDir: string
  rawScope: string | null
  readState: (scopeKey: string) => ContentScopeState
}): WorkbenchState | null {
  if (!input.rawScope) return null
  let parsed: Record<string, unknown>
  try {
    const value = JSON.parse(input.rawScope)
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    parsed = value as Record<string, unknown>
  } catch {
    return null
  }

  let scope: ContentScope | null = null
  if (parsed.kind === "project") {
    scope = projectContentScope(input.projectDir)
  } else if (parsed.kind === "goal") {
    if (typeof parsed.goalId !== "string"
      || typeof parsed.revision !== "number"
      || typeof parsed.worktreeDir !== "string") return null
    scope = goalContentScope({
      projectDir: input.projectDir,
      goalId: parsed.goalId,
      revision: parsed.revision,
      worktreeDir: parsed.worktreeDir,
      title: typeof parsed.title === "string" ? parsed.title : null,
    })
  }
  if (!scope) return null

  const key = contentScopeKey(scope)
  if (!key) return null
  const focusScope: Scope = scope.kind === "project"
    ? { kind: "world", worldId: scope.projectDir }
    : {
        kind: "goal",
        worldId: scope.projectDir,
        goalId: scope.goalId,
        revision: scope.revision,
        worktreeDir: scope.worktreeDir,
      }
  return migrateContentScopeState({
    worldId: input.worldId,
    root: contentScopeRoot(scope) ?? input.projectDir,
    scope: focusScope,
    state: input.readState(key),
  })
}
