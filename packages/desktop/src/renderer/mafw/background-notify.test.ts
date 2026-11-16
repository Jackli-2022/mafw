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

describe("buildBackgroundNotice（应用内 toast；OS 通知归事务层）", () => {
  test("completed：完成文案", () => {
    expect(buildBackgroundNotice(job())).toBe("后台任务完成：npm run dev")
  })
  test("failed：失败语义文案", () => {
    expect(buildBackgroundNotice(job({ status: "failed" }))).toBe("后台任务失败：npm run dev")
  })
  test("cancelled / running / input_required：null（静默）", () => {
    expect(buildBackgroundNotice(job({ status: "cancelled" }))).toBeNull()
    expect(buildBackgroundNotice(job({ status: "running" }))).toBeNull()
    expect(buildBackgroundNotice(job({ status: "input_required" }))).toBeNull()
  })
  test("falls back to command then id", () => {
    expect(buildBackgroundNotice(job({ title: undefined, command: "npm test" }))).toBe("后台任务完成：npm test")
    expect(buildBackgroundNotice(job({ title: undefined, command: undefined }))).toBe("后台任务完成：sh1")
  })
})
