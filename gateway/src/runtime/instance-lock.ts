import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

export const INSTANCE_LOCK_FILE = "gateway.lock"

export interface InstanceLockRecord {
  pid: number
  /** Epoch ms, derived at startup from `Date.now() - process.uptime()`. */
  processStartTime: number
  startedAt: string
  heartbeatAt: string
  nonce: string
}

export interface AcquireInstanceLockOptions {
  dir: string
  pid?: number
  processStartTime?: number
  now?: () => number
  isProcessAlive?: (pid: number) => boolean
  nonce?: string
  heartbeatStaleMs?: number
  startTimeToleranceMs?: number
  /**
   * After creating the file, re-read it after this delay. If another process
   * reaped our lock in the meantime, we see a different nonce and back off.
   * This closes the remove/create race between two stale-lock reclaimers.
   */
  settleMs?: number
}

export interface InstanceLock {
  readonly path: string
  readonly record: InstanceLockRecord
  heartbeat(at?: Date): Promise<void>
  release(): Promise<void>
}

export type AcquireInstanceLockResult =
  | { ok: true; lock: InstanceLock }
  | { ok: false; reason: "held"; holder: InstanceLockRecord }
  | { ok: false; reason: "error"; error: Error }

/**
 * Lease heartbeat (E1-1). `InstanceLock.heartbeat()` shipped with no production
 * caller: a live owner's record aged past `heartbeatStaleMs` (30s) and a
 * contender reaped the lock out from under it. Boot owns exactly one loop per
 * process (see `boot.ts`), unref'd so it never keeps the process alive, and
 * stopped by `releaseInstanceOwnership()`.
 *
 * FENCING IS DELIBERATELY OUT OF SCOPE (E5): this is a cooperative lease, not a
 * fencing token. After a contested takeover the displaced owner's heartbeat
 * rejects on the nonce mismatch and is reported through `onError` — it does not
 * abort in-flight session writes. Per-owner fencing belongs to the E5 identity
 * closure.
 */
export const INSTANCE_LOCK_HEARTBEAT_MS = 10_000

export interface InstanceLockHeartbeatOptions {
  /** Defaults to `INSTANCE_LOCK_HEARTBEAT_MS` (10s). */
  intervalMs?: number
  /** A rejected heartbeat (nonce mismatch / fs error) — never thrown. */
  onError?: (err: unknown) => void
}

export interface InstanceLockHeartbeatHandle {
  readonly timer: NodeJS.Timeout
  stop(): void
}

/** Start the lease heartbeat loop; `stop()` is idempotent. */
export function startInstanceLockHeartbeat(
  lock: InstanceLock,
  options: InstanceLockHeartbeatOptions = {},
): InstanceLockHeartbeatHandle {
  const intervalMs = options.intervalMs ?? INSTANCE_LOCK_HEARTBEAT_MS
  const timer = setInterval(() => {
    void lock.heartbeat().catch((err: unknown) => options.onError?.(err))
  }, intervalMs)
  timer.unref?.()
  let stopped = false
  return {
    timer,
    stop(): void {
      if (stopped) return
      stopped = true
      clearInterval(timer)
    },
  }
}

export function instanceLockPath(dir: string): string {
  return join(dir, INSTANCE_LOCK_FILE)
}

/** Portable approximation of when this process started. */
export function currentProcessStartTime(now: number = Date.now()): number {
  return now - process.uptime() * 1000
}

/** Signal 0 probe. EPERM still means the process exists but we cannot signal it. */
export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    return err?.code === "EPERM"
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function parseRecord(value: unknown): InstanceLockRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const pid = raw.pid
  const processStartTime = raw.processStartTime
  const startedAt = text(raw.startedAt)
  const heartbeatAt = text(raw.heartbeatAt)
  const nonce = text(raw.nonce)
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null
  if (typeof processStartTime !== "number" || !Number.isFinite(processStartTime)) return null
  if (!startedAt || !heartbeatAt || !nonce) return null
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(heartbeatAt))) return null
  return { pid, processStartTime, startedAt, heartbeatAt, nonce }
}

