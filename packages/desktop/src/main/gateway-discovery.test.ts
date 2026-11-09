import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  gatewayDiscoveryPath,
  isGatewayDiscoveryFresh,
  parseGatewayDiscovery,
  readGatewayDiscovery,
  readGatewayDiscoverySync,
} from "./gateway-discovery"

const now = 1_000_000

function record(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: "instance-1",
    pid: 4321,
    port: 3000,
    gatewayVersion: "5.2.0",
    experienceVersion: "2026.11.1",
    minimumClientExperienceVersion: "2026.11.0",
    schemaEpoch: 1,
    channel: "dev",
    distribution: "desktop-managed",
    origin: "desktop-dev",
    startedAt: new Date(now).toISOString(),
    heartbeatAt: new Date(now).toISOString(),
    ...overrides,
  }
}

describe("desktop gateway discovery", () => {
  test("parses a valid record", () => {
    expect(parseGatewayDiscovery(record())?.port).toBe(3000)
  })

  test("rejects missing identity, bad ports and bad timestamps", () => {
    expect(parseGatewayDiscovery(record({ instanceId: "" }))).toBeNull()
    expect(parseGatewayDiscovery(record({ port: 0 }))).toBeNull()
    expect(parseGatewayDiscovery(record({ pid: 0 }))).toBeNull()
    expect(parseGatewayDiscovery(record({ schemaEpoch: 0 }))).toBeNull()
    expect(parseGatewayDiscovery(record({ heartbeatAt: "not-a-date" }))).toBeNull()
    expect(parseGatewayDiscovery(null)).toBeNull()
  })

  test("freshness follows the heartbeat", () => {
    const parsed = parseGatewayDiscovery(record())!
    expect(isGatewayDiscoveryFresh(parsed, now + 10_000, 30_000)).toBe(true)
    expect(isGatewayDiscoveryFresh(parsed, now + 31_000, 30_000)).toBe(false)
  })

  test("missing and corrupt files read as null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mafw-desktop-discovery-"))
    try {
      expect(await readGatewayDiscovery(dir)).toBeNull()
      await writeFile(gatewayDiscoveryPath(dir), "{not json", "utf8")
      expect(await readGatewayDiscovery(dir)).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reads a published record from the runtime directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mafw-desktop-discovery-"))
    try {
      await writeFile(gatewayDiscoveryPath(dir), JSON.stringify(record()), "utf8")
      expect(await readGatewayDiscovery(dir)).toMatchObject({ instanceId: "instance-1", port: 3000 })
      expect(readGatewayDiscoverySync(dir)).toMatchObject({ instanceId: "instance-1", port: 3000 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
