// Per-turn diff helpers (B3.1): choose user turns that have assistant
// snapshots, fetch each turn's diff, and merge it into checkpoints/diffs.
import type { FileDiffEntry } from "./DiffReviewPanel"
import type { Checkpoint, CheckpointFile } from "./checkpoint-model"
import { isLocalMessageId } from "../chat/local-id"

export interface TurnDiffCandidate {
  messageID: string
  snapshotKey: string
}

function unwrap(item: any): any {
  return item && typeof item === "object" && item.info ? item.info : item
}

function roleOf(message: any): string | undefined {
  if (!message || typeof message !== "object") return undefined
  if (typeof message.role === "string") return message.role
  if (message.type === "user" || message.type === "assistant") return message.type
  return undefined
}

function createdOf(message: any): number {
  const value = message?.time?.created
  return typeof value === "number" ? value : Number.MAX_SAFE_INTEGER
}

function chronological(messages: any[]): any[] {
  return (Array.isArray(messages) ? messages : [])
    .map(unwrap)
    .filter((message) => message && typeof message === "object")
    .map((message, index) => ({ message, index }))
    .sort((a, b) => createdOf(a.message) - createdOf(b.message) || a.index - b.index)
    .map((entry) => entry.message)
}

/** User turns whose assistant range has at least one snapshot.start.
 *  `excludeLastTurn` drops the newest user turn (in-flight): its snapshot key
 *  changes on every assistant step, which would refetch all turns per step. */
export function collectTurnDiffCandidates(
  messages: any[],
  opts: { excludeLastTurn?: boolean } = {},
): TurnDiffCandidate[] {
  const items = chronological(messages)
  let lastUserIndex = -1
  for (let i = items.length - 1; i >= 0; i--) {
    if (roleOf(items[i]) === "user") { lastUserIndex = i; break }
  }
  const out: TurnDiffCandidate[] = []
  for (let i = 0; i < items.length; i++) {
    const message = items[i]
    if (roleOf(message) !== "user") continue
    if (opts.excludeLastTurn && i === lastUserIndex) continue
    const id = typeof message.id === "string" ? message.id : ""
    if (!id || isLocalMessageId(id)) continue

    let nextUser = items.length
    for (let j = i + 1; j < items.length; j++) {
      if (roleOf(items[j]) === "user") {
        nextUser = j
        break
      }
    }
    const snapshots = items
      .slice(i + 1, nextUser)
      .filter((item) => roleOf(item) === "assistant")
      .map((item) => item?.snapshot)
      .filter((snapshot) => snapshot && typeof snapshot.start === "string" && snapshot.start)
    if (snapshots.length === 0) continue

    const last = snapshots[snapshots.length - 1]
    out.push({
      messageID: id,
      snapshotKey: `${last.start}:${last.end ?? ""}:${last.files?.length ?? 0}`,
    })
  }
  return out
}

/** Fetch one diff per candidate with bounded concurrency; failures become null. */
export async function loadTurnDiffs(
  sessionID: string,
  messages: any[],
  fetchDiff: (sessionID: string, messageID: string) => Promise<{ files: FileDiffEntry[] }>,
  concurrency = 4,
): Promise<Record<string, FileDiffEntry[] | null>> {
  const candidates = collectTurnDiffCandidates(messages)
  const result: Record<string, FileDiffEntry[] | null> = {}
  // Preseed in chronological candidate order: map insertion order must not
  // depend on which HTTP/git request finishes first (latest turn must win).
  for (const candidate of candidates) result[candidate.messageID] = null
  if (candidates.length === 0) return result

  let cursor = 0
  const workers = Math.min(Math.max(1, concurrency), candidates.length)
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++]
      try {
        const response = await fetchDiff(sessionID, candidate.messageID)
        result[candidate.messageID] = Array.isArray(response?.files) ? response.files : []
      } catch {
        result[candidate.messageID] = null
      }
    }
  }))
  return result
}

function validEntry(entry: FileDiffEntry | null | undefined): entry is FileDiffEntry {
  return !!entry && typeof entry.file === "string" && entry.file.length > 0
}

/** Merge summary-derived entries with per-turn entries; per-turn wins per file. */
export function mergeDiffLists(
  base: FileDiffEntry[],
  perTurn: Record<string, FileDiffEntry[] | null>,
): FileDiffEntry[] {
  const byFile = new Map<string, FileDiffEntry>()
  for (const entry of base ?? []) {
    if (validEntry(entry)) byFile.set(entry.file!, entry)
  }
  for (const entries of Object.values(perTurn ?? {})) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (validEntry(entry)) byFile.set(entry.file!, entry)
    }
  }
  return [...byFile.values()]
}

/** Replace a checkpoint's files only when the per-turn fetch succeeded. */
export function applyTurnDiffsToCheckpoints(
  checkpoints: Checkpoint[],
  perTurn: Record<string, FileDiffEntry[] | null>,
): Checkpoint[] {
  return (checkpoints ?? []).map((checkpoint) => {
    const entries = perTurn?.[checkpoint.messageID]
    if (!Array.isArray(entries)) return checkpoint
    const files: CheckpointFile[] = []
    for (const entry of entries) {
      if (!validEntry(entry)) continue
      const file: CheckpointFile = { file: entry.file! }
      if (typeof entry.additions === "number") file.additions = entry.additions
      if (typeof entry.deletions === "number") file.deletions = entry.deletions
      if (typeof entry.status === "string") file.status = entry.status
      if (typeof entry.patch === "string" && entry.patch) file.patch = entry.patch
      files.push(file)
    }
    return { ...checkpoint, files, filesKnown: true }
  })
}

/** The embedded review panel may only fetch the session-wide diff when allowed. */
export function shouldFetchSessionDiff(hasDiffs: boolean, allowSessionFallback = true): boolean {
  return allowSessionFallback && !hasDiffs
}

/** Stable request key for the runtime/session/candidate snapshot set. */
export function turnDiffRequestKey(
  runtimeName: string,
  sessionID: string,
  candidates: TurnDiffCandidate[],
): string {
  return `${runtimeName}|${sessionID}|${candidates.map((c) => `${c.messageID}:${c.snapshotKey}`).join(",")}`
}
