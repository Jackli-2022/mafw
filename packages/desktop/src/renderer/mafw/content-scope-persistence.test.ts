import { test } from "node:test"
import assert from "node:assert/strict"
import { goalContentScope, projectContentScope } from "./content-scope"
import {
  contentScopeStorageKey,
  persistContentScope,
  readPersistedContentScope,
  type ContentScopeStorage,
} from "./content-scope-persistence"

function memStorage(seed: Record<string, string> = {}) {
  const data = { ...seed }
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value },
    removeItem: (key: string) => { delete data[key] },
    dump: () => data,
  }
}

test("project scope round-trips under a normalized project key", () => {
  const storage = memStorage()
  assert.equal(
    contentScopeStorageKey("C:\\Work\\App\\"),
    contentScopeStorageKey("c:/work/app"),
  )
  persistContentScope(projectContentScope("C:\\Work\\App"), storage)
  const restored = readPersistedContentScope("c:/work/app", storage)
  assert.equal(restored?.kind, "project")
  assert.equal(restored?.projectDir, "C:\\Work\\App")
})

test("goal scope round-trips with title and never restores into another project", () => {
  const storage = memStorage()
  const goal = goalContentScope({
    projectDir: "C:\\Work\\App",
    goalId: "g1",
    revision: 2,
    worktreeDir: "C:\\Work\\App-wt-goal-g1-r2",
    title: "Fix login",
  })
  assert.ok(goal)
  persistContentScope(goal, storage)
  const restored = readPersistedContentScope("C:\\Work\\App", storage)
  assert.equal(restored?.kind, "goal")
  assert.equal(restored && restored.kind === "goal" ? restored.revision : null, 2)
  assert.equal(restored && restored.kind === "goal" ? restored.title : null, "Fix login")
  assert.equal(readPersistedContentScope("D:\\Other", storage), null)
})

test("malformed or foreign persisted scope falls back to null", () => {
  const malformed = memStorage({ [contentScopeStorageKey("C:\\Work\\App")]: "{not-json" })
  assert.equal(readPersistedContentScope("C:\\Work\\App", malformed), null)

  const unknownKind = memStorage({
    [contentScopeStorageKey("C:\\Work\\App")]: JSON.stringify({ kind: "workspace", projectDir: "C:\\Work\\App" }),
  })
  assert.equal(readPersistedContentScope("C:\\Work\\App", unknownKind), null)

  const escaped = memStorage({
    [contentScopeStorageKey("C:\\Work\\App")]: JSON.stringify({
      kind: "goal",
      goalId: "g1",
      revision: 1,
      worktreeDir: "D:\\tmp\\wt",
    }),
  })
  assert.equal(readPersistedContentScope("C:\\Work\\App", escaped), null)

  const storage = memStorage() as ContentScopeStorage & { dump(): Record<string, string> }
  persistContentScope(null, storage)
  assert.deepEqual(storage.dump(), {})
})
