import { describe, expect, test } from "bun:test"
import {
  applyBackgroundJobEvent,
  clearSessionBackgroundJobs,
  collectNewTerminals,
  countRunningJobs,
  isTerminalJobStatus,
  jobLabel,
  jobSort,
  jobsForSession,
  mergeBackgroundJobs,
  type BackgroundJob,
} from "./background-jobs"

const job = (over: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: "task_1",
  source: "mafw-task",
  kind: "shell",
  status: "running",
  sessionID: "s1",
  title: "npm run dev",
  time: { created: 1, updated: 2 },
  ...over,
})

describe("clearSessionBackgroundJobs（权威空快照）", () => {
  test("只清目标会话的行，其他会话保留；引用不变时返回原数组", () => {
    const jobs = [
      job({ id: "a", sessionID: "s1" }),
      job({ id: "b", sessionID: "s2" }),
      job({ id: "c", sessionID: "s1", status: "completed" }),
    ]
    const cleared = clearSessionBackgroundJobs(jobs, "s1")
    expect(cleared.map((j) => j.id)).toEqual(["b"])
    expect(clearSessionBackgroundJobs(jobs, "s3")).toBe(jobs)
    expect(clearSessionBackgroundJobs(jobs, "")).toBe(jobs)
  })
})

describe("applyBackgroundJobEvent", () => {
  test("inserts a new job and dedupes by stable id", () => {
    const first = applyBackgroundJobEvent([], job())
    expect(first.map((j) => j.id)).toEqual(["task_1"])
    const next = applyBackgroundJobEvent(first, job({ status: "completed", time: { created: 1, updated: 3 } }))
    expect(next).toHaveLength(1)
    expect(next[0].status).toBe("completed")
  })

  test("terminal status never regresses to running (late/duplicate events)", () => {
    let jobs = applyBackgroundJobEvent([], job())
    jobs = applyBackgroundJobEvent(jobs, job({ status: "completed" }))
    jobs = applyBackgroundJobEvent(jobs, job({ status: "running" }))
    expect(jobs[0].status).toBe("completed")
  })

  test("terminal status may be replaced by another terminal status (authoritative correction)", () => {
    let jobs = applyBackgroundJobEvent([], job({ status: "completed" }))
    jobs = applyBackgroundJobEvent(jobs, job({ status: "failed" }))
    expect(jobs[0].status).toBe("failed")
  })

  test("rejects rows without id or sessionID", () => {
    expect(applyBackgroundJobEvent([], job({ id: "" }))).toEqual([])
    expect(applyBackgroundJobEvent([], job({ sessionID: "" }))).toEqual([])
  })

  test("keeps active jobs first, then newest updated", () => {
    const rows = [
      job({ id: "done", status: "completed", time: { updated: 999 } }),
      job({ id: "run-old", time: { updated: 1 } }),
      job({ id: "run-new", time: { updated: 5 } }),
    ]
    expect(applyBackgroundJobEvent([], rows[0]).concat()).toHaveLength(1)
    const all = rows.reduce<BackgroundJob[]>((acc, row) => applyBackgroundJobEvent(acc, row), [])
    expect(all.map((j) => j.id)).toEqual(["run-new", "run-old", "done"])
  })
})

describe("mergeBackgroundJobs / helpers", () => {
  test("merges snapshots without dropping newer terminal state", () => {
    const live = applyBackgroundJobEvent([], job({ status: "completed" }))
    const merged = mergeBackgroundJobs(live, [job({ status: "running" })])
    expect(merged[0].status).toBe("completed")
  })

  test("isTerminalJobStatus covers the canonical job statuses", () => {
    expect(isTerminalJobStatus("completed")).toBe(true)
    expect(isTerminalJobStatus("failed")).toBe(true)
    expect(isTerminalJobStatus("cancelled")).toBe(true)
    expect(isTerminalJobStatus("running")).toBe(false)
    expect(isTerminalJobStatus("input_required")).toBe(false)
  })

  test("jobLabel prefers title then command then id", () => {
    expect(jobLabel(job({ title: "T", command: "c" }))).toBe("T")
    expect(jobLabel(job({ title: undefined, command: "c" }))).toBe("c")
    expect(jobLabel(job({ title: undefined, command: undefined }))).toBe("task_1")
  })

  test("jobsForSession filters and countRunningJobs counts active rows only", () => {
    const jobs = [
      job({ id: "a", status: "running" }),
      job({ id: "b", status: "input_required", sessionID: "s2" }),
      job({ id: "c", status: "completed" }),
    ]
    expect(jobsForSession(jobs, "s1").map((j) => j.id)).toEqual(["a", "c"])
    expect(countRunningJobs(jobs)).toBe(2)
  })

  test("jobSort is stable for equal timestamps", () => {
    const rows = [job({ id: "b", time: { updated: 1 } }), job({ id: "a", time: { updated: 1 } })]
    expect(jobSort(rows).map((j) => j.id)).toEqual(["a", "b"])
  })

  test("collectNewTerminals only reports live running→terminal transitions", () => {
    const before = [job({ id: "a", status: "running" })]
    const after = [
      job({ id: "a", status: "completed" }),
      job({ id: "b", status: "completed" }),
    ]
    expect(collectNewTerminals(before, after).map((j) => j.id)).toEqual(["a"])
  })
})
