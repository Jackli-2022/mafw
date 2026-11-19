import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import {
  closeSceneTab,
  configureSceneTabStorage,
  flushSceneTabs,
  openSceneTab,
  resetSceneTabsForTests,
  sceneTabForSubject,
  sceneTabId,
  sceneTabStorageKey,
  sceneTabs,
  switchSceneTabWorld,
} from "./scene-tabs"

const worldScope = { kind: "world" as const, worldId: "C:/repo" }
const goalScope = {
  kind: "goal" as const,
  worldId: "C:/repo",
  goalId: "g1",
  revision: 2,
  worktreeDir: "C:/wt",
}

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

beforeEach(() => {
  resetSceneTabsForTests()
  configureSceneTabStorage(fakeStorage())
})

test("scene tab ids are stable per subject", () => {
  assert.equal(sceneTabId({ kind: "world" }), "scene:world")
  assert.equal(sceneTabId({ kind: "goal", goalId: "g1" }), "scene:goal:g1")
  assert.equal(sceneTabId({ kind: "terminal", id: "local" }), "scene:terminal:local")
  assert.equal(sceneTabId({ kind: "plugin", package: "mafw", panel: "memory" }), "scene:plugin:mafw:memory")
  assert.equal(sceneTabId({ kind: "memory" }), "scene:memory")
})

test("memory scene tab is persistent with a brain icon", () => {
  const tab = openSceneTab({ subject: { kind: "memory" }, scope: worldScope })
  assert.equal(tab.id, "scene:memory")
  assert.equal(tab.label, "记忆")
  assert.equal(tab.icon, "memory")
  assert.equal(tab.persistent, true)
})

test("opening a scene tab dedupes and updates its label", () => {
  openSceneTab({ subject: { kind: "goal", goalId: "g1" }, scope: goalScope, label: "Goal · 修复登录" })
  openSceneTab({ subject: { kind: "goal", goalId: "g1" }, scope: goalScope, label: "Goal · 修复登录（新）" })
  assert.equal(sceneTabs().length, 1)
  assert.equal(sceneTabs()[0]?.label, "Goal · 修复登录（新）")
  assert.equal(sceneTabForSubject({ kind: "goal", goalId: "g1" })?.id, "scene:goal:g1")
})

test("world and Goal tabs persist per world; terminal and plugin do not", () => {
  const storage = fakeStorage()
  configureSceneTabStorage(storage)
  switchSceneTabWorld("C:/repo")
  openSceneTab({ subject: { kind: "world" }, scope: worldScope, label: "世界总览" })
  openSceneTab({ subject: { kind: "goal", goalId: "g1" }, scope: goalScope, label: "Goal · 修复登录" })
  openSceneTab({ subject: { kind: "terminal", id: "local" }, scope: worldScope, label: "终端" })
  openSceneTab({
    subject: { kind: "plugin", package: "mafw", panel: "memory" },
    scope: worldScope,
    label: "插件 · memory",
  })
  flushSceneTabs()

  const saved = JSON.parse(storage.map.get(sceneTabStorageKey("C:/repo"))!)
  assert.deepEqual(saved.tabs.map((tab: any) => tab.subject.kind), ["world", "goal"])

  resetSceneTabsForTests()
  configureSceneTabStorage(storage)
  switchSceneTabWorld("C:/repo")
  assert.deepEqual(sceneTabs().map((tab) => tab.id), ["scene:world", "scene:goal:g1"])
})

test("switching worlds drops ephemeral tabs and loads the next world's tabs", () => {
  const storage = fakeStorage()
  configureSceneTabStorage(storage)
  switchSceneTabWorld("C:/one")
  openSceneTab({ subject: { kind: "world" }, scope: { kind: "world", worldId: "C:/one" } })
  openSceneTab({ subject: { kind: "terminal", id: "local" }, scope: { kind: "world", worldId: "C:/one" } })

  switchSceneTabWorld("C:/two")
  assert.deepEqual(sceneTabs(), [])
})

test("closing a scene tab removes it from the strip", () => {
  openSceneTab({ subject: { kind: "world" }, scope: worldScope })
  closeSceneTab("scene:world")
  assert.deepEqual(sceneTabs(), [])
})
