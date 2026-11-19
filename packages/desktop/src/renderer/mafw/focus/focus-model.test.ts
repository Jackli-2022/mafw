import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createWorkbenchState,
  jumpTo,
  keepSubject,
  openSubject,
  popFocus,
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

test("openSubject pushes a new focus", () => {
  const state = createWorkbenchState("w1")
  assert.equal(state.stack.length, 0)
  assert.equal(state.kept.length, 0)

  const next = openSubject(state, worldScope, file)
  assert.equal(next.stack.length, 1)
  assert.equal(next.stack[0]!.scope.kind, "world")
  assert.equal(next.stack[0]!.place.scroll, undefined)
  assert.equal(next.stack[0]!.place.selection, undefined)
})

test("page subject has a stable key and opens on the world scope", () => {
  const page: SubjectRef = { kind: "page", id: "triage" }
  assert.equal(subjectKey(page), "page:triage")
  const state = openSubject(createWorkbenchState("w1"), worldScope, page)
  assert.equal(state.stack.at(-1)!.subject.kind, "page")
  assert.equal(state.stack.at(-1)!.scope.kind, "world")
})

test("memory subject has a stable key and opens on the world scope", () => {
  const memory: SubjectRef = { kind: "memory" }
  assert.equal(subjectKey(memory), "memory")
  const state = openSubject(createWorkbenchState("w1"), worldScope, memory)
  assert.equal(state.stack.at(-1)!.subject.kind, "memory")
  assert.equal(state.stack.at(-1)!.scope.kind, "world")
})

test("opening the same subject replaces place instead of pushing", () => {
  let state = openSubject(createWorkbenchState("w1"), worldScope, file)
  state = updatePlace(state, { scroll: 120, selection: { anchor: 1, head: 4 } })

  const same = openSubject(state, worldScope, file)
  assert.equal(same.stack.length, 1)
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
  state = openSubject(state, goalScope, { kind: "web", url: "https://example.com" })
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
  assert.notEqual(
    subjectKey({ kind: "plugin", package: "p", panel: "x" }),
    subjectKey({ kind: "plugin", package: "p", panel: "y" }),
  )
})

test("change-set subjects have a stable identity", () => {
  const subject: SubjectRef = { kind: "changeset", id: "changeset:session:s1:m1", rel: "src/a.ts" }
  assert.equal(subjectKey(subject), "changeset:changeset:session:s1:m1")
})