export async function readInstanceLock(dir: string): Promise<InstanceLockRecord | null> {
  try {
    return parseRecord(JSON.parse(await readFile(instanceLockPath(dir), "utf8")))
  } catch {
    return null
  }
}

export function isInstanceLockStale(
  record: InstanceLockRecord,
  options: {
    now: number
    myPid: number
    myProcessStartTime: number
    isProcessAlive: (pid: number) => boolean
    heartbeatStaleMs: number
    startTimeToleranceMs: number
  },
): boolean {
  // Same pid with a different start time: the OS reused the pid after the
  // previous holder died. This is the one case we can prove without OS APIs.
  if (record.pid === options.myPid
    && Math.abs(record.processStartTime - options.myProcessStartTime) > options.startTimeToleranceMs) {
    return true
  }
  if (!options.isProcessAlive(record.pid)) return true
  // A reused pid owned by an unrelated process still looks alive, but its
  // heartbeat stops when the original holder dies.
  return options.now - Date.parse(record.heartbeatAt) > options.heartbeatStaleMs
}

async function writeRecordAtomic(path: string, record: InstanceLockRecord): Promise<void> {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`
  await writeFile(temp, JSON.stringify(record), "utf8")
  try {
    await rename(temp, path)
  } catch (err) {
    await rm(temp, { force: true })
    throw err
  }
}

export async function acquireInstanceLock(
  options: AcquireInstanceLockOptions,
): Promise<AcquireInstanceLockResult> {
  const dir = options.dir
  await mkdir(dir, { recursive: true })

  const now = options.now ?? Date.now
  const pid = options.pid ?? process.pid
  const processStartTime = options.processStartTime ?? currentProcessStartTime(now())
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive
  const nonce = options.nonce ?? randomUUID()
  const heartbeatStaleMs = options.heartbeatStaleMs ?? 30_000
  const startTimeToleranceMs = options.startTimeToleranceMs ?? 2_000
  const settleMs = options.settleMs ?? 25
  const path = instanceLockPath(dir)

  let record: InstanceLockRecord = {
    pid,
    processStartTime,
    startedAt: new Date(now()).toISOString(),
    heartbeatAt: new Date(now()).toISOString(),
    nonce,
  }

  const lock: InstanceLock = {
    path,
    get record() {
      return record
    },
    async heartbeat(at: Date = new Date()): Promise<void> {
      const current = await readInstanceLock(dir)
      if (!current || current.nonce !== nonce) {
        throw new Error("instance lock was taken over by another process")
      }
      record = { ...record, heartbeatAt: at.toISOString() }
      await writeRecordAtomic(path, record)
    },
    async release(): Promise<void> {
      const current = await readInstanceLock(dir)
      if (!current || current.nonce !== nonce) return
      await rm(path, { force: true })
    },
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let handle: Awaited<ReturnType<typeof open>>
    try {
      handle = await open(path, "wx")
    } catch (err: any) {
      if (err?.code !== "EEXIST") {
        return { ok: false, reason: "error", error: err instanceof Error ? err : new Error(String(err)) }
      }
      const holder = await readInstanceLock(dir)
      if (!holder) {
        // Corrupt or half-written file: nobody can prove ownership.
        await rm(path, { force: true })
        continue
      }
      if (isInstanceLockStale(holder, {
        now: now(),
        myPid: pid,
        myProcessStartTime: processStartTime,
        isProcessAlive,
        heartbeatStaleMs,
        startTimeToleranceMs,
      })) {
        await rm(path, { force: true })
        continue
      }
      return { ok: false, reason: "held", holder }
    }

    try {
      await handle.writeFile(JSON.stringify(record), "utf8")
    } finally {
      await handle.close()
    }

    if (settleMs > 0) await delay(settleMs)
    const settled = await readInstanceLock(dir)
    if (!settled) continue
    if (settled.nonce !== nonce) {
      return { ok: false, reason: "held", holder: settled }
    }
    return { ok: true, lock }
  }

  const holder = await readInstanceLock(dir)
  if (holder) return { ok: false, reason: "held", holder }
  return { ok: false, reason: "error", error: new Error("could not acquire instance lock") }
}
