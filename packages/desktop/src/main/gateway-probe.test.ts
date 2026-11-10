import { describe, expect, test } from "bun:test"
import type { GatewayHealthSnapshot } from "./gateway-handshake"
import type { GatewayDiscoveryRecord } from "./gateway-discovery"
import { healthMatchesDiscovery, probeGateway } from "./gateway-probe"

const now = 1_000_000

const discovery: GatewayDiscoveryRecord = {
  instanceId: "instance-1",
  pid: 4321,
  port: 3010,
  gatewayVersion: "5.2.0",
  experienceVersion: "2026.11.1",
  minimumClientExperienceVersion: "2026.11.0",
  schemaEpoch: 1,
  channel: "dev",
  distribution: "desktop-managed",
  origin: "desktop-dev",
  startedAt: new Date(now).toISOString(),
  heartbeatAt: new Date(now).toISOString(),
}

const health: GatewayHealthSnapshot = {
  status: "ok",
  pid: 4321,
  instanceId: "instance-1",
  gatewayVersion: "5.2.0",
  experienceVersion: "2026.11.1",
  minimumClientExperienceVersion: "2026.11.0",
  schemaEpoch: 1,
  channel: "dev",
  distribution: "desktop-managed",
}

function deps(overrides: Partial<Parameters<typeof probeGateway>[0]> = {}) {
  return {
    readDiscovery: async () => discovery,
    readHealth: async (url: string) => url.endsWith(":3010") ? health : null,
    readLegacyRecords: async () => [],
    tcpReachable: async () => false,
    now: () => now,
    ...overrides,
  }
}

describe("probeGateway", () => {
  test("uses the discovery port and synthesizes the managed record", async () => {
    const result = await probeGateway(deps())
    expect(result.kind).toBe("gateway")
    if (result.kind !== "gateway") return
    expect(result.port).toBe(3010)
    expect(result.discovery?.instanceId).toBe("instance-1")
    expect(result.managedInstance?.instanceId).toBe("instance-1")
  })

  test("a standalone discovery has no managed record", async () => {
    const result = await probeGateway(deps({
      readDiscovery: async () => ({ ...discovery, distribution: "standalone", origin: "standalone" }),
    }))
    expect(result.kind).toBe("gateway")
    if (result.kind !== "gateway") return
    expect(result.managedInstance).toBeNull()
  })

  test("a stale discovery falls back to the legacy port", async () => {
    const result = await probeGateway(deps({
      readDiscovery: async () => ({ ...discovery, heartbeatAt: new Date(now - 60_000).toISOString() }),
      readHealth: async (url: string) => url.endsWith(":3000") ? { ...health, pid: 1111, instanceId: "legacy" } : health,
    }))
    expect(result.kind).toBe("gateway")
    if (result.kind !== "gateway") return
    expect(result.port).toBe(3000)
    expect(result.discovery).toBeNull()
  })

  test("a discovery identity mismatch is not accepted as a gateway", async () => {
    const result = await probeGateway(deps({
      readHealth: async (url: string) => url.endsWith(":3010")
        ? null
        : { ...health, pid: 1111, instanceId: "other" },
    }))
    expect(result.kind).toBe("gateway")
    if (result.kind !== "gateway") return
    expect(result.port).toBe(3000)
    expect(result.discovery).toBeNull()
  })

  test("legacy registration is used when the discovery file is absent", async () => {
    const result = await probeGateway(deps({
      readDiscovery: async () => null,
      readHealth: async (url: string) => url.endsWith(":3000") ? health : null,
      readLegacyRecords: async () => [{
        instanceId: "instance-1",
        pid: 4321,
        channel: "dev",
        gatewayVersion: "5.2.0",
        schemaEpoch: 1,
        startedAt: new Date(now).toISOString(),
        nonce: "legacy",
      }],
    }))
    expect(result.kind).toBe("gateway")
    if (result.kind !== "gateway") return
    expect(result.managedInstance?.nonce).toBe("legacy")
  })

  test("reports a non-gateway port conflict", async () => {
    const result = await probeGateway(deps({
      readDiscovery: async () => null,
      readHealth: async () => null,
      tcpReachable: async () => true,
    }))
    expect(result.kind).toBe("port-conflict")
  })

  test("reports none when nothing answers", async () => {
    const result = await probeGateway(deps({
      readDiscovery: async () => null,
      readHealth: async () => null,
    }))
    expect(result.kind).toBe("none")
  })
})

describe("healthMatchesDiscovery", () => {
  test("requires both pid and instance identity", () => {
    expect(healthMatchesDiscovery(health, discovery)).toBe(true)
    expect(healthMatchesDiscovery({ ...health, pid: 1 }, discovery)).toBe(false)
    expect(healthMatchesDiscovery({ ...health, instanceId: "x" }, discovery)).toBe(false)
  })
})
