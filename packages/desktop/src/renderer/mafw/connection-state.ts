// Gateway connection awareness for the renderer. Two independent signals —
// the SSE stream (renderer-level, immediate) and the main-process gateway
// state pushes (process-level, authoritative) — are folded into ONE phase
// machine so UI feedback (toasts) fires exactly once per transition, no
// matter which signal noticed first.
import { createSignal, type Accessor } from "solid-js"
//
//   initial      never connected (startup); sse-error here is NOT surfaced
//                as a disconnection (no false alarm before first success)
//   connected    SSE stream open
//   reconnecting SSE dropped, EventSource auto-retrying
//   down         gateway process exited (main-process "failed" push)

export type ConnPhase = "initial" | "connected" | "reconnecting" | "down"

export type ConnSource = "sse-open" | "sse-error" | "gateway-failed" | "gateway-ready"

export type ConnEvent = {
  phase: ConnPhase
  prev: ConnPhase
  source: ConnSource
  /** true when a previously broken connection returned to "connected". */
  recovered: boolean
  at: number
}

export type ConnTransition = ConnEvent | null

export function createConnectionState(now: () => number = Date.now) {
  let phase: ConnPhase = "initial"
  let attempts = 0
  const subs = new Set<(ev: ConnEvent) => void>()

  return {
    get phase(): ConnPhase {
      return phase
    },
    attempts(): number {
      return attempts
    },
    report(source: ConnSource): ConnTransition {
      const prev = phase
      let next: ConnPhase | null = null
      let recovered = false

      switch (source) {
        case "sse-open":
          if (phase !== "connected") {
            next = "connected"
            recovered = prev === "reconnecting" || prev === "down"
            attempts = 0
          }
          break
        case "sse-error":
          if (phase === "connected") {
            next = "reconnecting"
            attempts++
          } else {
            // initial (never connected) or already reconnecting/down: count
            // the attempt but do not re-announce.
            attempts++
          }
          break
        case "gateway-failed":
          if (phase !== "down") next = "down"
          break
        case "gateway-ready":
          // Process is back, but only the SSE stream can confirm data flow.
          if (phase === "down") next = "reconnecting"
          break
      }

      if (next === null || next === prev) return null
      phase = next
      const ev: ConnEvent = { phase, prev, source, recovered, at: now() }
      for (const cb of subs) cb(ev)
      return ev
    },
    subscribe(cb: (ev: ConnEvent) => void): () => void {
      subs.add(cb)
      return () => subs.delete(cb)
    },
  }
}

/** Promise.all that records whether ANY input rejected instead of throwing.
 *  Fixes the "connected banner dead code" class of bug: per-item .catch()
 *  swallowing errors makes the aggregate catch unreachable. */
export async function allWithFailureFlag<T>(
  gets: (() => Promise<T>)[],
  fallback: T,
): Promise<{ values: T[]; failed: boolean }> {
  let failed = false
  const values = await Promise.all(
    gets.map((g) => g().catch(() => { failed = true; return fallback })),
  )
  return { values, failed }
}

// Module-level singleton: one phase machine per renderer. Consumers import
// `conn` (to report) or `useConnPhase()` (to read reactively) — a module
// singleton avoids Solid Context chain issues entirely (first-party source,
// single bundle, no duplicate-instance risk).
export const conn = createConnectionState()

/** Reactive phase accessor for components. Subscriptions live for the page
 *  lifetime — consumers are app-lifetime components (Rail/titlebar/Docks), so
 *  no per-component cleanup is needed. */
export function useConnPhase(): Accessor<ConnPhase> {
  const [phase, setPhase] = createSignal<ConnPhase>(conn.phase)
  conn.subscribe((ev) => setPhase(ev.phase))
  return phase
}
