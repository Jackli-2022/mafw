import { expect, test } from "bun:test"
import { validateMenu } from "./model"
import type { MenuModel } from "./types"
import { buildSessionMenu } from "./builders/session"
import { buildProjectMenu } from "./builders/project"
import { buildRailNewMenu } from "./builders/rail"
import { buildCodeBlockMenu, buildMessageMenu } from "./builders/message"
import { buildFilePathMenu } from "./builders/file-path"
import { buildTextMenu } from "./builders/text"
import { buildFileTreeMenu } from "./builders/file-tree"
import { buildEditorTabMenu } from "./builders/editor-tab"
import { buildTerminalMenu } from "./builders/terminal"
import { buildBrowserMenu } from "./builders/browser"
import { buildBrowserPageMenu } from "./builders/browser-page"
import { buildExecutionRowMenu, buildReviewRowMenu } from "./builders/panel"
import {
  buildApprovalPermissionMenu,
  buildApprovalQuestionMenu,
  buildAutomationCardMenu,
  buildGoalCardMenu,
  buildGoalCellMenu,
  buildMemoryCardMenu,
  buildNotesCardMenu,
  buildTriageCardMenu,
} from "./builders/card"

const fixtures: MenuModel[] = [
  buildSessionMenu({ id: "s", title: "t", kind: "row", canFork: true }),
  buildSessionMenu({ id: "s", title: "t", kind: "tab", canFork: true }),
  buildProjectMenu({ id: "p", path: "C:/r" }),
  buildRailNewMenu({ worktreeEnabled: true }),
  buildMessageMenu({ id: "m", role: "user", hasText: true, canFork: true, tts: true }),
  buildMessageMenu({ id: "m", role: "assistant", hasText: true, canFork: false, tts: true }),
  buildCodeBlockMenu({ code: "x" }),
  buildFilePathMenu({ root: "C:/r", rel: "a.ts", inRoot: true, canOpenEditor: true }),
  buildFileTreeMenu({ rel: "a.ts", kind: "file", previewable: true }),
  buildFileTreeMenu({ rel: "d", kind: "dir", previewable: false }),
  buildEditorTabMenu({ rel: "a.ts", index: 1, count: 3 }),
  buildTerminalMenu({ hasSelection: true, canClose: true }),
  buildBrowserMenu({ url: "https://x", canBack: true, canForward: true, started: true, canPick: true }),
  buildBrowserPageMenu({ url: "https://x", linkURL: "https://l", selectionText: "s", imageURL: "https://i", canBack: true, canForward: false }),
  buildExecutionRowMenu({ sessionID: "s", kind: "background", canCancel: true }),
  buildReviewRowMenu({ rel: "a.ts" }),
  buildGoalCardMenu({ goalId: "g", running: true, canPause: true }),
  buildGoalCellMenu({ goalId: "g", runId: "r", sessionID: "s", artifact: "a.json", canRetry: true }),
  buildMemoryCardMenu({ id: "m", pinned: true, sticky: true }),
  buildNotesCardMenu({ id: "n" }),
  buildApprovalQuestionMenu({ id: "q" }),
  buildApprovalPermissionMenu({ id: "p", command: "rm -rf x" }),
  buildTriageCardMenu({ id: "t", goalId: "g" }),
  buildAutomationCardMenu({ id: "r", enabled: true }),
  buildTextMenu({ editable: true, hasSelection: true, canPaste: true }),
  buildTextMenu({ editable: false, hasSelection: true, canPaste: false }),
]

test("every builder output satisfies the grammar", () => {
  for (const model of fixtures) {
    expect({ surface: model.surface, errors: validateMenu(model) }).toEqual({
      surface: model.surface,
      errors: [],
    })
  }
})

test("models contain no functions", () => {
  const hasFn = (value: unknown): boolean =>
    typeof value === "function"
      ? true
      : Array.isArray(value)
        ? value.some(hasFn)
        : value && typeof value === "object"
          ? Object.values(value).some(hasFn)
          : false

  for (const model of fixtures) expect(hasFn(model)).toBe(false)
})
