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

/** Returns a stop function. Never throws. */
export function startPresencePolling(opts: PresencePollingOpts): () => void {
  const intervalMs = opts.intervalMs ?? 15_000
  const fetchFn = opts.fetchFn ?? fetch
  let stopped = false
  let inFlight = false

  const tick = async () => {
    if (stopped || inFlight) return
    const base = opts.getBaseUrl()
    if (!base) return
    inFlight = true
    try {
      const res = await fetchFn(`${base}/api/presence`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return
      const payload = (await res.json()) as PresencePayload
      if (!stopped) opts.onSnapshot(payload)
    } catch (err) {
      opts.log?.(`presence poll failed: ${String(err)}`)
    } finally {
      inFlight = false
    }
  }

  void tick()
  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
