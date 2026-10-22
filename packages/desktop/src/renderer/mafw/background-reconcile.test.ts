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
  test("killed → cancelled；timeout → failed（v2 真实状态枚举，reviewer Minor 10）", async () => {
    const seen: any[] = []
    await reconcileBackgroundOnce({
      fetchers: fetchers({
        listShells: async () => [],
        getShell: async (id) => id === "k" ? { id, status: "killed" } : { id, status: "timeout" },
      }),
      trackedRunningShellIds: () => ["k", "t"],
      ingest: (ev) => seen.push(ev),
    })
    expect(seen).toEqual([
      { kind: "bg-terminal", id: "k", terminal: "cancelled", source: "probe" },
      { kind: "bg-terminal", id: "t", terminal: "failed", source: "probe" },
    ])
  })
  test("getShell 抛 HTTP 404 → cancelled（SDK 已映射 null；此为非 SDK 调用方兜底，reviewer Critical 1）", async () => {
    const seen: any[] = []
    await reconcileBackgroundOnce({
      fetchers: fetchers({
        listShells: async () => [],
        getShell: async () => { throw new Error("HTTP 404: Not Found") },
      }),
      trackedRunningShellIds: () => ["gone"],
      ingest: (ev) => seen.push(ev),
    })
    expect(seen).toEqual([{ kind: "bg-terminal", id: "gone", terminal: "cancelled", source: "probe" }])
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
  test("listShells 返回非数组 → fail-open（不 mass-probe，reviewer Critical 1）", async () => {
    const seen: any[] = []
    await reconcileBackgroundOnce({
      fetchers: fetchers({ listShells: async () => ({ error: "shape" }) as any }),
      trackedRunningShellIds: () => ["a"],
      ingest: (ev) => seen.push(ev),
    })
    expect(seen).toEqual([])
  })
  test("directory 透传给 list/get（location-scoped，reviewer Important 5）", async () => {
    const calls: Array<[string, string | undefined]> = []
    await reconcileBackgroundOnce({
      directory: "C:\\proj",
      fetchers: {
        listShells: async (dir) => { calls.push(["list", dir]); return [] },
        getShell: async (id, dir) => { calls.push([id, dir]); return null },
      },
      trackedRunningShellIds: () => ["sh1"],
      ingest: () => {},
    })
    expect(calls).toEqual([["list", "C:\\proj"], ["sh1", "C:\\proj"]])
  })
  test("getShell 抛错（非 404）→ 该行跳过，其余继续", async () => {
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
