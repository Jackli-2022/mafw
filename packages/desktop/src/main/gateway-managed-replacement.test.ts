import { describe, expect, test } from "bun:test"
import { stopRegisteredReplacement } from "./gateway-managed-replacement"
import type { GatewayInstanceRecord } from "./gateway-instance-record"

const record: GatewayInstanceRecord = {
  instanceId: "old-instance",
  pid: 4242,
  channel: "prod",
  gatewayVersion: "5.1.0",
  schemaEpoch: 1,
  startedAt: "2026-11-09T00:00:00.000Z",
  nonce: "nonce",
}

describe("stopRegisteredReplacement", () => {
  test("adopts the probed registration before terminating so restart recovery can kill it", async () => {
    const calls: string[] = []
    await stopRegisteredReplacement({
      registered: record,
      adopt: (value) => calls.push(`adopt:${value.instanceId}`),
      terminate: async () => {
        calls.push("terminate")
      },
    })
    expect(calls).toEqual(["adopt:old-instance", "terminate"])
  })

  test("terminates the current child when there is no probed registration", async () => {
    const calls: string[] = []
    await stopRegisteredReplacement({
      registered: null,
      adopt: () => calls.push("adopt"),
      terminate: async () => {
        calls.push("terminate")
      },
    })
    expect(calls).toEqual(["terminate"])
  })
})
