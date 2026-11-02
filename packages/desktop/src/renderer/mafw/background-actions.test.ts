import { describe, expect, test } from "bun:test"
import { cancelJobAndIngest, formatJobOutput, type BackgroundJobsApi } from "./background-actions"
import { applyBackgroundJobEvent, type BackgroundJob } from "./background-jobs"

const job = (over: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: "task_1",
  source: "mafw-task",
  kind: "shell",
  status: "running",
  sessionID: "s1",
  title: "npm run dev",
  ...over,
})

function api(over: Partial<BackgroundJobsApi> = {}): BackgroundJobsApi & { calls: any[] } {
  const calls: any[] = []
  return {
    calls,
    async output(sessionID, id, cursor) {
      calls.push(["output", sessionID, id, cursor])
      return { data: "hello", cursor: 5, truncated: false }
    },
    async cancel(sessionID, id) {
      calls.push(["cancel", sessionID, id])
      return job({ id, status: "cancelled" })
    },
    ...over,
  }
}

describe("formatJobOutput", () => {
  test("maps {data,cursor,truncated} to display text and next cursor", () => {
    expect(formatJobOutput({ data: "hello", cursor: 5, truncated: false })).toEqual({ text: "hello", cursor: 5 })
  })

  test("empty data falls back to a placeholder but keeps the cursor", () => {
    expect(formatJobOutput({ data: "", cursor: 9, truncated: false })).toEqual({ text: "(无输出)", cursor: 9 })
    expect(formatJobOutput(null).text).toBe("(无输出)")
  })

  test("truncated output carries an explicit marker and byte cursor", () => {
    const view = formatJobOutput({ data: "tail", cursor: 65536, truncated: true })
    expect(view.text).toContain("tail")
    expect(view.text).toContain("截断")
    expect(view.text).toContain("65536")
    expect(view.cursor).toBe(65536)
  })
})

describe("cancelJobAndIngest", () => {
  test("cancels through the neutral façade and ingests the authoritative row", async () => {
    const client = api()
    const ingested: BackgroundJob[] = []
    const before = applyBackgroundJobEvent([], job())
    expect(before[0].status).toBe("running")

    const updated = await cancelJobAndIngest(client, "s1", "task_1", (j) => ingested.push(j))

    expect(client.calls).toEqual([["cancel", "s1", "task_1"]])
    expect(ingested).toHaveLength(1)
    expect(updated.status).toBe("cancelled")

    // 与 store 同一 reducer：取消行覆盖在跑行、不产生重复。
    const after = ingested.reduce<BackgroundJob[]>((rows, row) => applyBackgroundJobEvent(rows, row), before)
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: "task_1", status: "cancelled" })
  })

  test("does not ingest when the cancel call fails", async () => {
    const client = api({
      async cancel() { throw new Error("HTTP 503") },
    })
    const ingested: BackgroundJob[] = []
    await expect(cancelJobAndIngest(client, "s1", "task_1", (j) => ingested.push(j))).rejects.toThrow("503")
    expect(ingested).toEqual([])
  })

  test("output reads use the session scope and forward the cursor", async () => {
    const client = api()
    const view = formatJobOutput(await client.output("s1", "task_1", 3))
    expect(client.calls).toEqual([["output", "s1", "task_1", 3]])
    expect(view).toEqual({ text: "hello", cursor: 5 })
  })
})
