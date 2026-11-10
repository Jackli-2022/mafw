import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireInstanceLock, type InstanceLock } from "../../../src/runtime/instance-lock"
import { publishGatewayDiscovery } from "../../../src/runtime/gateway-discovery"
import { claimGatewayInstance } from "../../../src/runtime/instance-ownership"

async function makeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mafw-ownership-"))
}

async function holdLock(dir: string, nonce = "holder"): Promise<InstanceLock> {
  const result = await acquireInstanceLock({
    dir,
    pid: 1111,
    processStartTime: Date.now() - 1_000,
    now: Date.now,
    isProcessAlive: () => true,
    nonce,
    settleMs: 0,
  })
  if (!result.ok) throw new Error(`failed to hold lock: ${result.reason}`)
  return result.lock
}

function contender(overrides: Record<string, unknown> = {}) {
  return {
    pid: 2222,
    processStartTime: Date.now() - 1_000,
    now: Date.now,
    isProcessAlive: () => true,
    nonce: "contender",
    settleMs: 0,
    ...overrides,
  }
}

async function publish(dir: string, instanceId = "holder") {
  return publishGatewayDiscovery({
    instanceId,
    pid: 1111,
    port: 3000,
    gatewayVersion: "5.2.0",
    experienceVersion: "2026.11.1",
    minimumClientExperienceVersion: "2026.11.0",
    schemaEpoch: 1,
    channel: "dev",
    distribution: "standalone",
    origin: "standalone",
  }, dir)
}

describe("claimGatewayInstance", () => {
  let dir: string

  beforeEach(async () => {
    dir = await makeDir()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("claims a free runtime directory", async () => {
    const result = await claimGatewayInstance({ runtimeDir: dir, lock: contender() })
    expect(result.kind).toBe("owner")
    if (result.kind === "owner") await result.lock.release()
  })

  test("defers to a published holder", async () => {
    const lock = await holdLock(dir)
    await publish(dir)

    const result = await claimGatewayInstance({ runtimeDir: dir, lock: contender() })
    expect(result.kind).toBe("deferred")
    if (result.kind === "deferred") expect(result.holder?.instanceId).toBe("holder")

    await lock.release()
  })

  test("waits briefly for a starting holder to publish discovery", async () => {
    const lock = await holdLock(dir)
    const publishing = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return publish(dir)
    })()

    const result = await claimGatewayInstance({
      runtimeDir: dir,
      lock: contender(),
      waitForDiscoveryMs: 200,
      retryDelayMs: 10,
    })
    expect(result.kind).toBe("deferred")
    await publishing
    await lock.release()
  })

  test("fails when a live lock holder never publishes discovery", async () => {
    const lock = await holdLock(dir)
    const result = await claimGatewayInstance({
      runtimeDir: dir,
      lock: contender(),
      waitForDiscoveryMs: 60,
      retryDelayMs: 10,
    })
    expect(result.kind).toBe("failed")
    await lock.release()
  })

  test("takeover waits for the old owner to release", async () => {
    const lock = await holdLock(dir)
    const releasing = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      await lock.release()
    })()

    const result = await claimGatewayInstance({
      runtimeDir: dir,
      takeover: true,
      takeoverTimeoutMs: 300,
      retryDelayMs: 10,
      lock: contender(),
    })
    expect(result.kind).toBe("owner")
    await releasing
    if (result.kind === "owner") await result.lock.release()
  })

  test("takeover times out instead of stealing a live lock", async () => {
    const lock = await holdLock(dir)
    const result = await claimGatewayInstance({
      runtimeDir: dir,
      takeover: true,
      takeoverTimeoutMs: 60,
      retryDelayMs: 10,
      lock: contender(),
    })
    expect(result.kind).toBe("failed")
    await lock.release()
  })
})
