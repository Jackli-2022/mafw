/**
 * 事件归一化器 —— 把 canonical 事件翻译成 EventFacets（正交切面）。
 *
 * facet 提取规则已表化到 canonical-facets.ts 的 CANONICAL_FACET_RULES；
 * 本文件只保留信封解包、sessionID 提取链、toolCommand 特例与畸形判定。
 * 注意：facets 是正交的（一个事件可同时有 step 与 chatSignal），这是为了
 * 与 handleOpencodeEvent 的多路消费行为逐点等价（oracle 测试钉扎）。
 */
import { CANONICAL_FACET_RULES, evaluateFacetRules } from './canonical-facets';

/** 一个已结算的 LLM step（喂 BudgetGuard 回合计数）。 */
export interface StepEndedProps {
  sessionID?: string
  assistantMessageID?: string
  finish?: string
}

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
  /** 非 null = 此事件标志一个已结算的 LLM step（喂 BudgetGuard 回合计数） */
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
  // sessionID 五层提取链：信封约定（非 facet 规则），执行器内置。
  const sessionID =
    props?.sessionID || props?.part?.sessionID || props?.info?.sessionID || payload?.sessionID || evt?.sessionID;

  const facets = evaluateFacetRules(CANONICAL_FACET_RULES, type, props, sessionID);

  // toolCommand：type.includes('tool') + 信封 payload.args 依赖，表化不了——
  // 执行器内置特例（spec §5）。
  const toolArgs = props?.args || props?.info?.args || payload?.args;
  const command = typeof toolArgs?.command === 'string' ? toolArgs.command : '';
  const toolCommand = command && type.includes('tool') ? command : undefined;

  return { type, properties: props, sessionID, directory: evt?.directory, toolCommand, ...facets };
}
