import { describe, expect, test } from "bun:test"
import { reconcileBackgroundOnce, type BackgroundFetchers } from "./background-reconcile"

function fetchers(over: Partial<BackgroundFetchers>): BackgroundFetchers {
  return {
    listShells: async () => [],
    getShell: async () => null,
    ...over,
  }
}

describe("reconcileBackgroundOnce（对账编排，fetch 注入）", () => {
  test("快照 → bg-snapshot（id/command/sessionID 映射）", async () => {
    const seen: any[] = []
    await reconcileBackgroundOnce({
      fetchers: fetchers({ listShells: async () => ([{ id: "sh1", command: "npm run dev", metadata: { sessionID: "s1" } }]) }),
      trackedRunningShellIds: () => [],
      ingest: (ev) => seen.push(ev),
    })
    expect(seen).toEqual([{ kind: "bg-snapshot", shells: [{ id: "sh1", command: "npm run dev", sessionID: "s1" }] }])
  })
  test("跟踪行不在快照：exited exit=0 → completed；exit≠0 → failed；null(404) → cancelled；仍 running → 不动", async () => {
    const seen: any[] = []
    await reconcileBackgroundOnce({
      fetchers: fetchers({
        listShells: async () => [],
        getShell: async (id) => id === "ok" ? { id, status: "exited", exit: 0 }
          : id === "bad" ? { id, status: "exited", exit: 3 }
            : id === "gone" ? null
              : { id, status: "running" },
      }),
      trackedRunningShellIds: () => ["ok", "bad", "gone", "live"],
      ingest: (ev) => seen.push(ev),
    })
    expect(seen).toEqual([
      { kind: "bg-terminal", id: "ok", terminal: "completed", source: "probe" },
      { kind: "bg-terminal", id: "bad", terminal: "failed", source: "probe" },
      { kind: "bg-terminal", id: "gone", terminal: "cancelled", source: "probe" },
    ])
  })
  test("listShells 抛错（401/网络）→ fail-open，零 ingest（不误判所有行已死）", async () => {
    const seen: any[] = []
    await reconcileBackgroundOnce({
      fetchers: fetchers({ listShells: async () => { throw new Error("HTTP 401") } }),
      trackedRunningShellIds: () => ["a", "b"],
      ingest: (ev) => seen.push(ev),
    })
    expect(seen).toEqual([])
  })
  test("getShell 抛错 → 该行跳过，其余继续", async () => {
    const seen: any[] = []
    await reconcileBackgroundOnce({
      fetchers: fetchers({
        listShells: async () => [],
        getShell: async (id) => { if (id === "boom") throw new Error("net"); return { id, status: "exited", exit: 0 } },
      }),
      trackedRunningShellIds: () => ["boom", "ok"],
      ingest: (ev) => seen.push(ev),
    })
    expect(seen).toEqual([{ kind: "bg-terminal", id: "ok", terminal: "completed", source: "probe" }])
  })
})
