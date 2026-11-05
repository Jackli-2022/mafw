// packages/desktop/src/main/presence-poller.ts
// Main-process poller for GET /api/presence. The renderer only ever holds one
// pod, so cross-project awareness cannot come from there.
import type { PresencePayload } from "./presence-model"

export interface PresencePollingOpts {
  getBaseUrl(): string | null
  onSnapshot(payload: PresencePayload | null): void
  intervalMs?: number
  fetchFn?: typeof fetch
  log?(msg: string): void
}

export interface PresencePollingHandle {
  stop(): void
  /** Trigger one immediate poll (renderer `pod.event` → 不等 15s 轮询). */
  poll(): void
}

/** Returns a handle. Never throws. */
export function startPresencePolling(opts: PresencePollingOpts): PresencePollingHandle {
  const intervalMs = opts.intervalMs ?? 15_000
  const fetchFn = opts.fetchFn ?? fetch
  let stopped = false
  let inFlight = false
  let failures = 0

  const tick = async () => {
    if (stopped || inFlight) return
    const base = opts.getBaseUrl()
    if (!base) return
    inFlight = true
    try {
      const res = await fetchFn(`${base}/api/presence`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error(`presence ${res.status}`)
      const payload = (await res.json()) as PresencePayload
      failures = 0
      if (!stopped) opts.onSnapshot(payload)
    } catch (err) {
      failures += 1
      opts.log?.(`presence poll failed (${failures}): ${String(err)}`)
      // A dead gateway must not leave the tray stuck on "running".
      if (failures >= 3 && !stopped) opts.onSnapshot(null)
    } finally {
      inFlight = false
    }
  }

  void tick()
  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref?.()
  return {
    stop() {
      stopped = true
      clearInterval(timer)
    },
    poll() {
      void tick()
    },
  }
}
