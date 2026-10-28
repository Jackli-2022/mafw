import { describe, expect, test } from "bun:test"
import { buildExecutionRowMenu, buildReviewRowMenu } from "./panel"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

describe("buildExecutionRowMenu", () => {
  test("background rows offer open, copy and cancel", () => {
    const m = buildExecutionRowMenu({ sessionID: "s", taskID: "t", kind: "background", canCancel: true })
    expect(ids(m)).toEqual(["panel.openSession", "panel.copyId", "panel.cancel"])
    expect(validateMenu(m)).toEqual([])
  })

  test("trajectory rows never offer cancel", () => {
    const m = buildExecutionRowMenu({ sessionID: "s", kind: "trajectory", canCancel: false })
    expect(ids(m)).toEqual(["panel.openSession", "panel.copyId"])
  })

  test("rows without a session drop open-session", () => {
    const m = buildExecutionRowMenu({ taskID: "t", kind: "background", canCancel: false })
    expect(ids(m)).toEqual(["panel.copyId"])
  })
})

describe("buildReviewRowMenu", () => {
  test("open, reveal and a copy submenu", () => {
    const m = buildReviewRowMenu({ rel: "a.ts" })
    expect(ids(m)).toEqual([
      "review.open",
      "review.reveal",
      "review.copy",
      "review.copy.rel",
      "review.copy.abs",
      "review.copy.name",
    ])
    expect(validateMenu(m)).toEqual([])
  })
})
