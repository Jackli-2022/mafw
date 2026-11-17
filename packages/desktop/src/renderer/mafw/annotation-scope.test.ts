import { describe, expect, test } from "bun:test"
import { annotationInScope, annotationSourceFromScopeKey, draftOwnerKey } from "./annotation-scope"
import type { Annotation } from "../../shared/annotation-types"

const annotation = (over: Partial<Annotation> = {}): Annotation => ({
  id: "ann-1",
  sessionID: "s1",
  rel: "a.ts",
  startLine: 1,
  endLine: 1,
  code: "x",
  comment: "note",
  createdAt: 1,
  ...over,
})

describe("annotation scope", () => {
  test("draft owner and source never depend on the active chat tab", () => {
    expect(draftOwnerKey(null, "goal:C:/repo:g2:r1")).toBe("draft:goal:C:/repo:g2:r1")
    expect(draftOwnerKey("ses-1", "goal:C:/repo:g2:r1")).toBe("ses-1")
    expect(annotationSourceFromScopeKey("project:C:/repo", "C:/repo")).toEqual({
      kind: "project",
      projectDir: "C:/repo",
    })
    expect(annotationSourceFromScopeKey("goal:C:/repo:g2:r2", "C:/worktrees/g2-r2")).toEqual({
      kind: "goal",
      projectDir: "C:/repo",
      goalId: "g2",
      revision: 2,
    })
  })

  test("scope matching keeps project and Goal revisions distinct", () => {
    const project = annotation({ scopeKey: "project:C:/repo", root: "C:/repo" })
    const goal = annotation({
      id: "ann-2",
      scopeKey: "goal:C:/repo:g2:r2",
      root: "C:/worktrees/g2-r2",
    })
    expect(annotationInScope(project, "project:C:/repo", "C:/repo")).toBe(true)
    expect(annotationInScope(goal, "project:C:/repo", "C:/repo")).toBe(false)
    expect(annotationInScope(goal, "goal:C:/repo:g2:r2", "C:/worktrees/g2-r2")).toBe(true)
    expect(annotationInScope(goal, "goal:C:/repo:g2:r1", "C:/worktrees/g2-r1")).toBe(false)
  })

  test("legacy scope-less drafts stay project-only", () => {
    const legacy = annotation({ id: "ann-legacy" })
    expect(annotationInScope(legacy, "project:C:/repo", "C:/repo")).toBe(true)
    expect(annotationInScope(legacy, "goal:C:/repo:g2:r2", "C:/worktrees/g2-r2")).toBe(false)
  })

  test("reserved review actions do not alter owner identity", () => {
    const goal = annotation({
      id: "ann-3",
      scopeKey: "goal:C:/repo:g2:r2",
      root: "C:/worktrees/g2-r2",
      discussedAt: 5,
    })
    expect(draftOwnerKey(goal.sessionID, goal.scopeKey)).toBe("s1")
  })
})
