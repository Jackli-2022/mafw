/**
 * 事件归一化器 —— 把 runtime 原生事件翻译成 EventFacets（正交切面）。
 *
 * 每个 runtime 一个 normalize 函数；index.ts 的调度逻辑只消费 facets，
 * 不再出现 runtime 事件类型字符串。opencode 版本知识（≥1.18 无
 * session.next.step.ended，step 以 step-finish part 结算）只存在于本文件
 * 和 step-inject.ts 的两个 helper 里。
 *
 * 注意：facets 是正交的（一个事件可同时有 step 与 chatSignal），这是为了
 * 与现 handleOpencodeEvent 的多路消费行为逐点等价。
 */
import {
  stepPropsFromPartUpdated,
  stepPropsFromMessageUpdated,
  StepEndedProps,
} from '../recall/step-inject';

/** GlobalEvent 信封或裸事件，两者都接受。 */
export interface RawRuntimeEvent {
  directory?: string;
  payload?: { type?: string; properties?: any; sessionID?: string; args?: any };
  type?: string;
  properties?: any;
  sessionID?: string;
}

export interface EventFacets {
  /** 原始 runtime 事件类型（透传，用于 trajectory/broadcast） */
  type: string;
  /** 原始 properties（透传） */
  properties: any;
  sessionID?: string;
  directory?: string;
  /** 非 null = 此事件标志一个已结算的 LLM step（喂 step-inject） */
  step: StepEndedProps | null;
  /** chat 转发信号（per-session SSE Mode B） */
  chatSignal: 'delta' | 'complete' | 'error' | null;
  deltaText?: string;
  chatError?: unknown;
  /** 全局广播形态（Mode A，桌面 renderer） */
  broadcast: 'idle' | 'error' | 'passthrough';
  /** 工具事件携带的 shell command（自更新调用者定位用） */
  toolCommand?: string;
}

export function normalizeOpencodeEvent(evt: RawRuntimeEvent): EventFacets {
  const payload = evt?.payload || {};
  const type = payload?.type || evt?.type || '';
  const props = payload?.properties || evt?.properties || {};
  const sessionID =
    props?.sessionID || props?.part?.sessionID || props?.info?.sessionID || payload?.sessionID || evt?.sessionID;

  // settled-step 归一化：legacy step.ended（保留兜底）→ step-finish part →
  // completed assistant message，与现 handleOpencodeEvent 的判定顺序一致。
  let step: StepEndedProps | null = null;
  if (type === 'session.next.step.ended' && sessionID) {
    step = { sessionID, assistantMessageID: props?.assistantMessageID, finish: props?.finish };
  } else if (type === 'message.part.updated') {
    step = stepPropsFromPartUpdated(props);
  } else if (type === 'message.updated') {
    step = stepPropsFromMessageUpdated(props);
  }

  let chatSignal: EventFacets['chatSignal'] = null;
  let deltaText: string | undefined;
  let chatError: unknown;
  if (type === 'message.part.updated') {
    const text = props?.part?.text || props?.delta || '';
    if (text) {
      deltaText = text;
      chatSignal = 'delta';
    }
  } else if (type === 'session.idle' || type === 'message.updated') {
    chatSignal = 'complete';
  } else if (type === 'session.error' || type === 'message.error') {
    chatSignal = 'error';
    chatError = props?.error || 'Unknown error';
  }

  const broadcast: EventFacets['broadcast'] =
    type === 'session.idle' ? 'idle' : type === 'session.error' ? 'error' : 'passthrough';

  // 自更新调用者定位：仅工具事件携带 command 时提取。
  // （'session.next.tool' 已包含 'tool' 子串，includes('tool') 一条即覆盖，
  //  与现 `(type.includes('tool') || type.includes('session.next.tool'))` 等价。）
  const toolArgs = props?.args || props?.info?.args || payload?.args;
  const command = typeof toolArgs?.command === 'string' ? toolArgs.command : '';
  const toolCommand = command && type.includes('tool') ? command : undefined;

  return { type, properties: props, sessionID, directory: evt?.directory, step, chatSignal, deltaText, chatError, broadcast, toolCommand };
}
