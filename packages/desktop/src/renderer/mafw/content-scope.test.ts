import { test } from "node:test"
import assert from "node:assert/strict"
import {
  contentScopeKey,
  contentScopeLabel,
  contentScopeRoot,
  diffsForContentScope,
  goalContentScope,
  projectContentScope,
  sameContentScope,
  scopeAfterProjectChange,
} from "./content-scope"

test("project scope is the default root and has a stable key", () => {
  const scope = projectContentScope("C:\\work\\app")
  assert.equal(scope?.kind, "project")
  assert.equal(contentScopeRoot(scope), "C:\\work\\app")
  assert.equal(contentScopeLabel(scope), "项目文件")
  assert.equal(contentScopeKey(scope), "project:c:/work/app")
})

test("goal scope requires a project-owned worktree and a positive revision", () => {
  const scope = goalContentScope({
    projectDir: "C:\\work\\app",
    goalId: "g1",
    revision: 2,
    worktreeDir: "C:\\work\\app-wt-goal-g1-r2",
    title: "Fix login",
  })
  assert.ok(scope)
  assert.equal(contentScopeRoot(scope), "C:\\work\\app-wt-goal-g1-r2")
  assert.match(contentScopeLabel(scope), /Fix login/)
  assert.match(contentScopeLabel(scope), /revision 2/)
  assert.doesNotMatch(contentScopeLabel(scope), /g1/)
  assert.equal(goalContentScope({
    projectDir: "C:\\work\\app",
    goalId: "g1",
    revision: 2,
    worktreeDir: "D:\\tmp\\wt",
  }), null)
  assert.equal(goalContentScope({
    projectDir: "C:\\work\\app",
    goalId: "g1",
    revision: 0,
    worktreeDir: "C:\\work\\app-wt-x",
  }), null)
  assert.equal(goalContentScope({
    projectDir: "C:\\work\\app",
    goalId: "g1",
    revision: 1,
    worktreeDir: "C:\\work\\app",
  }), null)
})

test("scope labels never expose an internal goal id when a title is missing", () => {
  const scope = goalContentScope({
    projectDir: "C:\\work\\app",
    goalId: "goal-2026",
    revision: 1,
    worktreeDir: "C:\\work\\app-wt-x",
  })
  assert.ok(scope)
  assert.equal(contentScopeLabel(scope), "Goal revision 1")
})

test("project changes keep a goal scope only inside the same project", () => {
  const scope = goalContentScope({
    projectDir: "C:\\work\\app",
    goalId: "g1",
    revision: 1,
    worktreeDir: "C:\\work\\app-wt-x",
  })
  assert.ok(scope)
  assert.equal(sameContentScope(scope, scopeAfterProjectChange(scope, "C:\\work\\app")), true)
  assert.equal(scopeAfterProjectChange(scope, "D:\\other")?.kind, "project")
  assert.equal(contentScopeKey(projectContentScope("D:\\other")), "project:d:/other")
})

test("inline diffs never cross the content scope", () => {
  const diffs = [{ file: "src/a.ts", patch: "+x" }]
  assert.deepEqual(diffsForContentScope({
    contentRoot: "C:\\work\\app",
    sessionDirectory: "C:\\work\\app",
    diffs,
  }), diffs)
  assert.deepEqual(diffsForContentScope({
    contentRoot: "C:\\work\\app",
    sessionDirectory: "C:\\work\\app-wt-goal-g1-r1",
    diffs,
  }), [])
})
