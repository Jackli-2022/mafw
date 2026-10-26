import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_WORKBENCH_STATE,
  EXECUTION_SECTIONS,
  WORKBENCH_SURFACES,
  WORKBENCH_VIEWS,
  clearLegacyWorkbenchKeys,
  executionSectionLabel,
  nextWorkbenchSurface,
  nextWorkbenchView,
  normalizeExecutionSection,
  normalizeWorkbenchSurface,
  normalizeWorkbenchView,
  workbenchStateFromStorage,
} from "./workbench-views"

describe("workbench-views", () => {
  test("defaults and invalid values normalize to workbench/code/overview", () => {
    assert.deepEqual(DEFAULT_WORKBENCH_STATE, {
      view: "workbench",
      surface: "code",
      executionSection: "overview",
    })
    assert.equal(normalizeWorkbenchView("bogus"), "workbench")
    assert.equal(normalizeWorkbenchSurface("bogus"), "code")
    assert.equal(normalizeExecutionSection("bogus"), "overview")
  })

  test("B1 labels are exact and ordered", () => {
    assert.deepEqual(WORKBENCH_VIEWS.map((v) => v.label), ["工作台", "执行", "审阅"])
    assert.deepEqual(WORKBENCH_SURFACES.map((v) => v.label), ["代码", "浏览器"])
    assert.deepEqual(
      EXECUTION_SECTIONS.map((s) => s.label),
      ["概览", "待办", "子代理", "后台", "轨迹"],
    )
    assert.equal(executionSectionLabel("background"), "后台")
  })

  test("keyboard helpers move within L1 and L2 without wrapping", () => {
    assert.equal(nextWorkbenchView("workbench", "ArrowRight"), "execution")
    assert.equal(nextWorkbenchView("execution", "ArrowRight"), "review")
    assert.equal(nextWorkbenchView("review", "ArrowRight"), null)
    assert.equal(nextWorkbenchView("review", "ArrowLeft"), "execution")
    assert.equal(nextWorkbenchView("execution", "Home"), "workbench")
    assert.equal(nextWorkbenchView("workbench", "End"), "review")
    assert.equal(nextWorkbenchSurface("code", "ArrowRight"), "browser")
    assert.equal(nextWorkbenchSurface("browser", "ArrowRight"), null)
  })

  test("legacy keys are removed after one-time migration", () => {
    const keys = new Set(["mafw-right-dock-tab", "mafw-workbench-tab", "mafw-tasks-placement", "keep"])
    clearLegacyWorkbenchKeys((k) => keys.delete(k))
    assert.deepEqual([...keys], ["keep"])
  })

  test("legacy right-dock tabs map to B1 state", () => {
    const cases: Array<[string, string, string]> = [
      ["tasks", "execution", "todos"],
      ["trajectory", "execution", "trajectory"],
      ["subagents", "execution", "subagents"],
      ["background", "execution", "background"],
      ["changes", "review", "overview"],
      ["usage", "execution", "overview"],
      ["quota", "execution", "overview"],
      ["notes", "workbench", "overview"],
    ]
    for (const [legacy, view, executionSection] of cases) {
      const state = workbenchStateFromStorage((key) =>
        key === "mafw-right-dock-tab" ? legacy : null,
      )
      assert.equal(state.view, view, legacy)
      assert.equal(state.executionSection, executionSection, legacy)
    }
  })

  test("legacy editor/browser workbench tab maps to surface; new keys win", () => {
    const legacy = workbenchStateFromStorage((key) =>
      key === "mafw-workbench-tab" ? "browser" : null,
    )
    assert.equal(legacy.surface, "browser")
    const editor = workbenchStateFromStorage((key) =>
      key === "mafw-workbench-tab" ? "editor" : null,
    )
    assert.equal(editor.surface, "code")

    const fresh = workbenchStateFromStorage((key) => {
      if (key === "mafw-workbench-view") return "review"
      if (key === "mafw-workbench-surface") return "code"
      if (key === "mafw-execution-section") return "subagents"
      if (key === "mafw-right-dock-tab") return "tasks"
      return null
    })
    assert.deepEqual(fresh, { view: "review", surface: "code", executionSection: "subagents" })
  })
})
