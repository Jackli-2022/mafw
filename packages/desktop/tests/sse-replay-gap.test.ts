import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { readFileSync } from "node:fs"
import { SseConnection, withSince, SSE_SEQ_KEY, SSE_INSTANCE_KEY } from "../src/renderer/mafw/sse/sse-connection"
import type { GapRecovery } from "../src/renderer/mafw/sse/event-replay-gap"
import { recoverEventGap } from "../src/renderer/mafw/sse/event-replay-gap"

/**
 * E6-1：SSE 开流前补 replay 缺口（spec 2026-11-13 §3.2）。
 *
 * 契约：
 *  - 首次连接（无持久游标）不调用 recoverGap；
 *  - 有游标 → recoverGap(since, 500)；成功用 headSeq 开流并把 lastAppliedSeq 钉在 headSeq；
 *  - reset / truncated → clearSeq + onFullResync(reason) + 以 headSeq 开流；
 *  - recoverGap 返回 null / 抛错 → 保持原 since（旧路径：SSE greeting 分级）；
 *  - 补页成功后 live 帧 seq ≤ headSeq 被抑制、> headSeq 应用；
 *  - onReconnect / greeting 语义不变。
 */

class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []

  readyState = FakeEventSource.OPEN
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string; lastEventId?: string }) => void) | null = null
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.closed = true
    this.readyState = FakeEventSource.CLOSED
  }

  fireOpen(): void {
    this.onopen?.()
  }

  fireMessage(payload: unknown, lastEventId = ""): void {
    this.onmessage?.({ data: typeof payload === "string" ? payload : JSON.stringify(payload), lastEventId })
  }
}

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
  }
}

const realEventSource = (globalThis as any).EventSource
const BASE = "http://gw:3000/api/events"
const SEEDED = () => fakeStorage({ [SSE_SEQ_KEY]: "42", [SSE_INSTANCE_KEY]: "inst-A" })

beforeEach(() => {
  FakeEventSource.instances = []
  ;(globalThis as any).EventSource = FakeEventSource
})

afterEach(() => {
  if (realEventSource === undefined) delete (globalThis as any).EventSource
  else (globalThis as any).EventSource = realEventSource
})

type RecoverImpl = (since: number, limit: number) => Promise<GapRecovery | null>

function makeConn(over: { storage?: any; recoverGap?: RecoverImpl } = {}) {
  const storage = over.storage === undefined ? fakeStorage() : over.storage
  const opens: Array<number | null> = []
  const resync: Array<{ reason: string; info: any }> = []
  const messages: string[] = []
  const recoverCalls: Array<[number, number]> = []
  let reconnects = 0
  const conn = new SseConnection({
    open: async (since) => {
      opens.push(since)
      return new FakeEventSource(withSince(BASE, since))
    },
    onOpen: () => {},
    onError: () => {},
    onMessage: (data) => { messages.push(data) },
    onFullResync: (reason, info) => resync.push({ reason, info }),
    onReconnect: () => { reconnects++ },
    storage,
    retryDelayMs: 1,
    recoverGap: over.recoverGap
      ? (since, limit) => {
          recoverCalls.push([since, limit])
          return over.recoverGap!(since, limit)
        }
      : undefined,
  })
  return { conn, storage, opens, resync, messages, recoverCalls, reconnects: () => reconnects }
}

describe("E6-1 SseConnection 补页成功", () => {
  test("有游标 → 先 recoverGap(42,500)，以 headSeq 开流并钉住 lastApplied", async () => {
    const { conn, opens, recoverCalls, resync, messages } = makeConn({
      storage: SEEDED(),
      recoverGap: async () => ({ headSeq: 50, applied: 8 }),
    })
    await conn.connect()

    expect(recoverCalls).toEqual([[42, 500]])
    expect(opens).toEqual([50])
    expect(FakeEventSource.instances[0].url).toBe(`${BASE}?since=50`)
    // 补页完成即已追平 → 不触发整表重同步
    conn.source!.fireOpen()
    expect(resync).toEqual([])

    // live 帧：seq ≤ headSeq 抑制（已由 replay 覆盖），> headSeq 应用
    conn.source!.fireMessage({ type: "chat", seq: 50 }, "50")
    expect(messages).toHaveLength(0)
    conn.source!.fireMessage({ type: "chat", seq: 51 }, "51")
    expect(messages).toHaveLength(1)

    conn.dispose()
  })

  test("补页成功仍触发 onReconnect（补拉活跃会话 part.delta）", async () => {
    const { conn, reconnects } = makeConn({
      storage: SEEDED(),
      recoverGap: async () => ({ headSeq: 50, applied: 8 }),
    })
    await conn.connect()
    conn.source!.fireOpen()
    expect(reconnects()).toBe(1)
    conn.dispose()
  })

  test("补页成功把持久化游标推进到 headSeq（与 lastAppliedSeq 对齐）", async () => {
    const { conn, storage } = makeConn({
      storage: SEEDED(),
      recoverGap: async () => ({ headSeq: 50, applied: 8 }),
    })
    await conn.connect()
    expect(storage.getItem(SSE_SEQ_KEY)).toBe("50")
    conn.dispose()
  })

  test("headSeq 低于 since 且无 reset/truncated → 回退原 since（游标倒挂）", async () => {
    const { conn, opens, resync, messages } = makeConn({
      storage: SEEDED(),
      recoverGap: async () => ({ headSeq: 40, applied: 0 }),
    })
    await conn.connect()
    expect(opens).toEqual([42])
    expect(resync).toEqual([])
    // lastApplied 未被拉到 40：43 仍应分发
    conn.source!.fireMessage({ type: "chat", seq: 43 }, "43")
    expect(messages).toHaveLength(1)
    conn.dispose()
  })
})

