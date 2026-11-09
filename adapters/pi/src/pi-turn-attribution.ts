/**
 * Per-session attribution of gateway-minted turn ids to native adapter events.
 *
 * The pi SDK emits `agent_start` / `agent_end` / tool frames without knowing
 * the gateway turn id. The transport contract requires every turn-scoped event
 * to echo the id minted for `sendTurn`. This tracker mirrors the Plan 5A
 * bridge: ids are queued per session, promoted one at a time on `turn.started`
 * (so a busy follow-up cannot relabel the running turn), and consumed on a
 * terminal event.
 *
 * A native run that did not go through `sendTurn` (extension/restart) gets a
 * fallback id rather than losing its terminal/tool frames.
 */
import type { AdapterEvent } from '@mafw/runtime-contract';

const NEED_TURN: ReadonlySet<string> = new Set([
  'turn.started',
  'turn.completed',
  'turn.failed',
  'turn.aborted',
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

export class PiTurnAttribution {
  private readonly queues = new Map<string, string[]>();
  private readonly active = new Map<string, string>();
  private readonly fallback = new Map<string, string>();
  private seq = 0;

  /** Register a gateway-minted turn id before the native prompt starts. */
  enqueue(sessionID: string, turnID: string): void {
    const queue = this.queues.get(sessionID) ?? [];
    queue.push(turnID);
    this.queues.set(sessionID, queue);
  }

  /** Drop a turn that failed before it could start (prompt rejection). */
  withdraw(sessionID: string, turnID: string): void {
    const queue = this.queues.get(sessionID);
    if (!queue) return;
    const index = queue.indexOf(turnID);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this.queues.delete(sessionID);
  }

  /** Abort clears the running turn; queued ids stay for the next start. */
  clearActive(sessionID: string): void {
    this.active.delete(sessionID);
  }

  /** Attach the current turn id to one native event. */
  attribute(event: AdapterEvent): AdapterEvent {
    const sessionID = event.sessionID;
    if (!sessionID) return event;

    if (event.type === 'turn.started') {
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
      turnID = `pi_turn_${sessionID}_${this.seq}`;
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
