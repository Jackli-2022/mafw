// T2-2: active run (soft suspend) per session, fed by `run.updated` + GET /run.
import { createSignal } from "solid-js"
import type { RunState } from "@mafw/sdk"

const [runBySession, setRunBySession] = createSignal<Record<string, RunState | null>>({})

export { runBySession }

/** Event / fetch payload → store; null/terminal statuses clear the active slot. */
export function applyRunSnapshot(
  prev: Record<string, RunState | null>,
  run: RunState | null | undefined,
): Record<string, RunState | null> {
  if (!run || run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    if (!run) return prev
    return { ...prev, [run.sessionID]: null }
  }
  return { ...prev, [run.sessionID]: run }
}

export function setRun(run: RunState | null | undefined): void {
  if (!run) return
  setRunBySession((prev) => applyRunSnapshot(prev, run))
}

export function runForSession(sessionID: string): RunState | null {
  return runBySession()[sessionID] ?? null
}

export function clearRun(sessionID: string): void {
  setRunBySession((prev) => ({ ...prev, [sessionID]: null }))
}
