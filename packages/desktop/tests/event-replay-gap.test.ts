import { describe, expect, test } from "bun:test"
import { recoverEventGap } from "../src/renderer/mafw/sse/event-replay-gap"

/**
 * E6-1：SSE 开流前用 REST replay 补 `(persisted cursor, headSeq]`。
 *
 * 契约（spec 2026-11-13-gateway-e6-interaction-model §3.3）：
 *  - `GET {baseUrl}/api/events/replay?since=&limit=`，limit 缺省 500、clamp 1..1000；
 *  - 按 `hasMore` 逐页循环，每页事件 → `dispatch({ ...envelope, seq: item.seq })`；
 *  - `reset` / `truncated` 返回信号并停止（不再继续翻页）；
 *  - 404 / HTML / 503 / 非 ok / 网络异常 / 非法 JSON / 非法参数 → null（调用方回退旧路径）；
 *  - `nextSince` 必须单调前进，页数硬上限 100（不得无限循环）。
 */

const BASE = "http://gw:3000"

function page(over: Record<string, unknown> = {}) {
  return {
    events: [],
    headSeq: 0,
    oldestSeq: 0,
    hasMore: false,
    nextSince: 0,
    reset: false,
    truncated: false,
    ...over,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function makeFetch(pages: Array<Response | (() => Response | Promise<Response>)>) {
  const calls: string[] = []
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url))
    const next = pages.shift()
    if (!next) throw new Error("unexpected fetch")
    return typeof next === "function" ? await next() : next
  }) as typeof fetch
  return { calls, fetchImpl }
}

describe("E6-1 recoverEventGap 分页与 seq 注入", () => {
  test("按 hasMore 逐页拉取，dispatch 顺序与 envelope+seq 合并", async () => {
    const first = page({
      events: [
        { seq: 11, envelope: { type: "session.updated", properties: { id: "s1" } } },
        { seq: 12, envelope: { type: "chat", properties: {} } },
      ],
      headSeq: 20,
      hasMore: true,
      nextSince: 12,
    })
    const second = page({
      events: [
        // envelope 自带 seq 也必须被 item.seq 覆盖（seq 是 additive 权威）
        { seq: 13, envelope: { type: "chat", properties: { seq: 5 } } },
      ],
      headSeq: 20,
      hasMore: false,
      nextSince: 13,
    })
    const { calls, fetchImpl } = makeFetch([jsonResponse(first), jsonResponse(second)])
    const got: any[] = []

    const result = await recoverEventGap({
      baseUrl: BASE,
      since: 10,
      fetchImpl,
      dispatch: (event) => got.push(event),
    })

    expect(result).toEqual({ headSeq: 20, applied: 3 })
    expect(calls).toEqual([
      `${BASE}/api/events/replay?since=10&limit=500`,
      `${BASE}/api/events/replay?since=12&limit=500`,
    ])
    expect(got.map((e) => e.seq)).toEqual([11, 12, 13])
    expect(got.map((e) => e.type)).toEqual(["session.updated", "chat", "chat"])
    expect(got[0].properties).toEqual({ id: "s1" })
  })

  test("canonical mafw_event 信封 → 解包 data 后再 dispatch（与 live raw?.data 一致）", async () => {
    const { fetchImpl } = makeFetch([
      jsonResponse(page({
        events: [{
          seq: 21,
          // event_log 存的是 gateway broadcast 信封：{type:'mafw_event', data:{type:'session.updated'}}
          envelope: {
            type: "mafw_event",
            timestamp: "t",
            data: {
              type: "session.updated",
              properties: { sessionID: "ses_1", info: { id: "ses_1", title: "新标题" } },
              timestamp: "t",
            },
          },
        }],
        headSeq: 21,
        nextSince: 21,
      })),
    ])
    const got: any[] = []
    const result = await recoverEventGap({
      baseUrl: BASE,
      since: 20,
      fetchImpl,
      dispatch: (event) => got.push(event),
    })

    expect(result).toEqual({ headSeq: 21, applied: 1 })
    expect(got).toHaveLength(1)
    expect(got[0].type).toBe("session.updated")
    expect(got[0].seq).toBe(21)
    expect(got[0].properties).toEqual({ sessionID: "ses_1", info: { id: "ses_1", title: "新标题" } })
    // 包装层不得泄漏：没有 data 容器、没有 mafw_event
    expect(got[0].data).toBeUndefined()
  })

  test("扁平事件（type 非 mafw_event / data 非对象）保持原样 + seq", async () => {
    const { fetchImpl } = makeFetch([
      jsonResponse(page({
        events: [
          { seq: 31, envelope: { type: "chat", properties: { id: "p1" } } },
          // mafw_event 但 data 不是对象（插件数组/字符串通路）：不解包，退化为原信封
          { seq: 32, envelope: { type: "mafw_event", data: ["not", "an", "event"] } },
        ],
        headSeq: 32,
        nextSince: 32,
      })),
    ])
    const got: any[] = []
    await recoverEventGap({ baseUrl: BASE, since: 30, fetchImpl, dispatch: (e) => got.push(e) })

    expect(got[0]).toEqual({ type: "chat", properties: { id: "p1" }, seq: 31 })
    expect(got[1].type).toBe("mafw_event")
    expect(got[1].seq).toBe(32)
  })

  test("baseUrl 末尾斜杠不产生双斜杠", async () => {
    const { calls, fetchImpl } = makeFetch([
      jsonResponse(page({ headSeq: 9, nextSince: 9 })),
    ])
    await recoverEventGap({ baseUrl: `${BASE}/`, since: 8, fetchImpl, dispatch: () => {} })
    expect(calls[0]).toBe(`${BASE}/api/events/replay?since=8&limit=500`)
  })

  test("limit clamp 1..1000，非法值回到默认 500", async () => {
    for (const [input, expected] of [
      [5000, 1000],
      [0, 1],
      [-3, 1],
      [2.9, 2],
      [Number.NaN, 500],
    ] as const) {
      const { calls, fetchImpl } = makeFetch([
        jsonResponse(page({ headSeq: 9, since: 8, nextSince: 9 })),
      ])
      await recoverEventGap({
        baseUrl: BASE,
        since: 8,
        limit: input as number,
        fetchImpl,
        dispatch: () => {},
      })
      expect(calls[0]).toContain(`limit=${expected}`)
    }
  })
})

