import type { RawRuntimeEvent } from '../normalize';
import { applyEventMappings, EventMapping, EventSourceShape, TransformEventFn } from '../event-mapper';
import { EVENT_FLOW_MATRIX } from '../event-flow-matrix';
import { TOOL_PRIMITIVE_TYPES } from '../tool-part-assembler';

/** pi 原生事件源形状：session.subscribe 事件顶层 type；sessionID 由 PiEventStream 解析后附上。 */
export const PI_EVENT_SOURCE: EventSourceShape = { typePath: '$.type', sessionIdPath: '$.sessionID' };

/**
 * 信封 canonical 判定（B1 链）：旧执行器对 typePath 不可解析的事件恒 early-passthrough；
 * 新链改为「canonical 信封放行 / 未知拦截」——此处传入真实词汇集保持 pi 已翻译产物
 * （permission.push / 三原语）原样通过，等价旧语义。
 */
const PI_ENVELOPE_CANONICAL: ReadonlySet<string> = new Set([
  ...Object.keys(EVENT_FLOW_MATRIX),
  ...TOOL_PRIMITIVE_TYPES,
]);

/**
 * pi 原生事件 → canonical（声明式，原 translatePiEvent switch 的表化）。
 * turn_end 写 part.messageID（修复：facet 规则读 messageID 而非 assistantMessageID，
 * pi 上 BudgetGuard step 此前从未触发）。v2：目标词跟随 MAFW 词汇
 * （session.idle→turn.completed；message.part.updated→part.updated）。
 */
export const PI_EVENT_MAPPINGS: EventMapping[] = [
  // F8（Plan 2）：agent_start 每 prompt 触发（agent-loop.js:43-56）→ 回合起始
  // （原映 session.updated 为 per-turn 空壳，桌面 planner 本就忽略——撤壳）
  { from: 'agent_start', to: 'turn.started' },
  { from: ['message_start', 'message_update'], to: 'part.updated',
    fields: { 'part.type': { const: 'text' }, 'part.text': { path: '$.delta', default: '' } } },
  // N2（Plan 2）：角色从 $.message.role 取值（原 const 'assistant' 把 user 消息
  // 也误标——trajectory turn_start 对 pi 从不触发，audit N2）。
  // Task 6：载荷 flat——message.* 顶层字段（time.completed/finish 随带，step facet 供给了）
  { from: 'message_end', to: 'message.updated', fields: {
      'message.role': { path: '$.message.role' },
      'message.time.completed': { path: '$.message.timestamp' },
      'message.finish': { path: '$.message.stopReason' },
    } },
  // N1（Plan 2）：live 流真事件（session.subscribe 可达）→ 工具三原语，
  // 经 gateway 侧 assembler 合帧——pi live 工具卡此前从不渲染的根因修复
  { from: 'tool_execution_start', to: 'tool.call',
    fields: { callID: { path: '$.toolCallId' }, tool: { path: '$.toolName' }, input: { path: '$.args' } } },
  { from: 'tool_execution_update', to: 'tool.delta',
    fields: { callID: { path: '$.toolCallId' }, kind: { const: 'output' }, text: { path: '$.partialResult' } } },
  { from: 'tool_execution_end', to: 'tool.result',
    fields: { callID: { path: '$.toolCallId' }, tool: { path: '$.toolName' },
              output: { path: '$.result' }, isError: { path: '$.isError' } } },
  // N1 退役：tool_call/tool_result 是 extension 钩子事件（agent-session.js:223-272
  // 只路由给扩展，session.subscribe 不可达）——live 死代码，显式 drop 保 suppressed 计数
  { from: 'tool_call', to: 'drop' },
  { from: 'tool_result', to: 'drop' },
  { from: 'turn_start', to: 'part.updated', fields: { 'part.type': { const: 'step-start' } } },
  { from: 'turn_end', to: 'part.updated',
    fields: { 'part.type': { const: 'step-finish' }, 'part.messageID': { template: 'pi_step_{$.sessionID}' } } },
  // F1（Plan 2）：agent_end/agent_settled 迁往 piTransformEvent——事件自带
  // messages 数组，按最后 assistant 消息的 stopReason 三分类（error→turn.failed
  // / aborted→turn.aborted / 其余→turn.completed）；此前无条件映 turn.completed
  // 导致 pi 引擎错误被误归因为 artifact_missing（audit F1）。
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
  // F1（Plan 2）：回合终态三分类——agent_end 自带 messages 数组
  // （pi-agent-core types.d.ts:377-379），最后 assistant 消息的 stopReason 判别；
  // 总是返回终态（不落 fallthrough 的 null——那是 suppressed 语义）。
  if (t === 'agent_end' || t === 'agent_settled') {
    const messages = Array.isArray(event?.messages) ? event.messages : [];
    const lastAssistant = [...messages].reverse().find((m: any) => m?.role === 'assistant');
    const stop = lastAssistant?.stopReason;
    const sid = event?.sessionID;
    const base = sid ? { sessionID: sid } : {};
    if (stop === 'error') {
      return {
        payload: { type: 'turn.failed', properties: { ...base, error: String(lastAssistant?.errorMessage ?? 'pi engine error') } },
        ...(sid ? { sessionID: sid } : {}),
      };
    }
    if (stop === 'aborted') {
      return { payload: { type: 'turn.aborted', properties: { ...base } }, ...(sid ? { sessionID: sid } : {}) };
    }
    return { payload: { type: 'turn.completed', properties: { ...base } }, ...(sid ? { sessionID: sid } : {}) };
  }
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
 * pi 事件翻译（表驱动）。isCanonical = 词汇表成员判定：pi 原生名均不在 canonical
 * 词汇表（经 transformEvent 兜底），信封形态的已翻译产物（permission.push/三原语）
 * 原样放行——保持输出形状与旧 switch 逐字一致。
 */
export function translatePiEvent(event: any, sessionID: string): RawRuntimeEvent | null {
  const out = applyEventMappings(
    { ...event, sessionID },
    { eventSource: PI_EVENT_SOURCE, eventMappings: PI_EVENT_MAPPINGS, transformEvent: piTransformEvent },
    (t) => PI_ENVELOPE_CANONICAL.has(t),
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
