import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  acquireInstanceLock,
  readInstanceLock,
  type AcquireInstanceLockOptions,
} from "../../../src/runtime/instance-lock"

const T0 = 1_000_000

async function makeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mafw-instance-lock-"))
}

function options(dir: string, overrides: Partial<AcquireInstanceLockOptions> = {}): AcquireInstanceLockOptions {
  return {
    dir,
    pid: 1111,
    processStartTime: T0,
    now: () => T0,
    isProcessAlive: () => true,
    nonce: "nonce-a",
    heartbeatStaleMs: 30_000,
    startTimeToleranceMs: 2_000,
    ...overrides,
  }
}

describe("instance lock", () => {
  let dir: string

  beforeEach(async () => {
    dir = await makeDir()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("acquire writes a lock and release removes it", async () => {
    const result = await acquireInstanceLock(options(dir))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(await readInstanceLock(dir)).toMatchObject({
      pid: 1111,
      processStartTime: T0,
      nonce: "nonce-a",
    })

    await result.lock.release()
    expect(await readInstanceLock(dir)).toBeNull()
  })

  test("a second acquire reports the live holder instead of taking over", async () => {
    const first = await acquireInstanceLock(options(dir))
    expect(first.ok).toBe(true)

    const second = await acquireInstanceLock(options(dir, { nonce: "nonce-b", pid: 2222 }))
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe("held")
    if (second.reason !== "held") return
    expect(second.holder.nonce).toBe("nonce-a")
  })

  test("concurrent acquires elect exactly one owner", async () => {
    const results = await Promise.all([
      acquireInstanceLock(options(dir, { nonce: "a" })),
      acquireInstanceLock(options(dir, { nonce: "b" })),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
  })

  test("a dead pid is stale and can be taken over", async () => {
    const first = await acquireInstanceLock(options(dir))
    expect(first.ok).toBe(true)

    const second = await acquireInstanceLock(options(dir, {
      nonce: "new-owner",
      isProcessAlive: () => false,
    }))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.lock.record.nonce).toBe("new-owner")
  })

  test("a reused pid is stale when the process start time differs", async () => {
    const first = await acquireInstanceLock(options(dir))
    expect(first.ok).toBe(true)

    // Same pid, different process start time: the original holder is gone and
    // the OS handed its pid to another process.
    const second = await acquireInstanceLock(options(dir, {
      pid: 1111,
      processStartTime: T0 + 60_000,
      nonce: "new-owner",
    }))
    expect(second.ok).toBe(true)
  })

  test("a live pid with a fresh heartbeat keeps ownership", async () => {
    const first = await acquireInstanceLock(options(dir, { pid: 1111 }))
    expect(first.ok).toBe(true)

    const second = await acquireInstanceLock(options(dir, {
      pid: 2222,
      now: () => T0 + 10_000,
    }))
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe("held")
  })

  test("a live pid with an expired heartbeat is stale", async () => {
    const first = await acquireInstanceLock(options(dir, { pid: 1111 }))
    expect(first.ok).toBe(true)

    const second = await acquireInstanceLock(options(dir, {
      pid: 2222,
      now: () => T0 + 31_000,
      nonce: "new-owner",
    }))
    expect(second.ok).toBe(true)
  })

  test("heartbeat refreshes the lease and a displaced owner cannot release the new lock", async () => {
    const first = await acquireInstanceLock(options(dir, { pid: 1111 }))
    expect(first.ok).toBe(true)
    if (!first.ok) return

    await first.lock.heartbeat(new Date(T0 + 20_000))
    expect((await readInstanceLock(dir))?.heartbeatAt).toBe(new Date(T0 + 20_000).toISOString())

    const second = await acquireInstanceLock(options(dir, {
      pid: 2222,
      now: () => T0 + 40_000,
      nonce: "new-owner",
      isProcessAlive: () => false,
    }))
    expect(second.ok).toBe(true)

    await first.lock.release()
    expect((await readInstanceLock(dir))?.nonce).toBe("new-owner")
  })

  test("a corrupt lock file is replaced", async () => {
    await writeFile(join(dir, "gateway.lock"), "{not json", "utf8")
    const result = await acquireInstanceLock(options(dir, { nonce: "replacement" }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lock.record.nonce).toBe("replacement")
    expect(JSON.parse(await readFile(join(dir, "gateway.lock"), "utf8")).nonce).toBe("replacement")
  })

  test("a missing lock reads as null", async () => {
    expect(await readInstanceLock(dir)).toBeNull()
  })
})
