import type { RawRuntimeEvent } from '../normalize';
import { applyEventMappings, EventMapping, EventSourceShape, TransformEventFn } from '../event-mapper';

/** pi 原生事件源形状：session.subscribe 事件顶层 type；sessionID 由 PiEventStream 解析后附上。 */
export const PI_EVENT_SOURCE: EventSourceShape = { typePath: '$.type', sessionIdPath: '$.sessionID' };

/**
 * pi 原生事件 → canonical（声明式，原 translatePiEvent switch 的表化）。
 * turn_end 写 part.messageID（修复：facet 规则读 messageID 而非 assistantMessageID，
 * pi 上 BudgetGuard step 此前从未触发）。
 */
export const PI_EVENT_MAPPINGS: EventMapping[] = [
  { from: 'agent_start', to: 'session.updated' },
  { from: ['message_start', 'message_update'], to: 'message.part.updated',
    fields: { 'part.type': { const: 'text' }, 'part.text': { path: '$.delta', default: '' } } },
  { from: 'message_end', to: 'message.updated', fields: { 'info.role': { const: 'assistant' } } },
  { from: 'tool_call', to: 'tool.call',
    fields: { callID: { path: '$.toolCallId' }, tool: { path: '$.toolName' }, input: { path: '$.input' } } },
  { from: 'tool_result', to: 'tool.result',
    fields: { callID: { path: '$.toolCallId' }, tool: { path: '$.toolName' },
              isError: { path: '$.isError' }, output: { path: '$.content' } } },
  { from: 'turn_start', to: 'message.part.updated', fields: { 'part.type': { const: 'step-start' } } },
  { from: 'turn_end', to: 'message.part.updated',
    fields: { 'part.type': { const: 'step-finish' }, 'part.messageID': { template: 'pi_step_{$.sessionID}' } } },
  { from: ['agent_end', 'agent_settled'], to: 'session.idle' },
];

/**
 * pi 未知原生事件遥测：translatePiEvent 的丢弃路径（transformEvent fallthrough）
 * 静默丢弃 unmapped 原生类型——gateway 侧 wrap 的 onUnknown 对 pi 永不触发
 * （事件到达时已信封化走 passthrough 短路），此处补一个模块级 recorder，
 * 由 index.ts 在注册 pi 时接 UnknownEventTracker（source='pi'）。
 */
let piUnknownRecorder: ((type: string) => void) | undefined;
export function setPiUnknownRecorder(fn: ((type: string) => void) | undefined): void {
  piUnknownRecorder = fn;
}

/**
 * 逃逸口：permission.asked/replied 已 canonical 形状（带顶层 type 时命中此处；
 * 已信封化的事件走执行器 passthrough），逐字保留现输出。
 */
export const piTransformEvent: TransformEventFn = (event: any): RawRuntimeEvent | null => {
  const t = event?.type ?? event?.payload?.type;
  if (t === 'permission.asked') {
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
  }
  if (t === 'permission.replied') {
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
  }
  // fallthrough = unmapped 原生类型（applyEventMappings 的 onUnknown 因 transformEvent
  // 存在而不可达，见 :86 早于 :90）——此处记遥测后丢弃。
  if (typeof t === 'string' && t) {
    try { piUnknownRecorder?.(t); } catch { /* fail-open：热路径不抛 */ }
  }
  return null;
};

/**
 * pi 事件翻译（表驱动）。isCanonical 恒 false：pi 原生事件名不在 canonical 词汇表，
 * permission 由 transformEvent 兜底——保持输出形状与旧 switch 逐字一致。
 */
export function translatePiEvent(event: any, sessionID: string): RawRuntimeEvent | null {
  const out = applyEventMappings(
    { ...event, sessionID },
    { eventSource: PI_EVENT_SOURCE, eventMappings: PI_EVENT_MAPPINGS, transformEvent: piTransformEvent },
    () => false,
  );
  return (out[0] as RawRuntimeEvent) ?? null;
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

  push(event: RawRuntimeEvent): void {
    for (const l of this.listeners) l(event);
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    this.subscribed = false;
    this.onEvent = null;
  }
}
