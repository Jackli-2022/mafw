// Step-ended memory injection (path 1): on a settled LLM step, search high
// salience memories and, after the session goes idle, promptAsync them back
// into the session as a memory block so the agent can act on them.
//
// Concurrency model: every method below is synchronous — no await in between
// state reads/writes, so Node's single thread makes each call atomic. Awaiting
// happens only in the caller (search, promptAsync) and never while holding
// state. Mark-before-async (markStepSeen) prevents duplicate evaluation when
// concurrent step.ended events arrive during an await.
import { TtlMap } from './ttl-map'

export const FINISHED_EXCLUSIONS = ['tool-calls', 'unknown']

export interface StepEndedProps {
  sessionID?: string
  assistantMessageID?: string
  finish?: string
}

export interface MemoryCandidate {
  id: string
  energy: number
  source?: string
  type?: string
  content?: string
  pattern?: string
  successRate?: number
  verdict?: string
  loopNum?: number
  facts?: string[]
}

export interface PendingInjection {
  block: string
  memIds: string[]
  at: number
}

export interface StepInjectOptions {
  queueCap: number
  intervalMs: number
  ttlMs: number
  threshold: number
  maxMemories: number
}

export function defaultStepInjectOptions(): StepInjectOptions {
  return {
    queueCap: 3,
    intervalMs: 15 * 60 * 1000,
    ttlMs: 24 * 60 * 60 * 1000,
    threshold: 0.7,
    maxMemories: 2,
  }
}

// opencode ≥1.18 no longer publishes `session.next.step.ended`. Steps settle as
// `step-finish` parts carried by `message.part.updated`. Messages also emit
// `message.updated` with `info.role='assistant'` and `info.time.completed` once
// the final assistant message is settled. These helpers normalize both shapes
// back into the old StepEndedProps contract.
export function stepPropsFromPartUpdated(props: unknown): StepEndedProps | null {
  const part = (props as any)?.part
  if (!part || part.type !== 'step-finish') return null
  return {
    sessionID: part.sessionID,
    assistantMessageID: part.messageID,
    finish: part.reason,
  }
}

export function stepPropsFromMessageUpdated(props: unknown): StepEndedProps | null {
  const info = (props as any)?.info
  if (!info || info.role !== 'assistant' || !info.time?.completed) return null
  return {
    sessionID: info.sessionID,
    assistantMessageID: info.id,
    finish: info.finish,
  }
}

export function shouldConsiderStep(props: StepEndedProps): boolean {
  if (!props.sessionID || !props.assistantMessageID) return false
  if (FINISHED_EXCLUSIONS.includes(props.finish || '')) return false
  return true
}

export function selectMemories(results: MemoryCandidate[], threshold: number, max: number): MemoryCandidate[] {
  return results
    .filter((r) => r.energy >= threshold)
    .sort((a, b) => b.energy - a.energy)
    .slice(0, max)
}

/** Fingerprint of a memory group by sorted IDs — not block text, so dynamic
 *  content (timestamps etc.) never defeats dedup. */
export function memoryFingerprint(memIds: string[]): string {
  return [...memIds].sort().join('|')
}

/**
 * All per-session state for step injection. Every method is synchronous; the
 * caller owns all awaiting. Entries expire via TtlMap (idle/ended sessions
 * are released, not leaked).
 */
export class StepInjectState {
  private queue = new TtlMap<string, PendingInjection[]>()
  private lastInjectedAt = new TtlMap<string, number>()
  private seenSteps = new TtlMap<string, Set<string>>()
  private seenFingerprints = new TtlMap<string, Set<string>>()
  private pushedMemories = new TtlMap<string, Set<string>>()

  constructor(private opts: StepInjectOptions) {}

  /**
   * B1 mark-before-async: returns true only the first time this assistant
   * message ID is evaluated; call it *before* any await so concurrent
   * duplicate step.ended events are dropped.
   */
  markStepSeen(sessionID: string, assistantMessageID: string): boolean {
    let set = this.seenSteps.get(sessionID)
    if (!set) {
      set = new Set()
      this.seenSteps.set(sessionID, set)
    }
    if (set.has(assistantMessageID)) return false
    set.add(assistantMessageID)
    return true
  }

  /** True if this memory group was already injected this session (fingerprint dedup). */
  fingerprintSeen(sessionID: string, fp: string): boolean {
    const set = this.seenFingerprints.get(sessionID)
    return !!set && set.has(fp)
  }

  private rememberFingerprint(sessionID: string, fp: string): void {
    let set = this.seenFingerprints.get(sessionID)
    if (!set) {
      set = new Set()
      this.seenFingerprints.set(sessionID, set)
    }
    set.add(fp)
  }

  enqueue(sessionID: string, injection: PendingInjection): void {
    let list = this.queue.get(sessionID)
    if (!list) {
      list = []
      this.queue.set(sessionID, list)
    }
    if (list.length >= this.opts.queueCap) {
      list.shift() // drop oldest, keep the newest high-value group
    }
    list.push(injection)
  }

  /**
   * B2 consumption entry: checks the frequency gate first — if the session
   * injected recently, the whole queue is discarded (single log line) instead
   * of failing each entry.
   */
  consume(sessionID: string): PendingInjection | null {
    const list = this.queue.get(sessionID)
    if (!list || list.length === 0) return null
    const last = this.lastInjectedAt.get(sessionID)
    if (last !== undefined && Date.now() - last < this.opts.intervalMs) {
      this.queue.delete(sessionID)
      return null
    }
    const next = list.shift()
    if (list.length === 0) this.queue.delete(sessionID)
    return next ?? null
  }

  /** B3: register an injected group; the IDs become invisible to /api/recall/context. */
  markInjected(sessionID: string, memIds: string[], fp: string): void {
    this.lastInjectedAt.set(sessionID, Date.now())
    this.rememberFingerprint(sessionID, fp)
    let set = this.pushedMemories.get(sessionID)
    if (!set) {
      set = new Set()
      this.pushedMemories.set(sessionID, set)
    }
    for (const id of memIds) set.add(id)
  }

  /** B3 rollback on promptAsync failure so IDs are never permanently masked. */
  rollbackPushed(sessionID: string, memIds: string[]): void {
    const set = this.pushedMemories.get(sessionID)
    if (!set) return
    for (const id of memIds) set.delete(id)
    if (set.size === 0) this.pushedMemories.delete(sessionID)
  }

  pushedMemoriesFor(sessionID: string): Set<string> {
    return this.pushedMemories.get(sessionID) ?? new Set<string>()
  }
}
