import { describe, expect, test } from "bun:test"
import {
  annotationInScope,
  annotationsVisibleInChat,
  annotationSourceFromScopeKey,
  draftOwnerKey,
  goalChangeSetAnnotationScope,
  projectChangeSetAnnotationScope,
} from "./annotation-scope"
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

  test("goal change-set annotations carry goal source and normalized scope", () => {
    expect(goalChangeSetAnnotationScope({
      projectDir: "C:\\Repo",
      goalId: "g1",
      revision: 2,
      root: "C:\\worktrees\\g1-r2",
    })).toEqual({
      source: { kind: "goal", projectDir: "C:\\Repo", goalId: "g1", revision: 2 },
      scopeKey: "goal:c:/repo:g1:r2",
      root: "C:\\worktrees\\g1-r2",
    })
  })

  test("Goal B drafts are hidden from a Goal A Tech Lead composer", () => {
    const goalB = annotation({
      id: "goal-b",
      scopeKey: "goal:C:/repo:g2:r2",
      root: "C:/worktrees/g2-r2",
      source: { kind: "goal", projectDir: "C:/repo", goalId: "g2", revision: 2 },
    })
    expect(annotationsVisibleInChat([goalB], {
      scopeKey: "goal:C:/repo:g2:r2",
      root: "C:/worktrees/g2-r2",
      chatKind: "techlead",
      chatGoalId: "g1",
    })).toEqual([])
    expect(annotationsVisibleInChat([goalB], {
      scopeKey: "goal:C:/repo:g2:r2",
      root: "C:/worktrees/g2-r2",
      chatKind: "techlead",
      chatGoalId: "g2",
    })).toHaveLength(1)
  })

  test("session change-set annotations carry a project source and root", () => {
    expect(projectChangeSetAnnotationScope({ projectDir: "C:\\Repo", root: null })).toEqual({
      source: { kind: "project", projectDir: "C:\\Repo" },
      scopeKey: "project:c:/repo",
      root: "C:\\Repo",
    })
    expect(projectChangeSetAnnotationScope({
      projectDir: "C:/Repo",
      root: "C:/Repo-worktree",
    }).root).toBe("C:/Repo-worktree")
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
