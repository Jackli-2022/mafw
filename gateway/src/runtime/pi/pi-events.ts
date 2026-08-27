import type { RawRuntimeEvent } from '../normalize';

export function translatePiEvent(event: any, sessionID: string): RawRuntimeEvent | null {
  const t = event?.type ?? event?.payload?.type;
  const prop = (extra: any = {}) => ({ payload: { type: 'message.part.updated', properties: { part: { sessionID, ...extra } } } });
  switch (t) {
    case 'agent_start':
      return { payload: { type: 'session.updated', properties: { sessionID } } };
    case 'message_start':
    case 'message_update':
      return { payload: { type: 'message.part.updated', properties: { part: { sessionID, type: 'text', text: event?.delta ?? '' } } } };
    case 'message_end':
      return { payload: { type: 'message.updated', properties: { sessionID, info: { role: 'assistant' } } } };
    case 'tool_call':
      return prop({ type: 'tool-call' });
    case 'tool_result':
      return prop({ type: 'tool-result' });
    case 'turn_start':
      return prop({ type: 'step-start' });
    case 'turn_end':
      return prop({ type: 'step-finish', assistantMessageID: `pi_step_${sessionID}` });
    case 'agent_end':
    case 'agent_settled':
      return { payload: { type: 'session.idle', properties: { sessionID } } };
    case 'permission.asked':
      return {
        payload: {
          type: 'permission.asked',
          properties: {
            sessionID: event.payload.properties.sessionID,
            requestId: event.payload.properties.requestId,
            toolName: event.payload.properties.toolName,
            args: event.payload.properties.args,
            risk: event.payload.properties.risk,
          },
        },
      };
    case 'permission.replied':
      return {
        payload: {
          type: 'permission.replied',
          properties: {
            sessionID: event.payload.properties.sessionID,
            requestId: event.payload.properties.requestId,
            approved: event.payload.properties.approved,
          },
        },
      };
    default:
      return null;
  }
}

export class PiEventStream {
  private listeners = new Set<(evt: any) => void>();
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
      const translated = translatePiEvent(evt, id);
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
  stream(): AsyncIterable<any> {
    const listeners = this.listeners;
    const queue: any[] = [];
    const waiters: Array<(v: any) => void> = [];
    const listener = (evt: any) => {
      const w = waiters.shift();
      if (w) w(evt); else queue.push(evt);
    };
    listeners.add(listener);
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            if (queue.length) return { value: queue.shift(), done: false };
            return new Promise((resolve) => waiters.push((v) => resolve({ value: v, done: false })));
          },
          return: async () => { listeners.delete(listener); return { done: true, value: undefined }; },
        };
      },
    };
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    this.subscribed = false;
    this.onEvent = null;
  }
}