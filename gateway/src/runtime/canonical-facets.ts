/**
 * CanonicalFacetTable —— canonical 事件类型 → EventFacets 的纯数据规则表。
 * 初始内容 = normalizeOpencodeEvent（normalize.ts）if 链的逐行表化；
 * opencode 知识与执行机制分离，v2/新 runtime 落地时只加规则行。
 */
import { getPath, evalConditions, Condition } from './path-expr';
import type { EventFacets, StepEndedProps, ApprovalFacet } from './normalize';

export interface FacetRule {
  type: string;
  when?: Condition[];
  step?: {
    /** string[] = 多路径回退（取首个 truthy） */
    sessionID: string | string[];
    assistantMessageID: string;
    finish: string;
    /** 仅 legacy 行：sessionID 解析失败时回退 chain 并以此判定是否产出 */
    requiresSessionID?: boolean;
  };
  chatSignal?: 'delta' | 'complete' | 'error';
  deltaText?: string;
  chatError?: string;
  broadcast?: 'idle' | 'error' | 'passthrough';
  compaction?: 'start' | 'end';
  approval?: { requestId: string | string[]; toolName: string | string[]; patterns?: string };
}

export const CANONICAL_FACET_RULES: FacetRule[] = [
  // step 三载体（行序 = normalize.ts if 链顺序）
  { type: 'session.next.step.ended',
    step: { sessionID: ['$.sessionID', '$.part.sessionID', '$.info.sessionID'], assistantMessageID: '$.assistantMessageID', finish: '$.finish', requiresSessionID: true } },
  { type: 'message.part.updated', when: [{ path: '$.part.type', equals: 'step-finish' }],
    step: { sessionID: '$.part.sessionID', assistantMessageID: '$.part.messageID', finish: '$.part.reason' } },
  { type: 'message.updated',
    when: [{ path: '$.info.role', equals: 'assistant' }, { path: '$.info.time.completed', exists: true }],
    step: { sessionID: '$.info.sessionID', assistantMessageID: '$.info.id', finish: '$.info.finish' } },
  // chatSignal（delta 双路径：part.text 优先）
  { type: 'message.part.updated', when: [{ path: '$.part.text', exists: true }], chatSignal: 'delta', deltaText: '$.part.text' },
  { type: 'message.part.updated', when: [{ path: '$.delta', exists: true }], chatSignal: 'delta', deltaText: '$.delta' },
  { type: 'session.idle', chatSignal: 'complete', broadcast: 'idle' },
  { type: 'message.updated', chatSignal: 'complete' },
  { type: 'session.error', chatSignal: 'error', chatError: '$.error', broadcast: 'error' },
  { type: 'message.error', chatSignal: 'error', chatError: '$.error' },
  // compaction
  { type: 'session.compacting', compaction: 'start' },
  { type: 'session.compacted', compaction: 'end' },
  // approval 双形状对齐；metadata 构造为执行器内置特例
  { type: 'permission.asked',
    approval: { requestId: ['$.requestId', '$.id'], toolName: ['$.permission', '$.toolName'], patterns: '$.patterns' } },
];

type FacetSubset = Pick<EventFacets, 'step' | 'chatSignal' | 'deltaText' | 'chatError' | 'broadcast' | 'compaction' | 'approval'>;

function firstTruthy(paths: string | string[], props: any): unknown {
  for (const p of Array.isArray(paths) ? paths : [paths]) {
    const v = getPath(props, p);
    if (v) return v;
  }
  return undefined;
}

export function evaluateFacetRules(rules: FacetRule[], type: string, props: any, chainSessionID: string | undefined): FacetSubset {
  const out: FacetSubset = { step: null, chatSignal: null, deltaText: undefined, chatError: undefined, broadcast: 'passthrough', compaction: null, approval: null };
  for (const r of rules) {
    if (r.type !== type) continue;
    if (!evalConditions(r.when, props)) continue;
    if (!out.step && r.step) {
      let sid = firstTruthy(r.step.sessionID, props) as string | undefined;
      if (r.step.requiresSessionID) {
        sid = sid || chainSessionID;
        if (!sid) continue; // legacy 行：无 sessionID 不产 step
      }
      out.step = {
        sessionID: sid,
        assistantMessageID: getPath(props, r.step.assistantMessageID) as string | undefined,
        finish: getPath(props, r.step.finish) as string | undefined,
      } as StepEndedProps;
    }
    if (!out.chatSignal && r.chatSignal) {
      out.chatSignal = r.chatSignal;
      if (r.deltaText) out.deltaText = getPath(props, r.deltaText) as string | undefined;
      if (r.chatError) out.chatError = getPath(props, r.chatError) || 'Unknown error'; // 内置：对齐现状 `|| 'Unknown error'`
    }
    if (out.broadcast === 'passthrough' && r.broadcast) out.broadcast = r.broadcast;
    if (!out.compaction && r.compaction) out.compaction = r.compaction;
    if (!out.approval && r.approval && chainSessionID) {
      const requestId = firstTruthy(r.approval.requestId, props);
      const toolName = firstTruthy(r.approval.toolName, props);
      if (requestId && toolName) {
        // metadata 构造（props.metadata ?? {args, risk}）为执行器内置特例——
        // 对象构造非纯路径表达，属 canonical approval 信封约定。
        const metadata = props?.metadata ?? (props?.args !== undefined || props?.risk !== undefined
          ? { args: props?.args, risk: props?.risk } : undefined);
        const patterns = r.approval.patterns ? getPath(props, r.approval.patterns) : undefined;
        out.approval = {
          requestId: String(requestId),
          toolName: String(toolName),
          patterns: Array.isArray(patterns) ? patterns : [],
          metadata,
        } as ApprovalFacet;
      }
    }
  }
  return out;
}
