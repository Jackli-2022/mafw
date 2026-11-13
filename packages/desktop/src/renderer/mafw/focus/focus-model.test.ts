import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createWorkbenchState,
  defaultLensFor,
  isLensApplicable,
  jumpTo,
  keepSubject,
  lensesFor,
  openSubject,
  popFocus,
  replaceLens,
  sameSubject,
  selectFocus,
  subjectKey,
  unkeepSubject,
  updatePlace,
  type Scope,
  type SubjectRef,
} from "./focus-model"

const worldScope: Scope = { kind: "world", worldId: "w1" }
const goalScope: Scope = {
  kind: "goal",
  worldId: "w1",
  goalId: "g1",
  revision: 3,
  worktreeDir: "C:/repo-wt",
}
const file: SubjectRef = { kind: "file", root: "C:/repo", rel: "src/a.ts" }
const file2: SubjectRef = { kind: "file", root: "C:/repo", rel: "src/b.ts" }

test("openSubject pushes a new focus and defaults to the subject lens", () => {
  const state = createWorkbenchState("w1")
  assert.equal(state.stack.length, 0)
  assert.equal(state.kept.length, 0)

  const next = openSubject(state, worldScope, file)
  assert.equal(next.stack.length, 1)
  assert.equal(next.stack[0]!.lens, "read")
  assert.equal(next.stack[0]!.scope.kind, "world")
  assert.equal(next.stack[0]!.place.scroll, undefined)
  assert.equal(next.stack[0]!.place.selection, undefined)
})

test("opening the same subject replaces lens and place instead of pushing", () => {
  let state = openSubject(createWorkbenchState("w1"), worldScope, file)
  state = updatePlace(state, { scroll: 120, selection: { anchor: 1, head: 4 } })

  const same = openSubject(state, worldScope, file, "changes")
  assert.equal(same.stack.length, 1)
  assert.equal(same.stack[0]!.lens, "changes")
  assert.equal(same.stack[0]!.place.scroll, 120)
  assert.deepEqual(same.stack[0]!.place.selection, { anchor: 1, head: 4 })
})

test("selectFocus moves an existing subject to the top without duplicating", () => {
  const world: SubjectRef = { kind: "world" }
  const web: SubjectRef = { kind: "web", url: "https://example.com" }
  let state = openSubject(createWorkbenchState("w1"), worldScope, world)
  state = openSubject(state, worldScope, file)
  state = openSubject(state, worldScope, web)

  const next = selectFocus(state, worldScope, file)

  assert.deepEqual(next.stack.map((focus) => subjectKey(focus.subject)), [
    subjectKey(world),
    subjectKey(web),
    subjectKey(file),
  ])
  assert.equal(next.stack.at(-1)!.lens, "read")
})

test("selectFocus appends a new subject and keeps the top unchanged", () => {
  let state = openSubject(createWorkbenchState("w1"), worldScope, file)
  const next = selectFocus(state, worldScope, file2)
  assert.equal(next.stack.length, 2)
  assert.equal(next.stack[1]!.subject.kind, "file")
  assert.equal(selectFocus(next, worldScope, file2), next)
})

test("same file at another version keeps one focus and updates the subject", () => {
  let state = openSubject(createWorkbenchState("w1"), worldScope, file)
  state = openSubject(state, worldScope, { ...file, version: "v2" })
  assert.equal(state.stack.length, 1)
  assert.equal(state.stack[0]!.subject.kind, "file")
  assert.equal((state.stack[0]!.subject as { version?: string }).version, "v2")
})

test("replaceLens refuses an inapplicable lens", () => {
  const state = openSubject(createWorkbenchState("w1"), worldScope, file)
  const before = state
  const refused = replaceLens(state, "interact")
  assert.equal(refused, before)
  assert.equal(refused.stack[0]!.lens, "read")
  assert.equal(replaceLens(state, "read"), state)
})

test("popFocus restores the previous focus and is a no-op at root", () => {
  let state = openSubject(createWorkbenchState("w1"), worldScope, file)
  state = openSubject(state, goalScope, file2)
  assert.equal(state.stack.length, 2)

  const popped = popFocus(state)
  assert.equal(popped.stack.length, 1)
  assert.equal(popped.stack[0]!.subject.kind, "file")
  assert.equal((popped.stack[0]!.subject as { rel: string }).rel, "src/a.ts")

  const root = openSubject(createWorkbenchState("w1"), worldScope, file)
  assert.equal(popFocus(root), root)
})

