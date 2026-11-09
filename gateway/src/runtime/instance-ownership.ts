import { setTimeout as delay } from "node:timers/promises"
import {
  acquireInstanceLock,
  readInstanceLock,
  type AcquireInstanceLockOptions,
  type InstanceLock,
} from "./instance-lock"
import {
  readGatewayDiscovery,
  type GatewayDiscoveryRecord,
} from "./gateway-discovery"

export type GatewayOwnership =
  | { kind: "owner"; lock: InstanceLock }
  | { kind: "deferred"; holder: GatewayDiscoveryRecord | null }
  | { kind: "failed"; error: string }

export interface ClaimGatewayInstanceOptions {
  runtimeDir: string
  /** Self-update successor: wait for the old owner instead of deferring. */
  takeover?: boolean
  /** How long to wait for a lock holder to publish its discovery file. */
  waitForDiscoveryMs?: number
  /** How long a takeover waits for the old owner to release the lock. */
  takeoverTimeoutMs?: number
  retryDelayMs?: number
  /** Test injection; `dir` always comes from `runtimeDir`. */
  lock?: Omit<AcquireInstanceLockOptions, "dir">
  now?: () => number
}

/**
 * One data directory, one gateway.
 *
 * The process that binds owns the lock. A contender either becomes the owner,
 * or reports the already-running instance so the caller can attach. A takeover
 * (self-update) waits for the old process to release; it never kills it.
 */
export async function claimGatewayInstance(
  options: ClaimGatewayInstanceOptions,
): Promise<GatewayOwnership> {
  const waitForDiscoveryMs = options.waitForDiscoveryMs ?? 5_000
  const takeoverTimeoutMs = options.takeoverTimeoutMs ?? 45_000
  const retryDelayMs = options.retryDelayMs ?? 250
  const now = options.now ?? Date.now
  const takeoverDeadline = now() + takeoverTimeoutMs

  for (;;) {
    const result = await acquireInstanceLock({
      ...options.lock,
      dir: options.runtimeDir,
    })
    if (result.ok) return { kind: "owner", lock: result.lock }
    if (result.reason === "error") {
      return { kind: "failed", error: result.error.message }
    }

    const discovery = await readGatewayDiscovery(options.runtimeDir)
    if (options.takeover) {
      if (now() >= takeoverDeadline) {
        return {
          kind: "failed",
          error: `timed out waiting for the running gateway (pid ${result.holder.pid}) to release the instance lock`,
        }
      }
      await delay(retryDelayMs)
      continue
    }
    if (discovery) return { kind: "deferred", holder: discovery }

    // The lock holder may still be binding/publishing. Give it a bounded
    // window, then report a failure rather than stealing a live lock.
    const discoveryDeadline = now() + waitForDiscoveryMs
    while (now() < discoveryDeadline) {
      await delay(Math.min(retryDelayMs, Math.max(1, discoveryDeadline - now())))
      const found = await readGatewayDiscovery(options.runtimeDir)
      if (found) return { kind: "deferred", holder: found }
      if (!(await readInstanceLock(options.runtimeDir))) break
    }

    const stillHeld = await readInstanceLock(options.runtimeDir)
    if (!stillHeld) continue
    return {
      kind: "failed",
      error: `instance lock is held by pid ${stillHeld.pid} but no discovery file appeared`,
    }
  }
}
