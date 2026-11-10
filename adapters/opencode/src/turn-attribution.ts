/**
 * Per-session attribution of gateway-minted turn ids to native opencode events.
 *
 * Port of `adapters/pi/src/pi-turn-attribution.ts` (the proven queue; Phase 4
 * ruling 5 keeps it adapter-local and defers the `@mafw/runtime-kit` extraction
 * to a follow-up). The opencode dialect tables emit `turn.started`
 * (`session.next.prompted` / `session.execution.started`), so ids are queued per
 * session and promoted one at a time — a busy follow-up cannot relabel the
 * running turn — and consumed on a terminal event.
 *
 * A native run that did not go through `sendTurn` (extension/restart/resume)
 * gets a fallback id rather than losing its terminal/tool frames. `abort()` marks
 * a session so late frames of the retired turn cannot mint a fresh id.
 */
import type { AdapterEvent } from '@mafw/runtime-contract';

const NEED_TURN: ReadonlySet<string> = new Set([
  'turn.started',
  'turn.completed',
  'turn.failed',
  'turn.aborted',
  'turn.retrying',
  'turn.waiting',
  'turn.cap_exhausted',
  'usage.updated',
  'tool.call',
  'tool.delta',
  'tool.result',
]);

const TERMINAL: ReadonlySet<string> = new Set([
  'turn.completed',
  'turn.failed',
  'turn.aborted',
]);

export class OpencodeTurnAttribution {
  private readonly queues = new Map<string, string[]>();
  private readonly active = new Map<string, string>();
  private readonly fallback = new Map<string, string>();
  private readonly suppressed = new Map<string, string>();
  private seq = 0;

  /** Register a gateway-minted turn id before the native prompt starts. */
  enqueue(sessionID: string, turnID: string): void {
    this.suppressed.delete(sessionID);
    const queue = this.queues.get(sessionID) ?? [];
    queue.push(turnID);
    this.queues.set(sessionID, queue);
  }

  /** The running turn id, if any. */
  activeTurnID(sessionID: string): string | undefined {
    return this.active.get(sessionID) ?? this.fallback.get(sessionID);
  }

  /**
   * Abort the running turn without a native terminal: mark the session so late
   * frames cannot mint a new id, and return the id the caller should terminate.
   */
  abort(sessionID: string): string | undefined {
    const active = this.active.get(sessionID) ?? this.fallback.get(sessionID);
    this.active.delete(sessionID);
    this.fallback.delete(sessionID);
    if (active) this.suppressed.set(sessionID, active);
    return active;
  }

  /** Drop all state for a deleted session. */
  forget(sessionID: string): void {
    this.queues.delete(sessionID);
    this.active.delete(sessionID);
    this.fallback.delete(sessionID);
    this.suppressed.delete(sessionID);
  }

  /** Drop a turn that failed before it could start (prompt rejection). */
  withdraw(sessionID: string, turnID: string): void {
    const queue = this.queues.get(sessionID);
    if (!queue) return;
    const index = queue.indexOf(turnID);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this.queues.delete(sessionID);
  }

  /** True when a turn is running or a gateway turn id is still queued. */
  hasInFlight(sessionID: string): boolean {
    return this.active.has(sessionID)
      || this.fallback.has(sessionID)
      || (this.queues.get(sessionID)?.length ?? 0) > 0;
  }

  /** Attach the current turn id to one native event. */
  attribute(event: AdapterEvent): AdapterEvent | null {
    const sessionID = event.sessionID;
    if (!sessionID) return event;

    const suppressedID = this.suppressed.get(sessionID);
    if (suppressedID) {
      if (event.type === 'turn.started') {
        this.suppressed.delete(sessionID);
      } else if (event.turnID !== suppressedID) {
        // Late native frames (no explicit turn id) must not mint a terminal
        // after the synthetic abort frame.
        return null;
      }
    }

    if (event.type === 'turn.started' && !this.active.has(sessionID)) {
      // Promote only on a fresh run. Automatic retries within the same logical
      // turn must not relabel the retry's frames to the next queued turn.
      const queue = this.queues.get(sessionID);
      const next = queue?.shift();
      if (next) this.active.set(sessionID, next);
      if (queue && queue.length === 0) this.queues.delete(sessionID);
    }

    let turnID = event.turnID
      ?? this.active.get(sessionID)
      ?? this.fallback.get(sessionID)
      ?? this.queues.get(sessionID)?.[0];

    if (!turnID && NEED_TURN.has(event.type)) {
      this.seq += 1;
      turnID = `opencode_turn_${sessionID}_${this.seq}`;
      this.fallback.set(sessionID, turnID);
    }
    if (event.type === 'turn.started' && turnID) {
      this.fallback.set(sessionID, turnID);
    }

    const attributed = turnID && !event.turnID ? { ...event, turnID } : event;

    if (TERMINAL.has(event.type)) {
      this.fallback.delete(sessionID);
      if (this.active.get(sessionID) === attributed.turnID) {
        this.active.delete(sessionID);
      } else {
        // Only the queue head may be consumed by this terminal. A synthetic
        // failure for a withdrawn turn must not eat the next queued turn.
        const queue = this.queues.get(sessionID);
        if (queue && queue[0] === attributed.turnID) {
          queue.shift();
          if (queue.length === 0) this.queues.delete(sessionID);
        }
      }
    }

    return attributed;
  }
}
