import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { SseConnection } from "../src/renderer/mafw/sse/sse-connection"

/**
 * E1-9：SSE 单例竞态（spec §E1-9 / A12）。
 *
 * 缺陷：`connectSse()` 在 `await gateway.info()` / `await event.url()` **之前**
 * 只检查 `if (es) return` —— 并发调用（onMount + gateway-ready 回调）会双开
 * EventSource 流。
 *
 * 契约：
 *  - 并发调用只创建 **1** 个 EventSource；
 *  - dispose() 关闭并清空，之后 connect 可重新建（重连语义保留）；
 *  - 打不开（open() → null）或致命关闭（CLOSED）走 retry 钩子。
 *
 * 说明：connectSse 是 MafwShell 组件闭包（Solid/JSX 重、依赖数十个 signal），
 * 直接挂载不现实 —— 按计划允许的路径把连接管理抽成 deps 注入的
 * `sse/sse-connection.ts`，MafwShell 改为持有该实例（行为逐字保留）。
 */

class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []

  readyState = FakeEventSource.OPEN
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.closed = true
    this.readyState = FakeEventSource.CLOSED
  }
}

const realEventSource = (globalThis as any).EventSource

beforeEach(() => {
  FakeEventSource.instances = []
  ;(globalThis as any).EventSource = FakeEventSource
})

afterEach(() => {
  if (realEventSource === undefined) delete (globalThis as any).EventSource
  else (globalThis as any).EventSource = realEventSource
})

function makeConnection(over: {
  open?: () => Promise<any>
  retryDelayMs?: number
} = {}) {
  const opened: string[] = []
  const retries: string[] = []
  const messages: string[] = []
  const conn = new SseConnection({
    open: over.open ?? (async () => {
      // 两次并发调用都在 await 后被唤醒 —— 还原真实竞态窗口。
      await Promise.resolve()
      return new FakeEventSource("http://gw:3000/api/events")
    }),
    onOpen: () => {},
    onError: () => {},
    onMessage: (data) => messages.push(data),
    onRetry: () => retries.push("retry"),
    retryDelayMs: over.retryDelayMs ?? 5000,
  })
  return { conn, opened, retries, messages }
}

describe("SseConnection 单例竞态（E1-9）", () => {
  test("并发 connect 只创建一个 EventSource", async () => {
    const { conn } = makeConnection()

    await Promise.all([conn.connect(), conn.connect()])

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(conn.source).toBe(FakeEventSource.instances[0])
    conn.dispose()
  })

  test("已连接后再次 connect 不重复创建", async () => {
    const { conn } = makeConnection()
    await conn.connect()
    await conn.connect()
    await Promise.all([conn.connect(), conn.connect()])
    expect(FakeEventSource.instances).toHaveLength(1)
    conn.dispose()
  })

  test("dispose 关闭并清空，之后 connect 可重建", async () => {
    const { conn } = makeConnection()
    await conn.connect()
    const first = FakeEventSource.instances[0]

    conn.dispose()
    expect(first.closed).toBe(true)
    expect(conn.source).toBeNull()

    await conn.connect()
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(conn.source).toBe(FakeEventSource.instances[1])
    conn.dispose()
  })

  test("open() 返回 null（gateway 未就绪）走 retry 钩子", async () => {
    let ready = false
    const { conn, retries } = makeConnection({
      open: async () => {
        await Promise.resolve()
        return ready ? new FakeEventSource("http://gw/api/events") : null
      },
      retryDelayMs: 1,
    })

    await conn.connect()
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(retries).toEqual(["retry"])

    ready = true
    await new Promise((r) => setTimeout(r, 20))
    expect(FakeEventSource.instances).toHaveLength(1)
    conn.dispose()
  })

  test("致命关闭（CLOSED）清空 source 并调度重连", async () => {
    const { conn, retries } = makeConnection({ retryDelayMs: 5000 })
    await conn.connect()
    const source = FakeEventSource.instances[0]

    source.readyState = FakeEventSource.CLOSED
    source.onerror!()

    expect(conn.source).toBeNull()
    expect(source.closed).toBe(true)
    expect(retries).toEqual(["retry"])
    conn.dispose()
  })

  test("onmessage 透传 data 字符串", async () => {
    const { conn, messages } = makeConnection()
    await conn.connect()
    FakeEventSource.instances[0].onmessage!({ data: '{"type":"connected"}' })
    expect(messages).toEqual(['{"type":"connected"}'])
    conn.dispose()
  })
})
