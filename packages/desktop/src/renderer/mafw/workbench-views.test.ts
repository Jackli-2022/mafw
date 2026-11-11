import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_WORKBENCH_STATE,
  EXECUTION_SECTIONS,
  WORKBENCH_SURFACES,
  clearLegacyWorkbenchKeys,
  executionSectionLabel,
  isPluginSurfaceId,
  nextWorkbenchSurface,
  normalizeExecutionSection,
  normalizeWorkbenchSurface,
  parsePluginSurfaceId,
  pluginSurfaceId,
  migrateWorkbenchStorage,
  terminalSurfaceHotkeyAction,
  workbenchStateFromStorage,
} from "./workbench-views"

describe("workbench-views", () => {
  test("defaults and invalid values normalize to project/code/overview", () => {
    assert.deepEqual(DEFAULT_WORKBENCH_STATE, {
      context: "project",
      surface: "code",
      executionSection: "overview",
    })
    assert.equal(normalizeWorkbenchSurface("bogus"), "code")
    assert.equal(normalizeExecutionSection("bogus"), "overview")
  })

  test("terminal is now the third visible L2 surface", () => {
    assert.deepEqual(WORKBENCH_SURFACES.map((s) => s.label), ["文件", "浏览器", "终端"])
    assert.equal(normalizeWorkbenchSurface("terminal"), "terminal")
    assert.equal(nextWorkbenchSurface("browser", "ArrowRight"), "terminal")
    assert.equal(nextWorkbenchSurface("terminal", "ArrowRight"), null)
  })

  test("surface and execution labels are exact", () => {
    assert.deepEqual(WORKBENCH_SURFACES.map((v) => v.label), ["文件", "浏览器", "终端"])
    assert.deepEqual(
      EXECUTION_SECTIONS.map((s) => s.label),
      ["概览", "待办", "子代理", "后台", "轨迹"],
    )
    assert.equal(executionSectionLabel("background"), "后台")
    // Task 15：鲸群不再是日常执行分区；持久化的 pod 一次性迁到项目资源。
    assert.equal(executionSectionLabel("pod"), "团队")
    assert.equal(normalizeExecutionSection("pod"), "overview")
  })

  test("L2 keyboard helpers move without wrapping", () => {
    assert.equal(nextWorkbenchSurface("code", "ArrowRight"), "browser")
    assert.equal(nextWorkbenchSurface("browser", "ArrowRight"), "terminal")
    assert.equal(nextWorkbenchSurface("terminal", "ArrowRight"), null)
  })

  test("legacy keys are removed after one-time migration", () => {
    const keys = new Set(["mafw-right-dock-tab", "mafw-workbench-tab", "mafw-tasks-placement", "keep"])
    clearLegacyWorkbenchKeys((k) => keys.delete(k))
    assert.deepEqual([...keys], ["keep"])
  })

  test("persisted executionSection=pod migrates to the project resources entry once", () => {
    const migrated = migrateWorkbenchStorage((key) =>
      key === "mafw-execution-section" ? "pod" : null,
    )
    assert.equal(migrated.openResources, true)
    assert.equal(migrated.state.executionSection, "overview")

    const normal = migrateWorkbenchStorage((key) =>
      key === "mafw-execution-section" ? "trajectory" : null,
    )
    assert.equal(normal.openResources, false)
    assert.equal(normal.state.executionSection, "trajectory")
  })

  test("legacy right-dock tabs map to contexts", () => {
    const cases: Array<[string, string, string]> = [
      ["tasks", "project", "todos"],
      ["trajectory", "project", "trajectory"],
      ["subagents", "project", "subagents"],
      ["background", "project", "background"],
      ["changes", "review", "overview"],
      ["usage", "project", "overview"],
      ["quota", "project", "overview"],
      ["notes", "content", "overview"],
    ]
    for (const [legacy, context, executionSection] of cases) {
      const state = workbenchStateFromStorage((key) =>
        key === "mafw-right-dock-tab" ? legacy : null,
      )
      assert.equal(state.context, context, legacy)
      assert.equal(state.executionSection, executionSection, legacy)
    }
  })

  test("legacy B1 view and surface migrate; new keys win", () => {
    const legacy = workbenchStateFromStorage((key) =>
      key === "mafw-workbench-view" ? "workbench" : null,
    )
    assert.equal(legacy.context, "content")
    const execution = workbenchStateFromStorage((key) =>
      key === "mafw-workbench-view" ? "execution" : null,
    )
    assert.equal(execution.context, "project")
    const review = workbenchStateFromStorage((key) =>
      key === "mafw-workbench-view" ? "review" : null,
    )
    assert.equal(review.context, "review")

    const legacyBrowser = workbenchStateFromStorage((key) =>
      key === "mafw-workbench-tab" ? "browser" : null,
    )
    assert.equal(legacyBrowser.surface, "browser")
    const editor = workbenchStateFromStorage((key) =>
      key === "mafw-workbench-tab" ? "editor" : null,
    )
    assert.equal(editor.surface, "code")

    const terminal = workbenchStateFromStorage((key) =>
      key === "mafw-right-dock-tab" ? "terminal" : null,
    )
    assert.equal(terminal.surface, "terminal")
    const legacyTerminal = workbenchStateFromStorage((key) =>
      key === "mafw-workbench-tab" ? "terminal" : null,
    )
    assert.equal(legacyTerminal.surface, "terminal")

    const fresh = workbenchStateFromStorage((key) => {
      if (key === "mafw-workbench-context") return "review"
      if (key === "mafw-workbench-view") return "workbench"
      if (key === "mafw-workbench-surface") return "code"
      if (key === "mafw-execution-section") return "subagents"
      if (key === "mafw-right-dock-tab") return "tasks"
      return null
    })
    assert.deepEqual(fresh, { context: "review", surface: "code", executionSection: "subagents" })
  })

  test("dynamic plugin surfaces are valid L2 ids and survive persistence", () => {
    assert.equal(pluginSurfaceId("acme", "stats"), "plugin:acme:stats")
    assert.deepEqual(parsePluginSurfaceId("plugin:acme:stats"), { package: "acme", panel: "stats" })
    assert.equal(isPluginSurfaceId("plugin:acme:stats"), true)
    assert.equal(isPluginSurfaceId("plugin:acme"), false)
    assert.equal(isPluginSurfaceId("plugin:"), false)
    assert.equal(isPluginSurfaceId("plugin:bad name:stats"), false)
    assert.equal(isPluginSurfaceId("code"), false)

    assert.equal(normalizeWorkbenchSurface("plugin:acme:stats"), "plugin:acme:stats")
    assert.equal(normalizeWorkbenchSurface("plugin:acme"), "code")
    assert.equal(normalizeWorkbenchSurface("plugin:bad name:stats"), "code")

    const restored = workbenchStateFromStorage((key) => {
      if (key === "mafw-workbench-surface") return "plugin:acme:stats"
      return null
    })
    assert.equal(restored.surface, "plugin:acme:stats")
  })

  test("keyboard navigation includes dynamic plugin surfaces after built-ins", () => {
    const plugins = ["plugin:acme:stats", "plugin:acme:logs"]
    assert.equal(nextWorkbenchSurface("terminal", "ArrowRight", plugins), plugins[0])
    assert.equal(nextWorkbenchSurface(plugins[0]!, "ArrowRight", plugins), plugins[1])
    assert.equal(nextWorkbenchSurface(plugins[1]!, "ArrowRight", plugins), null)
    assert.equal(nextWorkbenchSurface(plugins[0]!, "ArrowLeft", plugins), "terminal")
    assert.equal(nextWorkbenchSurface(plugins[1]!, "Home", plugins), "code")
    assert.equal(nextWorkbenchSurface(plugins[0]!, "ArrowRight", []), null)
  })
})

describe("terminalSurfaceHotkeyAction（Ctrl+` surface 级开合）", () => {
  test("dock 关着 → 打开 dock + 内容 + terminal", () => {
    assert.deepEqual(
      terminalSurfaceHotkeyAction({ dockOpen: false, context: "project", surface: "code", previousSurface: "code" }),
      { openDock: true, context: "content", surface: "terminal" },
    )
  })
  test("非内容上下文 → 跳到内容 + terminal", () => {
    assert.deepEqual(
      terminalSurfaceHotkeyAction({ dockOpen: true, context: "review", surface: "code", previousSurface: "browser" }),
      { openDock: true, context: "content", surface: "terminal" },
    )
  })
  test("当前就是 terminal → 回到 previousSurface", () => {
    assert.deepEqual(
      terminalSurfaceHotkeyAction({ dockOpen: true, context: "content", surface: "terminal", previousSurface: "browser" }),
      { openDock: true, context: "content", surface: "browser" },
    )
  })
  test("非 terminal surface → 切到 terminal", () => {
    assert.deepEqual(
      terminalSurfaceHotkeyAction({ dockOpen: true, context: "content", surface: "code", previousSurface: "browser" }),
      { openDock: true, context: "content", surface: "terminal" },
    )
  })
})
