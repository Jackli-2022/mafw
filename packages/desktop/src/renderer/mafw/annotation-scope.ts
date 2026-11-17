// Annotation ownership is derived from the captured source scope, never from
// the currently active chat tab. The owner key only decides which local bucket
// stores drafts; the source object is the immutable provenance used later for
// discussion or Goal delegation.
import type { Annotation, AnnotationSource } from "../../shared/annotation-types"

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

export function draftOwnerKey(
  sessionID: string | null | undefined,
  scopeKey: string | null | undefined,
): string {
  const sid = clean(sessionID)
  if (sid) return sid
  const scope = clean(scopeKey)
  return scope ? `draft:${scope}` : "draft:unscoped"
}

export function annotationSourceFromScopeKey(
  scopeKey: string | null | undefined,
  root: string | null | undefined,
): AnnotationSource | null {
  const key = clean(scopeKey)
  const fileRoot = clean(root)
  if (!key || !fileRoot) return null
  if (key.startsWith("project:")) {
    return { kind: "project", projectDir: fileRoot }
  }
  // Windows drive colons mean projectDir must be captured greedily; Goal IDs
  // and the revision marker are the last two path-like segments.
  const goal = key.match(/^goal:(.+):([^:]+):r(\d+)$/)
  if (!goal) return null
  const revision = Number(goal[3])
  if (!Number.isInteger(revision) || revision < 1) return null
  return {
    kind: "goal",
    projectDir: goal[1],
    goalId: goal[2],
    revision,
  }
}

export function goalChangeSetAnnotationScope(input: {
  projectDir: string
  goalId: string
  revision: number
  root: string | null
}): { source: AnnotationSource; scopeKey: string; root: string | null } {
  return {
    source: {
      kind: "goal",
      projectDir: input.projectDir,
      goalId: input.goalId,
      revision: input.revision,
    },
    scopeKey: `goal:${normalizePath(input.projectDir)}:${input.goalId}:r${input.revision}`,
    root: input.root,
  }
}

export function annotationInScope(
  annotation: Annotation,
  scopeKey: string | null | undefined,
  root: string | null | undefined,
): boolean {
  const scope = clean(scopeKey)
  const fileRoot = clean(root)
  const sourceScope = clean(annotation.scopeKey)
  // Legacy rows without scope cannot be safely attached to a Goal worktree;
  // keep them visible only in the project conversation.
  if (!sourceScope) return !!scope && !scope.startsWith("goal:")
  if (!scope) return false
  if (normalizePath(sourceScope) !== normalizePath(scope)) return false
  const annotationRoot = clean(annotation.root)
  if (annotationRoot && fileRoot && normalizePath(annotationRoot) !== normalizePath(fileRoot)) return false
  return true
}
