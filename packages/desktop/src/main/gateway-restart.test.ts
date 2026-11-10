import { describe, expect, test } from "bun:test"
import { decideLocalBuildRestart } from "./gateway-restart"
import type { GatewayDiscoveryRecord } from "./gateway-discovery"
import type { GatewayHealthSnapshot } from "./gateway-handshake"

const now = 1_000_000
const discovery: GatewayDiscoveryRecord = {
  instanceId: "instance-1",
  pid: 4321,
  port: 3000,
  gatewayVersion: "5.2.0",
  experienceVersion: "2026.11.1",
  minimumClientExperienceVersion: "2026.11.0",
  schemaEpoch: 1,
  channel: "dev",
  distribution: "standalone",
  origin: "standalone",
  startedAt: new Date(now).toISOString(),
  heartbeatAt: new Date(now).toISOString(),
}
const health: GatewayHealthSnapshot = {
  status: "ok",
  pid: 4321,
  instanceId: "instance-1",
  gatewayVersion: "5.2.0",
  schemaEpoch: 1,
}

describe("decideLocalBuildRestart", () => {
  test("allows a matching live discovery record", () => {
    expect(decideLocalBuildRestart({ state: "ready", discovery, health, now })).toEqual({
      allowed: true,
      reason: "ok",
      hint: null,
    })
  })

  test("allows a restart while the version conflict is visible", () => {
    expect(decideLocalBuildRestart({ state: "conflict", discovery, health, now }).allowed).toBe(true)
  })

  test("refuses while the gateway is starting", () => {
    const decision = decideLocalBuildRestart({ state: "starting", discovery, health, now })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("starting")
  })

  test("refuses a legacy gateway without discovery", () => {
    const decision = decideLocalBuildRestart({ state: "ready", discovery: null, health, now })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("no-discovery")
    expect(decision.hint).toContain("mafw")
  })

  test("refuses a stale discovery file", () => {
    const decision = decideLocalBuildRestart({
      state: "ready",
      discovery: { ...discovery, heartbeatAt: new Date(now - 60_000).toISOString() },
      health,
      now,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("stale-discovery")
  })

  test("refuses when /health belongs to another process", () => {
    expect(decideLocalBuildRestart({
      state: "ready",
      discovery,
      health: { ...health, pid: 9999 },
      now,
    }).reason).toBe("identity-mismatch")
    expect(decideLocalBuildRestart({
      state: "ready",
      discovery,
      health: { ...health, instanceId: "other" },
      now,
    }).reason).toBe("identity-mismatch")
    expect(decideLocalBuildRestart({
      state: "ready",
      discovery,
      health: null,
      now,
    }).reason).toBe("identity-mismatch")
  })
})