test("jumpTo truncates the stack", () => {
  let state = openSubject(createWorkbenchState("w1"), worldScope, file)
  state = openSubject(state, worldScope, file2)
  state = openSubject(state, goalScope, { kind: "changeSet", scope: "goal", goalId: "g1", revision: 3 })
  assert.equal(state.stack.length, 3)

  const jumped = jumpTo(state, 0)
  assert.equal(jumped.stack.length, 1)
  assert.equal((jumped.stack[0]!.subject as { rel: string }).rel, "src/a.ts")
  assert.equal(jumpTo(state, 99).stack.length, 3)
  assert.equal(jumpTo(state, -5).stack.length, 1)
})

test("keepSubject dedupes by subject identity", () => {
  let state = keepSubject(createWorkbenchState("w1"), file)
  state = keepSubject(state, { ...file, version: "v2" })
  assert.equal(state.kept.length, 1)
  assert.equal(sameSubject(state.kept[0]!, file), true)

  state = unkeepSubject(state, file)
  assert.equal(state.kept.length, 0)
})

test("subjectKey treats version as frame state, not identity", () => {
  assert.equal(subjectKey(file), subjectKey({ ...file, version: "v2" }))
  assert.notEqual(subjectKey(file), subjectKey(file2))
  assert.equal(
    subjectKey({ kind: "reviewItem", id: "r1", anchor: { rel: "src/a.ts", line: 4 } }),
    subjectKey({ kind: "reviewItem", id: "r1", anchor: { rel: "src/b.ts", line: 9 } }),
  )
  assert.notEqual(
    subjectKey({ kind: "plugin", package: "p", panel: "x" }),
    subjectKey({ kind: "plugin", package: "p", panel: "y" }),
  )
})

test("lens matrix is pinned per subject kind", () => {
  const cases: Array<[SubjectRef, string[]]> = [
    [{ kind: "world" }, ["orient"]],
    [{ kind: "goal", goalId: "g1" }, ["orient", "review", "decide"]],
    [file, ["read", "edit", "changes", "review"]],
    [{ kind: "changeSet", scope: "project", baseline: "HEAD" }, ["changes", "evidence", "review", "decide"]],
    [{ kind: "reviewItem", id: "r1" }, ["review", "decide"]],
    [{ kind: "evidence", id: "e1" }, ["evidence"]],
    [{ kind: "web", url: "https://example.com" }, ["interact"]],
    [{ kind: "terminal", id: "t1" }, ["interact"]],
    [{ kind: "plugin", package: "p", panel: "x" }, ["interact"]],
  ]
  for (const [subject, lenses] of cases) {
    assert.deepEqual([...lensesFor(subject)], lenses)
  }

  assert.equal(defaultLensFor({ kind: "world" }), "orient")
  assert.equal(defaultLensFor({ kind: "goal", goalId: "g1" }), "orient")
  assert.equal(defaultLensFor(file), "read")
  assert.equal(defaultLensFor({ kind: "changeSet", scope: "project" }), "changes")
  assert.equal(defaultLensFor({ kind: "reviewItem", id: "r1" }), "decide")
  assert.equal(defaultLensFor({ kind: "evidence", id: "e1" }), "evidence")
  assert.equal(defaultLensFor({ kind: "web", url: "https://example.com" }), "interact")

  assert.equal(isLensApplicable(file, "read"), true)
  assert.equal(isLensApplicable(file, "interact"), false)
  assert.equal(isLensApplicable({ kind: "web", url: "https://example.com" }, "read"), false)
})

test("diff subjects have a stable identity and no lenses", () => {
  const subject: SubjectRef = { kind: "diff", source: "session", id: "d1", rel: "src/a.ts" }
  assert.equal(subjectKey(subject), "diff:session:d1:src/a.ts")
  assert.deepEqual([...lensesFor(subject)], [])
  assert.equal(defaultLensFor(subject), "interact")
})
