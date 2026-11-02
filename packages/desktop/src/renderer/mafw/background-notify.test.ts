import { describe, expect, test } from "bun:test"
import { buildBackgroundNotice } from "./background-notify"
import type { BackgroundJob } from "./background-jobs"

const job = (over: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: "sh1",
  source: "runtime-shell",
  kind: "shell",
  status: "completed",
  sessionID: "s1",
  title: "npm run dev",
  ...over,
})

describe("buildBackgroundNotice", () => {
  test("completed：toast 恒有；hidden 时附 OS", () => {
    expect(buildBackgroundNotice(job(), { hidden: false })).toEqual({ toast: "后台任务完成：npm run dev" })
    expect(buildBackgroundNotice(job(), { hidden: true })!.os).toEqual({ title: "MAFW：后台任务完成", body: "npm run dev" })
  })
  test("failed：失败语义文案", () => {
    expect(buildBackgroundNotice(job({ status: "failed" }), { hidden: false })!.toast).toBe("后台任务失败：npm run dev")
  })
  test("cancelled / running / input_required：null（静默）", () => {
    expect(buildBackgroundNotice(job({ status: "cancelled" }), { hidden: true })).toBeNull()
    expect(buildBackgroundNotice(job({ status: "running" }), { hidden: true })).toBeNull()
    expect(buildBackgroundNotice(job({ status: "input_required" }), { hidden: true })).toBeNull()
  })
  test("falls back to command then id", () => {
    expect(buildBackgroundNotice(job({ title: undefined, command: "npm test" }), { hidden: false })!.toast).toBe("后台任务完成：npm test")
    expect(buildBackgroundNotice(job({ title: undefined, command: undefined }), { hidden: false })!.toast).toBe("后台任务完成：sh1")
  })
})
