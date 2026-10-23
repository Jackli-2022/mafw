import { describe, expect, test } from "bun:test"
import { handleQueueEvent } from "./queue"

function deps() {
  const traces: string[] = []
  return {
    deps: { core: { trace: (_e: any, channel: string) => traces.push(channel) } } as any,
    traces,
  }
}

describe("handleQueueEvent", () => {
  test("queue.updated 被消费并留 trace", () => {
    const { deps: d, traces } = deps()
    expect(handleQueueEvent({ type: "queue.updated", properties: { sessionID: "s1" } }, "s1", d)).toBe(true)
    expect(traces).toEqual(["chat:queue"])
  })

  test("其他事件透传", () => {
    const { deps: d } = deps()
    expect(handleQueueEvent({ type: "part.updated" }, "s1", d)).toBe(false)
  })
})