describe("E6-1 SseConnection 补页超时", () => {
  test("recoverEventGap + 永不 settle 的 fetch → 超时后以原 since 开流", async () => {
    const hanging = (() => new Promise<Response>(() => {})) as unknown as typeof fetch
    const { conn, opens, resync } = makeConn({
      storage: SEEDED(),
      recoverGap: (since, limit) => recoverEventGap({
        baseUrl: "http://gw:3000",
        since,
        limit,
        timeoutMs: 25,
        fetchImpl: hanging,
        dispatch: () => {},
      }),
    })
    await conn.connect()
    expect(opens).toEqual([42])
    expect(resync).toEqual([])
    conn.dispose()
  })
})

describe("E6-1 SseConnection reset / truncated", () => {
  test("reset → clearSeq + onFullResync(reset) + 以 headSeq 开流并落盘 headSeq", async () => {
    const { conn, storage, opens, resync } = makeConn({
      storage: SEEDED(),
      recoverGap: async () => ({ headSeq: 30, applied: 0, reset: true }),
    })
    await conn.connect()

    expect(resync.map((r) => r.reason)).toEqual(["reset"])
    expect(resync[0].info).toEqual({ headSeq: 30 })
    // E7-5：清旧游标后必须把新纪元的 headSeq 落盘——否则下一次冷启动
    // 又按「无游标」全量重同步一次。
    expect(storage.getItem(SSE_SEQ_KEY)).toBe("30")
    expect(opens).toEqual([30])
    // 首次 onopen（resumeFromSeq 非 null）不再重复 initial resync
    conn.source!.fireOpen()
    expect(resync.map((r) => r.reason)).toEqual(["reset"])
    conn.dispose()
  })

  test("truncated → clearSeq + onFullResync(truncated) + 以 headSeq 开流并落盘 headSeq", async () => {
    const { conn, storage, opens, resync } = makeConn({
      storage: SEEDED(),
      recoverGap: async () => ({ headSeq: 60, applied: 2, truncated: true }),
    })
    await conn.connect()
    expect(resync.map((r) => r.reason)).toEqual(["truncated"])
    expect(storage.getItem(SSE_SEQ_KEY)).toBe("60")
    expect(opens).toEqual([60])
    conn.dispose()
  })

  test("reset 后持久游标 = headSeq：下次冷启动只补新缺口，不再全量重同步", async () => {
    const storage = SEEDED()

    const first = makeConn({
      storage,
      recoverGap: async () => ({ headSeq: 30, applied: 0, reset: true }),
    })
    await first.conn.connect()
    first.conn.dispose()
    expect(storage.getItem(SSE_SEQ_KEY)).toBe("30")

    // 冷启动（新进程 / 新 manager 实例，storage 保留）。
    const second = makeConn({
      storage,
      recoverGap: async () => ({ headSeq: 35, applied: 5 }),
    })
    await second.conn.connect()

    expect(second.recoverCalls).toEqual([[30, 500]])
    expect(second.opens).toEqual([35])
    expect(second.resync).toEqual([])
    second.conn.dispose()
  })
})

describe("E6-1 SseConnection 回退旧路径", () => {
  test("recoverGap 返回 null → 原 since 开流，不重同步", async () => {
    const { conn, opens, recoverCalls, resync } = makeConn({
      storage: SEEDED(),
      recoverGap: async () => null,
    })
    await conn.connect()
    expect(recoverCalls).toEqual([[42, 500]])
    expect(opens).toEqual([42])
    expect(resync).toEqual([])
    conn.dispose()
  })

  test("recoverGap 抛错 → 原 since 开流", async () => {
    const { conn, opens, resync } = makeConn({
      storage: SEEDED(),
      recoverGap: async () => { throw new Error("network down") },
    })
    await conn.connect()
    expect(opens).toEqual([42])
    expect(resync).toEqual([])
    conn.dispose()
  })

  test("未注入 recoverGap → 行为不变（原 since）", async () => {
    const { conn, opens } = makeConn({ storage: SEEDED() })
    await conn.connect()
    expect(opens).toEqual([42])
    conn.dispose()
  })

  test("首次连接（无游标）绝不调用 recoverGap", async () => {
    const { conn, opens, recoverCalls, resync } = makeConn({
      recoverGap: async () => ({ headSeq: 50, applied: 3 }),
    })
    await conn.connect()
    expect(recoverCalls).toEqual([])
    expect(opens).toEqual([null])
    conn.source!.fireOpen()
    expect(resync.map((r) => r.reason)).toEqual(["initial"])
    conn.dispose()
  })
})

describe("E6-1 MafwShell 接线", () => {
  test("SseConnection 注入 recoverGap：gateway URL + 同一 dispatcher，缺 URL 回退 null", () => {
    const source = readFileSync(new URL("../src/renderer/mafw/MafwShell.tsx", import.meta.url), "utf8")
    expect(source).toMatch(/recoverGap: async \(since, limit\) => \{/)
    expect(source).toMatch(/if \(!info\?\.url\) return null/)
    expect(source).toMatch(/recoverEventGap\(\{/)
    expect(source).toMatch(/dispatch: \(event\) => dispatchShellEvent\(event, sseDeps\)/)
  })
})
