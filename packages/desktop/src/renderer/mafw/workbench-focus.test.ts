import { test } from "node:test"
import assert from "node:assert/strict"
import {
  captureWorkbenchFocusSnapshot,
  restoreWorkbenchFocusSnapshot,
  type WorkbenchFocusSnapshot,
} from "./workbench-focus"

const snapshot: WorkbenchFocusSnapshot = {
  detent: 760,
  context: "review",
  surface: "terminal",
  previousSurface: "browser",
  executionOpen: true,
  executionSection: "subagents",
}

test("capture copies the full workbench state", () => {
  const captured = captureWorkbenchFocusSnapshot(snapshot)
  assert.deepEqual(captured, snapshot)
  assert.notEqual(captured, snapshot)
})

test("restore returns the snapshot when present and fallback when absent", () => {
  const fallback: WorkbenchFocusSnapshot = {
    detent: 520,
    context: "content",
    surface: "code",
    previousSurface: "code",
    executionOpen: false,
    executionSection: "overview",
  }
  assert.deepEqual(restoreWorkbenchFocusSnapshot(snapshot, fallback), snapshot)
  assert.deepEqual(restoreWorkbenchFocusSnapshot(null, fallback), fallback)
})
