import type { AdapterEvent } from '@mafw/runtime-contract';
import { translatePiAdapterEvent, setPiUnknownRecorder } from './pi-adapter-events';

export { setPiUnknownRecorder };

export class PiEventStream {
  private listeners = new Set<(evt: AdapterEvent) => void>();
  private subscribed = false;
  private onEvent: ((evt: any) => void) | null = null;

  constructor(private resolveSessionId: (session: any) => string | undefined) {}

  /** 单例底层订阅：registry 在 create 时经 trackSession 挂订阅。 */
  attach(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.onEvent = (evt: any) => {
      const id = this.resolveSessionId(evt?.session);
      if (!id) return;
      const translated = translatePiAdapterEvent(evt, id);
      if (translated) {
        for (const l of this.listeners) l(translated);
      }
    };
  }

  /** 新会话登记时挂订阅（PiSessionRegistry.create 经回调调用）。 */
  trackSession(session: any): void {
    if (typeof session?.subscribe !== 'function') return;
    this.attach();
    session.subscribe(this.onEvent);
  }

  /** 返回新 AsyncIterable，fan-out 共享底层 listener。 */
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
    for (const l of this.listeners) l(event);
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    this.subscribed = false;
    this.onEvent = null;
  }
}
