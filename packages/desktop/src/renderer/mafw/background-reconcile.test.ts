import { describe, expect, test } from "bun:test"
import { reconcileBackgroundOnce, type BackgroundJobFetchers } from "./background-reconcile"
import type { BackgroundJob } from "./background-jobs"

const job = (id: string, over: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id,
  source: "runtime-shell",
  kind: "shell",
  status: "running",
  sessionID: "s1",
  title: "npm run dev",
  ...over,
})

function fetchers(over: Partial<BackgroundJobFetchers> = {}): BackgroundJobFetchers {
  return { listJobs: async () => [], ...over }
}

describe("reconcileBackgroundOnce（neutral jobs snapshot）", () => {
  test("ingests the whole jobs list as one snapshot", async () => {
    const seen: BackgroundJob[][] = []
    await reconcileBackgroundOnce({
      sessionID: "s1",
      fetchers: fetchers({ listJobs: async () => [job("a"), job("b", { status: "completed" })] }),
      ingest: (jobs) => seen.push(jobs),
    })
    expect(seen).toHaveLength(1)
    expect(seen[0].map((j) => j.id)).toEqual(["a", "b"])
  })

  test("calls the neutral jobs façade with the session scope only", async () => {
    const calls: string[] = []
    await reconcileBackgroundOnce({
      sessionID: "s9",
      fetchers: { listJobs: async (sid) => { calls.push(sid); return [] } },
      ingest: () => {},
    })
    expect(calls).toEqual(["s9"])
  })

  test("fail-open on fetch errors and malformed shapes (never fabricates terminals)", async () => {
    const seen: unknown[] = []
    await reconcileBackgroundOnce({
      sessionID: "s1",
      fetchers: fetchers({ listJobs: async () => { throw new Error("HTTP 503") } }),
      ingest: (jobs) => seen.push(jobs),
    })
    await reconcileBackgroundOnce({
      sessionID: "s1",
      fetchers: fetchers({ listJobs: async () => ({ error: "shape" }) as any }),
      ingest: (jobs) => seen.push(jobs),
    })
    expect(seen).toEqual([])
  })

  test("no session scope → no request", async () => {
    let calls = 0
    await reconcileBackgroundOnce({
      sessionID: null,
      fetchers: { listJobs: async () => { calls++; return [] } },
      ingest: () => {},
    })
    expect(calls).toBe(0)
  })
})
