// 内容工作台的作用域：项目主目录（默认）或某个 Goal revision 的 worktree。
// 这个模型不读取会话、store 或 SDK；它只回答“当前内容根是什么、属于谁”。
export type ProjectContentScope = { kind: "project"; projectDir: string }

export type GoalContentScope = {
  kind: "goal"
  projectDir: string
  goalId: string
  revision: number
  worktreeDir: string
  title: string | null
}

export type ContentScope = ProjectContentScope | GoalContentScope

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

/** 只用于比较与 key；显示/访问仍使用调用方传入的原始路径。 */
function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

function isWorktreeOfProject(projectDir: string, worktreeDir: string): boolean {
  const project = normalizePath(projectDir)
  const worktree = normalizePath(worktreeDir)
  if (!project || !worktree || worktree === project) return false
  return worktree.startsWith(`${project}/`) || worktree.startsWith(`${project}-wt-`)
}

export function projectContentScope(
  projectDir: string | null | undefined,
): ProjectContentScope | null {
  const dir = clean(projectDir)
  return dir ? { kind: "project", projectDir: dir } : null
}

export function goalContentScope(input: {
  projectDir: string | null | undefined
  goalId: string
  revision: number
  worktreeDir: string | null | undefined
  title?: string | null
}): GoalContentScope | null {
  const projectDir = clean(input.projectDir)
  const goalId = clean(input.goalId)
  const worktreeDir = clean(input.worktreeDir)
  const revision = Number.isInteger(input.revision) ? input.revision : 0
  if (!projectDir || !goalId || !worktreeDir || revision <= 0) return null
  if (!isWorktreeOfProject(projectDir, worktreeDir)) return null
  const title = clean(input.title)
  return {
    kind: "goal",
    projectDir,
    goalId,
    revision,
    worktreeDir,
    title: title || null,
  }
}

export function isGoalContentScope(
  scope: ContentScope | null | undefined,
): scope is GoalContentScope {
  return scope?.kind === "goal"
}

export function contentScopeRoot(scope: ContentScope | null | undefined): string | null {
  if (!scope) return null
  return scope.kind === "project" ? scope.projectDir : scope.worktreeDir
}

export function contentScopeKey(scope: ContentScope | null | undefined): string | null {
  if (!scope) return null
  const project = normalizePath(scope.projectDir)
  if (scope.kind === "project") return `project:${project}`
  return `goal:${project}:${scope.goalId}:r${scope.revision}`
}

export function contentScopeLabel(scope: ContentScope | null | undefined): string {
  if (!scope) return "未选择项目"
  if (scope.kind === "project") return "项目文件"
  return scope.title
    ? `Goal · ${scope.title} · revision ${scope.revision}`
    : `Goal revision ${scope.revision}`
}

export function sameContentScope(
  a: ContentScope | null | undefined,
  b: ContentScope | null | undefined,
): boolean {
  if (!a || !b) return a === b
  if (a.kind !== b.kind) return false
  if (normalizePath(a.projectDir) !== normalizePath(b.projectDir)) return false
  if (a.kind === "project" && b.kind === "project") return true
  if (a.kind !== "goal" || b.kind !== "goal") return false
  return a.goalId === b.goalId
    && a.revision === b.revision
    && normalizePath(a.worktreeDir) === normalizePath(b.worktreeDir)
}

export function scopeAfterProjectChange(
  scope: ContentScope | null,
  projectDir: string | null,
): ContentScope | null {
  const dir = clean(projectDir)
  if (!dir) return null
  if (scope?.kind === "goal" && normalizePath(scope.projectDir) === normalizePath(dir)) {
    return scope
  }
  return projectContentScope(dir)
}

/** A scope (project or its Goal worktree) may only be restored for its own project. */
export function contentScopeBelongsToProject(
  scope: ContentScope | null | undefined,
  projectDir: string | null | undefined,
): boolean {
  const dir = clean(projectDir)
  if (!scope || !dir) return false
  return normalizePath(scope.projectDir) === normalizePath(dir)
}

/** Inline diffs come from the active session; only show them when that session
 *  is looking at the same root as the content workbench. */
export function diffsForContentScope<T>(input: {
  contentRoot: string | null
  sessionDirectory: string | null
  diffs: readonly T[]
}): T[] {
  if (!input.contentRoot || !input.sessionDirectory) return []
  if (normalizePath(input.contentRoot) !== normalizePath(input.sessionDirectory)) return []
  return input.diffs.slice()
}
