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

/** permission.asked 切面载荷：双 runtime 形状在此对齐
 *  （opencode: id/permission/patterns/metadata；pi: requestId/toolName/args/risk）。 */
export interface ApprovalFacet {
  requestId: string;
  toolName: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
}

/**
 * 畸形事件判定：类型与属性全空 = 归一化后无任何可消费信息。
 * handleOpencodeEvent 入口据此做限频 warn——runtime 插件发坏事件时
 * 给出可定位诊断，而不是静默穿过下发到桌面/TUI。
 */
export function isMalformedEvent(evt: RawRuntimeEvent | null | undefined): boolean {
  if (!evt || typeof evt !== 'object') return true;
  const type = evt.payload?.type || evt.type;
  const props = evt.payload?.properties || evt.properties;
  return !type && (!props || (typeof props === 'object' && Object.keys(props).length === 0));
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
  /** 会话压缩信号：'start'=压缩前（仅 pi 有），'end'=压缩完成；无事件恒 null */
  compaction: 'start' | 'end' | null;
  /** 工具事件携带的 shell command（自更新调用者定位用） */
  toolCommand?: string;
  /** permission.asked 切面：非 asked 或畸形（缺 requestId/toolName）恒 null（喂 approval policy） */
  approval: ApprovalFacet | null;
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

  const compaction: EventFacets['compaction'] =
    type === 'session.compacting' ? 'start' : type === 'session.compacted' ? 'end' : null;

  // approval facet：permission.asked 双 runtime 形状对齐（opencode: id/permission/
  // patterns/metadata；pi: requestId/toolName/args/risk）。缺 requestId/toolName 视为
  // 畸形（恒 null），下游按无切面处理。
  let approval: ApprovalFacet | null = null;
  if (type === 'permission.asked' && sessionID) {
    const requestId = props?.requestId ?? props?.id;
    const toolName = props?.permission ?? props?.toolName;
    if (requestId && toolName) {
      approval = {
        requestId: String(requestId),
        toolName: String(toolName),
        patterns: Array.isArray(props?.patterns) ? props.patterns : [],
        metadata: props?.metadata ?? (props?.args !== undefined || props?.risk !== undefined
          ? { args: props?.args, risk: props?.risk }
          : undefined),
      };
    }
  }

  return { type, properties: props, sessionID, directory: evt?.directory, step, chatSignal, deltaText, chatError, broadcast, compaction, toolCommand, approval };
}
