import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  gatewayDiscoveryPath,
  isGatewayDiscoveryFresh,
  publishGatewayDiscovery,
  readGatewayDiscovery,
} from "../../../src/runtime/gateway-discovery"

async function makeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mafw-discovery-"))
}

function input(overrides: Record<string, unknown> = {}) {
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
    now: () => 1_000_000,
    ...overrides,
  }
}

describe("gateway discovery", () => {
  let dir: string

  beforeEach(async () => {
    dir = await makeDir()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("publish writes a readable record with the actual port", async () => {
    const handle = await publishGatewayDiscovery(input(), dir)
    expect(handle.record.port).toBe(3000)

    expect(await readGatewayDiscovery(dir)).toEqual({
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
      startedAt: new Date(1_000_000).toISOString(),
      heartbeatAt: new Date(1_000_000).toISOString(),
    })
  })

  test("publish is atomic and leaves no temporary files", async () => {
    await publishGatewayDiscovery(input(), dir)
    expect(await readdir(dir)).toEqual(["gateway.json"])
    expect(JSON.parse(await readFile(gatewayDiscoveryPath(dir), "utf8")).instanceId).toBe("instance-1")
  })

  test("heartbeat refreshes the lease", async () => {
    const handle = await publishGatewayDiscovery(input(), dir)
    await handle.heartbeat(new Date(1_005_000))
    expect((await readGatewayDiscovery(dir))?.heartbeatAt).toBe(new Date(1_005_000).toISOString())
  })

  test("fresh/stale is decided from the heartbeat", async () => {
    const record = (await publishGatewayDiscovery(input(), dir)).record
    expect(isGatewayDiscoveryFresh(record, 1_010_000, 30_000)).toBe(true)
    expect(isGatewayDiscoveryFresh(record, 1_031_000, 30_000)).toBe(false)
  })

  test("release removes only its own record", async () => {
    const first = await publishGatewayDiscovery(input(), dir)
    const second = await publishGatewayDiscovery(input({ instanceId: "instance-2" }), dir)

    await first.release()
    expect((await readGatewayDiscovery(dir))?.instanceId).toBe("instance-2")

    await second.release()
    expect(await readGatewayDiscovery(dir)).toBeNull()
  })

  test("a displaced publisher cannot heartbeat or release the new record", async () => {
    const first = await publishGatewayDiscovery(input(), dir)
    await publishGatewayDiscovery(input({ instanceId: "instance-2" }), dir)

    await expect(first.heartbeat(new Date(2_000_000))).rejects.toThrow("taken over")
    await first.release()
    expect((await readGatewayDiscovery(dir))?.instanceId).toBe("instance-2")
  })

  test("a corrupt discovery file reads as missing", async () => {
    await writeFile(gatewayDiscoveryPath(dir), "{not json", "utf8")
    expect(await readGatewayDiscovery(dir)).toBeNull()
  })

  test("a record with an invalid port is rejected", async () => {
    await writeFile(gatewayDiscoveryPath(dir), JSON.stringify({
      instanceId: "instance-1",
      pid: 4321,
      port: 0,
      gatewayVersion: "5.2.0",
      experienceVersion: "2026.11.1",
      minimumClientExperienceVersion: "2026.11.0",
      schemaEpoch: 1,
      channel: "dev",
      distribution: "desktop-managed",
      origin: "desktop-dev",
      startedAt: new Date(1_000_000).toISOString(),
      heartbeatAt: new Date(1_000_000).toISOString(),
    }), "utf8")
    expect(await readGatewayDiscovery(dir)).toBeNull()
  })
})
