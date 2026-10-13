/**
 * CanonicalFacetTable —— canonical 事件类型 → EventFacets 的纯数据规则表。
 * v2（2026-10-12）：broadcast 切面随 Mode A 改写 hack 删除；toolCommand
 * 从 normalize.ts 内置特例升为规则行（载体：tool part 快照的
 * state.input.command——原 session.next.tool.* 载体随词汇除名）。
 * 词汇常量镜像 ./mafw-vocabulary.ts；规则行序即求值序（正交切面可叠加）。
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
  };
  chatSignal?: 'delta' | 'complete' | 'error';
  deltaText?: string;
  chatError?: string;
  compaction?: 'start' | 'end';
  /** tool part 快照携带的 shell command 路径（自更新调用者定位用；多路径回退取首个） */
  toolCommand?: string | string[];
  approval?: { requestId: string | string[]; toolName: string | string[]; patterns?: string };
}

export const CANONICAL_FACET_RULES: FacetRule[] = [
  // step 双载体（legacy session.next.step.ended 载体随词汇 v2 除名）
  { type: 'part.updated', when: [{ path: '$.part.type', equals: 'step-finish' }],
    step: { sessionID: '$.part.sessionID', assistantMessageID: '$.part.messageID', finish: '$.part.reason' } },
  { type: 'message.updated',
    when: [{ path: '$.info.role', equals: 'assistant' }, { path: '$.info.time.completed', exists: true }],
    step: { sessionID: '$.info.sessionID', assistantMessageID: '$.info.id', finish: '$.info.finish' } },
  // chatSignal（delta 双路径：part.text 优先）
  { type: 'part.updated', when: [{ path: '$.part.text', exists: true }], chatSignal: 'delta', deltaText: '$.part.text' },
  { type: 'part.updated', when: [{ path: '$.delta', exists: true }], chatSignal: 'delta', deltaText: '$.delta' },
  { type: 'turn.completed', chatSignal: 'complete' },
  { type: 'message.updated', chatSignal: 'complete' },
  { type: 'turn.failed', chatSignal: 'error', chatError: '$.error' },
  // toolCommand：载体从 session.next.tool.*（随 v2 除名）迁到 tool part 快照
  // （opencode ToolPart 与 assembler 合成快照都携带 state.input.command）。
  // 多 key 候选链：opencode/pi=command；防新 runtime 的 shell 工具换 key 失明。
  { type: 'part.updated', when: [{ path: '$.part.type', equals: 'tool' }],
    toolCommand: ['$.part.state.input.command', '$.part.state.input.cmd', '$.part.state.input.script'] },
  // compaction
  { type: 'session.compacting', compaction: 'start' },
  { type: 'session.compacted', compaction: 'end' },
  // approval 双形状对齐（opencode: id/permission/patterns/metadata；pi: requestId/toolName/args/risk）；
  // v2 增量可选字段 options[]/suggestedRule 随 properties 透传，facet 不动。
  // metadata 构造为执行器内置特例。
  { type: 'permission.asked',
    approval: { requestId: ['$.requestId', '$.id'], toolName: ['$.permission', '$.toolName'], patterns: '$.patterns' } },
];

type FacetSubset = Pick<EventFacets, 'step' | 'chatSignal' | 'deltaText' | 'chatError' | 'compaction' | 'toolCommand' | 'approval'>;

function firstTruthy(paths: string | string[], props: any): unknown {
  for (const p of Array.isArray(paths) ? paths : [paths]) {
    const v = getPath(props, p);
    if (v) return v;
  }
  return undefined;
}

export function evaluateFacetRules(rules: FacetRule[], type: string, props: any, chainSessionID: string | undefined): FacetSubset {
  const out: FacetSubset = { step: null, chatSignal: null, deltaText: undefined, chatError: undefined, compaction: null, toolCommand: undefined, approval: null };
  for (const r of rules) {
    if (r.type !== type) continue;
    if (!evalConditions(r.when, props)) continue;
    if (!out.step && r.step) {
      // 旧语义保留：规则命中即产出（sessionID 可为 undefined——legacy 行的
      // requiresSessionID 门已随载体除名；下游 BudgetGuard 自行按 sessionID 门控）
      out.step = {
        sessionID: firstTruthy(r.step.sessionID, props) as string | undefined,
        assistantMessageID: getPath(props, r.step.assistantMessageID) as string | undefined,
        finish: getPath(props, r.step.finish) as string | undefined,
      } as StepEndedProps;
    }
    if (!out.chatSignal && r.chatSignal) {
      out.chatSignal = r.chatSignal;
      if (r.deltaText) out.deltaText = getPath(props, r.deltaText) as string | undefined;
      if (r.chatError) out.chatError = getPath(props, r.chatError) || 'Unknown error'; // 内置：对齐现状 `|| 'Unknown error'`
    }
    if (!out.compaction && r.compaction) out.compaction = r.compaction;
    if (out.toolCommand === undefined && r.toolCommand) {
      const c = firstTruthy(r.toolCommand, props);
      if (typeof c === 'string' && c) out.toolCommand = c;
    }
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
