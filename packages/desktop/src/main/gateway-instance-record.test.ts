import { describe, expect, test } from "bun:test"
import { parseGatewayInstanceRecord } from "./gateway-instance-record"

describe("parseGatewayInstanceRecord", () => {
  test("accepts a complete managed instance record", () => {
    expect(parseGatewayInstanceRecord({
      instanceId: "instance-1",
      pid: 4242,
      channel: "prod",
      gatewayVersion: "5.2.0",
      schemaEpoch: 1,
      startedAt: "2026-11-09T00:00:00.000Z",
      nonce: "nonce-1",
    })).toEqual({
      instanceId: "instance-1",
      pid: 4242,
      channel: "prod",
      gatewayVersion: "5.2.0",
      schemaEpoch: 1,
      startedAt: "2026-11-09T00:00:00.000Z",
      nonce: "nonce-1",
    })
  })

  test("rejects malformed and partial records", () => {
    expect(parseGatewayInstanceRecord(null)).toBeNull()
    expect(parseGatewayInstanceRecord({})).toBeNull()
    expect(parseGatewayInstanceRecord({ instanceId: "x", pid: 0 })).toBeNull()
  })
})
