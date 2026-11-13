import { test } from "node:test"
import assert from "node:assert/strict"
import { migrateContentScopeState, migrateLegacyContentScope } from "./legacy-migration"
import type { ContentScopeState } from "../content-scope-state"
import type { Scope } from "./focus-model"

const scope: Scope = { kind: "world", worldId: "w1" }

function state(overrides: Partial<ContentScopeState> = {}): ContentScopeState {
  return {
    treeExpanded: ["src"],
    treeSelected: "src/a.ts",
    openFiles: ["src/a.ts", "src/b.ts"],
    activeFile: "src/a.ts",
    readingPositions: { "src/a.ts": 120 },
    selections: { "src/a.ts": { anchor: 2, head: 5 } },
    filesOpen: true,
    ...overrides,
  }
}

test("active file becomes a file focus with scroll and selection", () => {
  const migrated = migrateContentScopeState({
    worldId: "w1",
    root: "C:/repo",
    scope,
    state: state(),
  })
  assert.equal(migrated.stack.length, 1)
  assert.equal(migrated.stack[0]!.subject.kind, "file")
  assert.equal((migrated.stack[0]!.subject as { rel: string }).rel, "src/a.ts")
  assert.equal(migrated.stack[0]!.place.scroll, 120)
  assert.deepEqual(migrated.stack[0]!.place.selection, { anchor: 2, head: 5 })
})

test("open files become kept subjects", () => {
  const migrated = migrateContentScopeState({
    worldId: "w1",
    root: "C:/repo",
    scope,
    state: state(),
  })
  assert.equal(migrated.kept.length, 2)
  assert.deepEqual(
    migrated.kept.map((subject) => (subject as { rel: string }).rel),
    ["src/a.ts", "src/b.ts"],
  )
})

test("empty state returns an empty workbench", () => {
  const migrated = migrateContentScopeState({
    worldId: "w1",
    root: "C:/repo",
    scope,
    state: state({ activeFile: null, openFiles: [] }),
  })
  assert.equal(migrated.stack.length, 0)
  assert.equal(migrated.kept.length, 0)
})

test("migration does not mutate the source", () => {
  const source = state()
  const before = JSON.stringify(source)
  migrateContentScopeState({ worldId: "w1", root: "C:/repo", scope, state: source })
  assert.equal(JSON.stringify(source), before)
})

test("migrates the retired content-scope key once", () => {
  const raw = JSON.stringify({ kind: "project", projectDir: "C:/repo" })
  const migrated = migrateLegacyContentScope({
    worldId: "C:/repo",
    projectDir: "C:/repo",
    rawScope: raw,
    readState: () => state(),
  })
  assert.ok(migrated)
  assert.equal(migrated.stack.length, 1)
  assert.equal((migrated.stack[0]!.subject as { rel: string }).rel, "src/a.ts")
  assert.equal(migrated.stack[0]!.place.scroll, 120)
})

test("ignores a malformed retired content scope", () => {
  assert.equal(migrateLegacyContentScope({
    worldId: "w1",
    projectDir: "C:/repo",
    rawScope: "{bad",
    readState: () => ({} as any),
  }), null)
})