describe("E6-1 recoverEventGap reset / truncated / 失败回退", () => {
  test("reset → 返回 reset 信号并停止翻页", async () => {
    const { calls, fetchImpl } = makeFetch([
      jsonResponse(page({ headSeq: 30, nextSince: 30, reset: true, hasMore: true })),
    ])
    const got: unknown[] = []
    const result = await recoverEventGap({
      baseUrl: BASE,
      since: 99,
      fetchImpl,
      dispatch: (event) => got.push(event),
    })
    expect(result).toEqual({ headSeq: 30, applied: 0, reset: true })
    expect(calls).toHaveLength(1)
    expect(got).toHaveLength(0)
  })

  test("truncated → 返回 truncated 信号并停止翻页（保留已 dispatch 的行）", async () => {
    const { calls, fetchImpl } = makeFetch([
      jsonResponse(page({
        events: [{ seq: 41, envelope: { type: "chat" } }],
        headSeq: 60,
        hasMore: true,
        nextSince: 41,
        truncated: true,
      })),
    ])
    const got: any[] = []
    const result = await recoverEventGap({
      baseUrl: BASE,
      since: 40,
      fetchImpl,
      dispatch: (event) => got.push(event),
    })
    expect(result).toEqual({ headSeq: 60, applied: 1, truncated: true })
    expect(got.map((e) => e.seq)).toEqual([41])
    expect(calls).toHaveLength(1)
  })

  test("404 / 503 / 非 ok → null", async () => {
    for (const status of [404, 503, 500]) {
      const { fetchImpl } = makeFetch([jsonResponse({ error: "nope" }, status)])
      const result = await recoverEventGap({
        baseUrl: BASE,
        since: 10,
        fetchImpl,
        dispatch: () => {},
      })
      expect(result).toBeNull()
    }
  })

  test("HTML 响应（旧网关/代理页）→ null", async () => {
    const { fetchImpl } = makeFetch([
      new Response("<!DOCTYPE html><html><body>not here</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ])
    const result = await recoverEventGap({
      baseUrl: BASE,
      since: 10,
      fetchImpl,
      dispatch: () => {},
    })
    expect(result).toBeNull()
  })

  test("网络异常 / 非法 JSON / 形状不符 → null", async () => {
    const throwing = (async () => { throw new Error("boom") }) as unknown as typeof fetch
    expect(await recoverEventGap({ baseUrl: BASE, since: 10, fetchImpl: throwing, dispatch: () => {} })).toBeNull()

    const badJson = (async () => new Response("not-json", { status: 200 })) as unknown as typeof fetch
    expect(await recoverEventGap({ baseUrl: BASE, since: 10, fetchImpl: badJson, dispatch: () => {} })).toBeNull()

    const badShape = (async () => jsonResponse({ events: "nope", headSeq: 1 })) as unknown as typeof fetch
    expect(await recoverEventGap({ baseUrl: BASE, since: 10, fetchImpl: badShape, dispatch: () => {} })).toBeNull()
  })

  test("非法参数（since 负数/非整数/非数字、空 baseUrl）→ null 且不发请求", async () => {
    let called = 0
    const fetchImpl = (async () => { called++; return jsonResponse(page()) }) as unknown as typeof fetch
    for (const since of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await recoverEventGap({ baseUrl: BASE, since, fetchImpl, dispatch: () => {} })).toBeNull()
    }
    expect(await recoverEventGap({ baseUrl: "", since: 1, fetchImpl, dispatch: () => {} })).toBeNull()
    expect(called).toBe(0)
  })
})

describe("E6-1 recoverEventGap 循环守卫", () => {
  test("nextSince 不前进 → 立即失败（不无限循环）", async () => {
    const same = () => jsonResponse(page({ headSeq: 100, hasMore: true, nextSince: 10 }))
    const { calls, fetchImpl } = makeFetch([same, same, same])
    const result = await recoverEventGap({
      baseUrl: BASE,
      since: 10,
      fetchImpl,
      dispatch: () => {},
    })
    expect(result).toBeNull()
    expect(calls.length).toBeLessThanOrEqual(2)
  })

  test("页数硬上限 100（服务器永远 hasMore）", async () => {
    const pages: Array<() => Response> = []
    for (let i = 1; i <= 150; i++) {
      pages.push(() => jsonResponse(page({
        events: [{ seq: 10 + i, envelope: { type: "chat" } }],
        headSeq: 1000,
        hasMore: true,
        nextSince: 10 + i,
      })))
    }
    const { calls, fetchImpl } = makeFetch(pages)
    const result = await recoverEventGap({
      baseUrl: BASE,
      since: 10,
      fetchImpl,
      dispatch: () => {},
    })
    expect(result).toBeNull()
    expect(calls).toHaveLength(100)
  })

  test("正常追平（hasMore:false）不触发页数上限", async () => {
    const pages: Array<() => Response> = []
    for (let i = 1; i <= 3; i++) {
      pages.push(() => jsonResponse(page({
        events: [{ seq: 100 + i, envelope: { type: "chat" } }],
        headSeq: 200,
        hasMore: i < 3,
        nextSince: 100 + i,
      })))
    }
    const { calls, fetchImpl } = makeFetch(pages)
    const got: any[] = []
    const result = await recoverEventGap({
      baseUrl: BASE,
      since: 100,
      fetchImpl,
      dispatch: (e) => got.push(e),
    })
    expect(result).toEqual({ headSeq: 200, applied: 3 })
    expect(calls).toHaveLength(3)
    expect(got.map((e) => e.seq)).toEqual([101, 102, 103])
  })
})

describe("E6-1 recoverEventGap 超时与游标倒挂", () => {
  test("fetch 永不 settle → timeout 后返回 null（AbortSignal 被触发）", async () => {
    let signal: AbortSignal | undefined
    const hanging = ((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    }) as unknown as typeof fetch

    const startedAt = Date.now()
    const result = await recoverEventGap({
      baseUrl: BASE,
      since: 10,
      timeoutMs: 20,
      fetchImpl: hanging,
      dispatch: () => {},
    })
    const elapsed = Date.now() - startedAt

    expect(result).toBeNull()
    expect(elapsed).toBeLessThan(2000)
    expect(signal?.aborted).toBe(true)
  })

  test("响应头已到但 body 卡住 → 同一个超时预算兜底", async () => {
    const stalling = (async () => ({
      ok: true,
      json: () => new Promise(() => {}),
    })) as unknown as typeof fetch

    const startedAt = Date.now()
    const result = await recoverEventGap({
      baseUrl: BASE,
      since: 10,
      timeoutMs: 20,
      fetchImpl: stalling,
      dispatch: () => {},
    })
    expect(result).toBeNull()
    expect(Date.now() - startedAt).toBeLessThan(2000)
  })

  test("headSeq 低于 since 且无 reset/truncated → null（游标倒挂回退）", async () => {
    const { fetchImpl } = makeFetch([
      jsonResponse(page({ events: [], headSeq: 40, nextSince: 40 })),
    ])
    const result = await recoverEventGap({
      baseUrl: BASE,
      since: 42,
      fetchImpl,
      dispatch: () => {},
    })
    expect(result).toBeNull()
  })

  test("reset 允许 headSeq 低于 since（新纪元）", async () => {
    const { fetchImpl } = makeFetch([
      jsonResponse(page({ headSeq: 5, nextSince: 5, reset: true })),
    ])
    const result = await recoverEventGap({
      baseUrl: BASE,
      since: 42,
      fetchImpl,
      dispatch: () => {},
    })
    expect(result).toEqual({ headSeq: 5, applied: 0, reset: true })
  })
})
