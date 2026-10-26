import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_WORKBENCH_STATE,
  EXECUTION_SECTIONS,
  executionSectionLabel,
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

  test("B1 execution labels are exact and ordered", () => {
    assert.deepEqual(
      EXECUTION_SECTIONS.map((s) => s.label),
      ["概览", "待办", "子代理", "后台", "轨迹"],
    )
    assert.equal(executionSectionLabel("background"), "后台")
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
