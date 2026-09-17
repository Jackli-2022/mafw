// Tray status text builders + the pending-approval poller. The pure builders
// are unit-tested; the poller is a thin Electron-free loop wired up in
// index.ts (fail-open: errors keep the last known status).

export type TrayStatusPayloads = { approvals: unknown; permissions: unknown }

export function countPending(approvals: unknown, permissions: unknown): number {
  const list = (approvals as { approvals?: unknown } | null)?.approvals
  const items = (permissions as { items?: unknown } | null)?.items
  const pendingApprovals = Array.isArray(list)
    ? list.filter((q) => (q as { status?: unknown })?.status === "pending").length
    : 0
  const pendingPermissions = Array.isArray(items) ? items.length : 0
  return pendingApprovals + pendingPermissions
}

function pendingText(pending: number): string {
  return `${pending} pending approval${pending === 1 ? "" : "s"}`
}

export function trayTooltip(pending: number): string {
  if (pending <= 0) return "MAFW Desktop"
  return `MAFW Desktop — ${pendingText(pending)}`
}

export function trayMenuStatusLabel(pending: number): string {
  if (pending <= 0) return "No pending approvals"
  return pendingText(pending)
}

// Polls the gateway for pending approvals/permissions and reports the total.
// Returns a stop function. Never throws.
export function startTrayStatusPolling(opts: {
  getBaseUrl: () => string | null
  onPending: (pending: number) => void
  intervalMs?: number
  fetchFn?: typeof fetch
  log?: (msg: string) => void
}): () => void {
  const intervalMs = opts.intervalMs ?? 30_000
  const fetchFn = opts.fetchFn ?? fetch
  let stopped = false
  let inFlight = false

  const tick = async () => {
    if (stopped || inFlight) return
    const base = opts.getBaseUrl()
    if (!base) return
    inFlight = true
    try {
      const [approvals, permissions] = await Promise.all([
        fetchFn(`${base}/api/approvals`, { signal: AbortSignal.timeout(5000) })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetchFn(`${base}/api/permissions`, { signal: AbortSignal.timeout(5000) })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ])
      if (!stopped && (approvals || permissions)) opts.onPending(countPending(approvals, permissions))
    } catch (err) {
      opts.log?.(`tray status poll failed: ${String(err)}`)
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
