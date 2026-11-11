import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { SseConnection, withSince, SSE_SEQ_KEY, SSE_INSTANCE_KEY } from "../src/renderer/mafw/sse/sse-connection"

/**
 * E2-3：desktop 可恢复 SSE + 分级重同步（spec 2026-11-11-gateway-e2-recovery §3 E2-3）。
 *
 * 缺陷：每次重连都是全量重拉（列表 invalidate + 丢掉游标）；`part.delta` 不入
 * journal，所以「游标完美回放」仍然不足以恢复活跃会话的实时文本（B2）。
 *
 * 契约：
 *  (a) 持久化 seq → 重连带 `?since=`；只有带 `id:` 的帧推进游标；
 *  (b) greeting truncated → 全量重同步；干净的 resume → 不 invalidate；
 *  (c) greeting reset / instanceId 变化 → 全量重同步 + 清游标；
 *  (d) 每次重连 → 强制刷新活跃会话（不依赖消息桶是否为空）；
 *  (e) 首次连接（无持久 seq）→ 无 since、无会话强制刷新。
 *
 * 驱动真实的 SseConnection 模块，只替换 EventSource / storage。
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
    dump: () => Object.fromEntries(map),
  }
}

const realEventSource = (globalThis as any).EventSource
const BASE = "http://gw:3000/api/events"

beforeEach(() => {
  FakeEventSource.instances = []
  ;(globalThis as any).EventSource = FakeEventSource
})

afterEach(() => {
  if (realEventSource === undefined) delete (globalThis as any).EventSource
  else (globalThis as any).EventSource = realEventSource
})

function makeConn(over: { storage?: any } = {}) {
  const storage = over.storage === undefined ? fakeStorage() : over.storage
  const opens: Array<number | null> = []
  const resync: string[] = []
  let reconnects = 0
  const conn = new SseConnection({
    open: async (since) => {
      opens.push(since)
      return new FakeEventSource(withSince(BASE, since))
    },
    onOpen: () => {},
    onError: () => {},
    onMessage: () => {},
    onFullResync: (reason) => resync.push(reason),
    onReconnect: () => { reconnects++ },
    storage,
    retryDelayMs: 1,
  })
  return { conn, storage, opens, resync, reconnects: () => reconnects }
}

const GREETING = (over: Record<string, unknown> = {}) =>
  ({ type: "connected", timestamp: "t", vocab: "v2", headSeq: 50, ...over })

describe("E2-3 cursor persistence（a）", () => {
  test("持久化 seq 42 → 重连带 since=42", async () => {
    const storage = fakeStorage({ [SSE_SEQ_KEY]: "42", [SSE_INSTANCE_KEY]: "inst-A" })
    const { conn, opens } = makeConn({ storage })
    await conn.connect()
    expect(opens).toEqual([42])
    expect(FakeEventSource.instances[0].url).toBe(`${BASE}?since=42`)
    conn.dispose()
  })

  test("带 id: 的帧写回 localStorage；greeting 不写", async () => {
    const storage = fakeStorage({ [SSE_SEQ_KEY]: "42", [SSE_INSTANCE_KEY]: "inst-A" })
    const { conn } = makeConn({ storage })
    await conn.connect()
    const es = FakeEventSource.instances[0]
    es.fireOpen()

    es.fireMessage(GREETING({ instanceId: "inst-A" }))
    expect(storage.getItem(SSE_SEQ_KEY)).toBe("42")

    es.fireMessage({ type: "chat", content: "hi" }, "43")
    expect(storage.getItem(SSE_SEQ_KEY)).toBe("43")

    // 无 id 帧 / 非数字 id 不推进
    es.fireMessage({ type: "chat", content: "again" })
    es.fireMessage({ type: "chat" }, "garbage")
    expect(storage.getItem(SSE_SEQ_KEY)).toBe("43")
    conn.dispose()
  })

  test("withSince 对已有 query 用 & 追加", () => {
    expect(withSince(`${BASE}?sessionID=x`, 7)).toBe(`${BASE}?sessionID=x&since=7`)
    expect(withSince(BASE, null)).toBe(BASE)
  })
})

describe("E2-3 greeting grading（b/c）", () => {
  test("truncated:true → 全量重同步；干净 resume → 不重同步", async () => {
    const clean = makeConn({ storage: fakeStorage({ [SSE_SEQ_KEY]: "42", [SSE_INSTANCE_KEY]: "inst-A" }) })
    await clean.conn.connect()
    clean.conn.source!.fireOpen()
    clean.conn.source!.fireMessage(GREETING({ instanceId: "inst-A" }))
    expect(clean.resync).toEqual([])
    clean.conn.dispose()

    const hole = makeConn({ storage: fakeStorage({ [SSE_SEQ_KEY]: "42", [SSE_INSTANCE_KEY]: "inst-A" }) })
    await hole.conn.connect()
    hole.conn.source!.fireOpen()
    hole.conn.source!.fireMessage(GREETING({ instanceId: "inst-A", firstReplayedSeq: 100, truncated: true }))
    expect(hole.resync).toEqual(["truncated"])
    expect(hole.storage.getItem(SSE_SEQ_KEY)).toBe("42") // truncated 不清游标（回放已推进到新 head）
    hole.conn.dispose()
  })

  test("reset:true → 全量重同步并清游标", async () => {
    const { conn, storage, resync } = makeConn({ storage: fakeStorage({ [SSE_SEQ_KEY]: "42", [SSE_INSTANCE_KEY]: "inst-A" }) })
    await conn.connect()
    conn.source!.fireOpen()
    conn.source!.fireMessage(GREETING({ instanceId: "inst-A", reset: true }))
    expect(resync).toEqual(["reset"])
    expect(storage.getItem(SSE_SEQ_KEY)).toBeNull()
    conn.dispose()
  })

  test("instanceId 变化 → 全量重同步并清游标", async () => {
    const { conn, storage, resync } = makeConn({ storage: fakeStorage({ [SSE_SEQ_KEY]: "42", [SSE_INSTANCE_KEY]: "inst-A" }) })
    await conn.connect()
    conn.source!.fireOpen()
    conn.source!.fireMessage(GREETING({ instanceId: "inst-B" }))
    expect(resync).toEqual(["instance"])
    expect(storage.getItem(SSE_SEQ_KEY)).toBeNull()
    expect(storage.getItem(SSE_INSTANCE_KEY)).toBe("inst-B")
    conn.dispose()
  })

  test("网关 greeting 缺 instanceId（旧版本）而本地有实例 → 保守整表重同步", async () => {
    const { conn, resync } = makeConn({ storage: fakeStorage({ [SSE_SEQ_KEY]: "42", [SSE_INSTANCE_KEY]: "inst-A" }) })
    await conn.connect()
    conn.source!.fireOpen()
    conn.source!.fireMessage(GREETING())
    expect(resync).toEqual(["instance"])
    conn.dispose()
  })
})

describe("E2-3 重连会话补拉（d/e）", () => {
  test("首次连接（无持久 seq）→ 无 since、无会话强制刷新，走 initial 全量", async () => {
    const { conn, opens, resync, reconnects } = makeConn()
    await conn.connect()
    conn.source!.fireOpen()
    expect(opens).toEqual([null])
    expect(FakeEventSource.instances[0].url).toBe(BASE)
    expect(resync).toEqual(["initial"])
    expect(reconnects()).toBe(0)
    conn.dispose()
  })

  test("重连（致命关闭后重试）→ onReconnect 被调（强制补拉活跃会话）", async () => {
    const { conn, reconnects } = makeConn()
    await conn.connect()
    const first = FakeEventSource.instances[0]
    first.fireOpen()
    expect(reconnects()).toBe(0)

    first.readyState = FakeEventSource.CLOSED
    first.onerror!()
    await new Promise((r) => setTimeout(r, 20))

    expect(FakeEventSource.instances).toHaveLength(2)
    FakeEventSource.instances[1].fireOpen()
    expect(reconnects()).toBe(1)
    conn.dispose()
  })

  test("无 localStorage（storage:null）→ 行为退化为现状，不抛错", async () => {
    const { conn, opens } = makeConn({ storage: null })
    await conn.connect()
    conn.source!.fireOpen()
    conn.source!.fireMessage({ type: "chat" }, "9") // 无 storage：静默忽略
    expect(opens).toEqual([null])
    expect(conn.source!.url).toBe(BASE)
    conn.dispose()
  })
})
