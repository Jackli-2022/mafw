import { test } from "node:test"
import assert from "node:assert/strict"
import { buildCommandPickerItems, buildFilePickerItems, filterPickerItems } from "./picker-model"
import { subjectKey, type Scope } from "./focus-model"
import type { RecentContentEntry } from "../recent-content"

const projectScope: Scope = { kind: "world", worldId: "w1" }
const goalScope: Scope = {
  kind: "goal",
  worldId: "w1",
  goalId: "g1",
  revision: 3,
  worktreeDir: "C:/repo-wt",
}

function recent(rel: string, at: number, extra: Partial<RecentContentEntry> = {}): RecentContentEntry {
  return {
    rel,
    scopeKey: "project:c:/repo",
    scopeKind: "project",
    scopeLabel: "项目文件",
    at,
    ...extra,
  }
}

test("recent items come first and dedupe against files", () => {
  const items = buildFilePickerItems({
    worldId: "w1",
    files: ["src/a.ts", "src/b.ts"],
    recent: [recent("src/a.ts", 10)],
    root: "C:/repo",
    scope: projectScope,
    projectScope,
  })
  assert.equal(items.length, 2)
  assert.equal(items[0]!.kind, "recent")
  assert.equal(items[0]!.label, "src/a.ts")
  assert.equal(items[1]!.kind, "file")
  assert.equal(items[1]!.label, "src/b.ts")
})

test("file items carry the current scope and root", () => {
  const items = buildFilePickerItems({
    worldId: "w1",
    files: ["src/a.ts"],
    recent: [],
    root: "C:/repo-wt",
    scope: goalScope,
    projectScope,
  })
  assert.equal(items.length, 1)
  assert.deepEqual(items[0]!.scope, goalScope)
  assert.equal(items[0]!.subject.kind, "file")
  assert.equal((items[0]!.subject as { root: string }).root, "C:/repo-wt")
})

test("goal recents use the worktree root and goal scope", () => {
  const items = buildFilePickerItems({
    worldId: "w1",
    files: [],
    recent: [
      recent("src/a.ts", 10, {
        scopeKey: "goal:c:/repo:g1:r3",
        scopeKind: "goal",
        scopeLabel: "工作台重构 · rev 3",
        goalId: "g1",
        revision: 3,
        worktreeDir: "C:/repo-wt",
      }),
      recent("src/b.ts", 9, { scopeKind: "goal", scopeLabel: "broken" }),
    ],
    root: "C:/repo",
    scope: projectScope,
    projectScope,
  })
  assert.equal(items.length, 1)
  assert.equal(items[0]!.scope.kind, "goal")
  assert.equal(items[0]!.subject.kind, "file")
  assert.equal((items[0]!.subject as { root: string }).root, "C:/repo-wt")
})

test("filter is case-insensitive and capped", () => {
  const items = buildFilePickerItems({
    worldId: "w1",
    files: Array.from({ length: 60 }, (_, i) => `src/file-${String(i).padStart(2, "0")}.ts`),
    recent: [],
    root: "C:/repo",
    scope: projectScope,
    projectScope,
  })
  assert.equal(filterPickerItems(items, "").length, 50)
  assert.equal(filterPickerItems(items, "FILE-01").length, 1)
  assert.equal(filterPickerItems(items, "file-01")[0]!.label, "src/file-01.ts")
})

test("empty query returns recent plus files", () => {
  const items = buildFilePickerItems({
    worldId: "w1",
    files: ["src/a.ts", "src/b.ts"],
    recent: [recent("src/a.ts", 10)],
    root: "C:/repo",
    scope: projectScope,
    projectScope,
  })
  assert.deepEqual(filterPickerItems(items, "  ").map((item) => item.label), ["src/a.ts", "src/b.ts"])
})

test("commands append browser and terminal", () => {
  const commands = buildCommandPickerItems(projectScope)
  assert.equal(commands.length, 2)
  assert.equal(commands[0]!.kind, "command")
  assert.equal(commands[0]!.subject.kind, "web")
  assert.equal(commands[1]!.subject.kind, "terminal")
  assert.equal(commands[0]!.scope.kind, "world")
})

test("picker item identities are stable", () => {
  const items = buildFilePickerItems({
    worldId: "w1",
    files: ["src/a.ts"],
    recent: [],
    root: "C:/repo",
    scope: projectScope,
    projectScope,
  })
  assert.equal(items[0]!.id, `file:${subjectKey(items[0]!.subject)}`)
})
