import type { AdapterEvent } from '@mafw/runtime-contract';
import { translatePiAdapterEvent, setPiUnknownRecorder } from './pi-adapter-events';

export { setPiUnknownRecorder };

/**
 * Fan-out for one pi session event subscription.
 *
 * pi's `AgentSession.subscribe(listener)` forwards the raw agent event only —
 * the event has no `session` field. Resolve the session id from the session
 * object captured at subscription time (not from the event payload), otherwise
 * every live event is silently dropped.
 */
export class PiEventStream {
  private listeners = new Set<(evt: AdapterEvent) => void>();

  constructor(private resolveSessionId: (session: any) => string | undefined) {}

  /** Register a pi session and subscribe its raw event stream. */
  trackSession(session: any): void {
    if (typeof session?.subscribe !== 'function') return;
    session.subscribe((raw: any) => {
      const id = this.resolveSessionId(session);
      if (!id) return;
      const translated = translatePiAdapterEvent(raw, id);
      if (translated) {
        for (const listener of this.listeners) listener(translated);
      }
    });
  }

  /** Return a new AsyncIterable; listeners share the underlying fan-out. */
  stream(): AsyncIterable<AdapterEvent> {
    const listeners = this.listeners;
    const queue: AdapterEvent[] = [];
    const waiters: Array<(v: AdapterEvent) => void> = [];
    const listener = (evt: AdapterEvent) => {
      const w = waiters.shift();
      if (w) w(evt); else queue.push(evt);
    };
    listeners.add(listener);
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            if (queue.length) return { value: queue.shift() as AdapterEvent, done: false };
            return new Promise((resolve) => waiters.push((v) => resolve({ value: v, done: false })));
          },
          return: async () => { listeners.delete(listener); return { done: true, value: undefined }; },
        };
      },
    };
  }

  push(event: AdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
  }
}
