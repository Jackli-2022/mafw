// Main-process gateway liveness primitives, extracted from mafw-ipc.ts /
// mafw-sidecar.ts so the failure→feedback→recovery loop is unit-testable
// without Electron.
//
// Three pieces:
//  - exitNotification()   sidecar child exit → which state to announce
//                         (fixes the "exit while ready was silent" gap that
//                         made gateway restarts invisible to the frontend)
//  - createGatewayHealthMonitor()  periodic probe with first-failure /
//                         recovery / give-up callbacks (first failure is now
//                         pushed to the renderer instead of waiting for 5)
//  - createRestartScheduler()      bounded delayed auto-restart with reset

import type { GatewayState } from "./mafw-sidecar"

/** Which state (if any) a bundled-gateway child exit should announce.
 *  Intentional kills (stopGateway / will-quit) already announce "stopped"
 *  synchronously and must not double-notify as "failed". */
export function exitNotification(state: GatewayState, expectedExit: boolean): GatewayState | null {
  if (expectedExit) return null
  return "failed"
}

/**
 * Poll `check` until the gateway stops answering (check() === false).
 * Guard for the restart adopt-race (2026-09-16: restart re-adopted the
 * dying old gateway and reported a false "ready" — needed two clicks to
 * actually reconnect). Best-effort: resolves false on timeout so callers
 * can proceed instead of hanging forever.
 */
export async function waitForGatewayDown(
  check: () => Promise<boolean>,
  opts: { timeoutMs: number; intervalMs: number },
): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs
  while (Date.now() < deadline) {
    if (!(await check())) return true
    await new Promise((r) => setTimeout(r, opts.intervalMs))
  }
  return false
}

export type HealthMonitorDeps = {
  probe: () => Promise<void>
  onFirstFailure?: () => void
  onAttemptFail?: (failures: number) => void
  onRecovery?: () => void
  onGiveUp?: (failures: number) => void
}

export type HealthMonitorOpts = {
  intervalMs: number
  maxFailures: number
}

export type GatewayHealthMonitor = {
  start: () => void
  stop: () => void
  tick: () => Promise<void>
  isRunning: () => boolean
  readonly failures: number
}

export function createGatewayHealthMonitor(deps: HealthMonitorDeps, opts: HealthMonitorOpts): GatewayHealthMonitor {
  let timer: ReturnType<typeof setInterval> | null = null
  let failures = 0
  let ticking = false

  const stop = () => {
    if (timer) { clearInterval(timer); timer = null }
  }

  const tick = async () => {
    if (ticking) return
    ticking = true
    try {
      await deps.probe()
      if (failures > 0) {
        failures = 0
        deps.onRecovery?.()
      }
    } catch {
      failures++
      if (failures === 1) deps.onFirstFailure?.()
      else deps.onAttemptFail?.(failures)
      if (failures >= opts.maxFailures) {
        const n = failures
        failures = 0
        stop()
        deps.onGiveUp?.(n)
      }
    } finally {
      ticking = false
    }
  }

  return {
    start: () => {
      stop()
      timer = setInterval(() => { void tick() }, opts.intervalMs)
    },
    stop,
    tick,
    isRunning: () => timer !== null,
    get failures() { return failures },
  }
}

export type RestartSchedulerOpts = {
  delayMs: number
  maxAttempts: number
  run: () => void
  onAttempt?: (attempt: number) => void
  onExhausted?: (attempts: number) => void
}

export type RestartScheduler = {
  request: () => void
  reset: () => void
  cancel: () => void
  readonly pending: boolean
  readonly attempts: number
}

/** Bounded auto-restart: each request() schedules one delayed run; repeated
 *  requests while a run is pending are collapsed; after maxAttempts without
 *  an external reset() the scheduler exhausts and stops retrying. */
export function createRestartScheduler(opts: RestartSchedulerOpts): RestartScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let exhausted = false

  return {
    request: () => {
      if (timer || exhausted) return
      attempts++
      if (attempts > opts.maxAttempts) {
        exhausted = true
        opts.onExhausted?.(attempts)
        return
      }
      opts.onAttempt?.(attempts)
      timer = setTimeout(() => {
        timer = null
        opts.run()
      }, opts.delayMs)
    },
    reset: () => {
      attempts = 0
      exhausted = false
    },
    cancel: () => {
      if (timer) { clearTimeout(timer); timer = null }
    },
    get pending() { return timer !== null },
    get attempts() { return attempts },
  }
}
