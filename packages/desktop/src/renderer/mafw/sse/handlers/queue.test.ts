import { describe, expect, test } from "bun:test"
import { handleQueueEvent } from "./queue"

function deps() {
  const traces: string[] = []
  const queueEvents: any[] = []
  return {
    deps: {
      core: { trace: (_e: any, channel: string) => traces.push(channel) },
      queue: { onEvent: (sid: string, ev: any) => queueEvents.push({ sid, ev }) },
    } as any,
    traces,
    queueEvents,
  }
}

describe("handleQueueEvent", () => {
  test("queue.updated 被消费并留 trace，同时交给 queue store", () => {
    const { deps: d, traces, queueEvents } = deps()
    const event = { type: "queue.updated", properties: { sessionID: "s1" } }
    expect(handleQueueEvent(event as any, "s1", d)).toBe(true)
    expect(traces).toEqual(["chat:queue"])
    expect(queueEvents).toEqual([{ sid: "s1", ev: event }])
  })

  test("其他事件透传", () => {
    const { deps: d } = deps()
    expect(handleQueueEvent({ type: "part.updated" }, "s1", d)).toBe(false)
  })
})
