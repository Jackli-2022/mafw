import { beforeEach, describe, expect, test } from "bun:test"
import {
  backgroundJobs,
  ingestBackgroundJob,
  ingestBackgroundJobs,
  onBackgroundTerminal,
  resetBackgroundStore,
} from "./background-store"
import type { BackgroundJob } from "./background-jobs"

const job = (over: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: "sh1",
  source: "runtime-shell",
  kind: "shell",
  status: "running",
  sessionID: "s1",
  title: "npm run dev",
  time: { created: 1, updated: 2 },
  ...over,
})

beforeEach(() => resetBackgroundStore())

describe("background job store", () => {
  test("canonical events dedupe by id and only fire one terminal callback", () => {
    const seen: string[] = []
    const off = onBackgroundTerminal((j) => seen.push(`${j.id}:${j.status}`))
    ingestBackgroundJob(job())
    ingestBackgroundJob(job({ status: "completed", time: { created: 1, updated: 3 } }))
    ingestBackgroundJob(job({ status: "failed", time: { created: 1, updated: 4 } }))
    expect(seen).toEqual(["sh1:completed"])
    expect(backgroundJobs()).toHaveLength(1)
    // 终态→终态允许权威更正，但不再触发通知（只有 running→终态才算新终态）。
    expect(backgroundJobs()[0].status).toBe("failed")
    off()
    ingestBackgroundJob(job({ id: "sh2" }))
    ingestBackgroundJob(job({ id: "sh2", status: "failed" }))
    expect(seen).toHaveLength(1)
  })

  test("snapshot ingestion is silent (history/reconcile must not toast)", () => {
    const seen: string[] = []
    onBackgroundTerminal((j) => seen.push(j.id))
    ingestBackgroundJobs([
      job({ id: "old", status: "completed" }),
      job({ id: "live", status: "running" }),
    ])
    expect(seen).toEqual([])
    expect(backgroundJobs().map((j) => j.id).sort()).toEqual(["live", "old"])
  })

  test("snapshot still applies terminal state (silent) and later live terminal notifies", () => {
    const seen: string[] = []
    onBackgroundTerminal((j) => seen.push(`${j.id}:${j.status}`))
    ingestBackgroundJobs([job()])
    ingestBackgroundJobs([job({ status: "completed" })])
    expect(backgroundJobs()[0].status).toBe("completed")
    expect(seen).toEqual([])

    ingestBackgroundJob(job({ id: "sh9" }))
    ingestBackgroundJob(job({ id: "sh9", status: "failed" }))
    expect(seen).toEqual(["sh9:failed"])
  })

  test("ignore malformed snapshot payloads", () => {
    ingestBackgroundJobs(null as any)
    ingestBackgroundJobs({ items: [] } as any)
    expect(backgroundJobs()).toEqual([])
  })
})
