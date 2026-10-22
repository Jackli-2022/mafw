/**
 * CognitionGate — gate/rewrite 服务（spec：2026-10-22-cognition-gate-rewrite-design.md §5.3）。
 *
 * 三方法全同步全 try/catch fail-open（C1 服务层半——pi 侧另有 handler 级防护）：
 * - gateToolCall：deny/ask/rewrite 决策（主文本经 commandTextOf 候选链）
 * - gatePrompt：内部会话豁免先行（C5）→ deny/transform
 * - applyToolResultRedact：命中 on:tool_result 才变换（redactSecrets 可注入）
 *
 * 规则现读不快照（C9）：getRules 每次求值调用（index 注入侧做引用比较缓存）。
 * onEvent 在 deny/rewrite/transform 命中时发射（cognition_gate 可观测）。
 */
import {
  CognitionRule, GateDecision, evaluateGateRules, evaluateTransformRule, ruleMatches, applyRedact,
} from './rules';
import { commandTextOf } from '../approval/safety-classifier';
import { redactSecrets } from '../../recall/redact';

export interface CognitionGateDeps {
  getRules: () => CognitionRule[];
  isInternalSession: (sessionID: string) => boolean;
  onEvent?: (e: { sessionID: string; rule?: string; action: string; tool?: string; reason?: string }) => void;
  redact?: (s: string) => string;
}

export function createCognitionGate(deps: CognitionGateDeps) {
  const redactFn = deps.redact ?? redactSecrets;
  const emit = (sessionID: string, action: string, e: { rule?: string; tool?: string; reason?: string }): void => {
    try { deps.onEvent?.({ sessionID, action, ...e }); } catch { /* fail-open */ }
  };

  return {
    /** tool_call 决策：null = 无命中（放行，链继续）。异常 fail-open 返 null。 */
    gateToolCall(sessionID: string, payload: { tool: string; input: Record<string, unknown> }): GateDecision | null {
      try {
        const text = commandTextOf({ toolName: payload.tool, patterns: [], metadata: { args: payload.input } }) ?? '';
        const d = evaluateGateRules(deps.getRules(), { kind: 'tool_call', tool: payload.tool, text, input: payload.input });
        if (d && d.decision !== 'allow') {
          emit(sessionID, d.decision, { rule: (d as any).rule, tool: payload.tool, reason: (d as any).reason });
        }
        return d;
      } catch {
        return null;
      }
    },

    /** prompt 决策：内部会话豁免（C5）→ deny/transform/allow。异常 fail-open allow。 */
    gatePrompt(
      sessionID: string,
      text: string,
    ): { decision: 'allow' } | { decision: 'deny'; reason?: string; rule?: string } | { decision: 'transform'; text: string; rule?: string } {
      try {
        // C5 内部豁免：编排/通知 prompt（goal 节点/manager/worker/btw）不受用户规则管辖——
        // 误杀会导致回合静默不启动 → watchdog 重试 → archive_fail（反目标级风险）
        if (deps.isInternalSession(sessionID)) return { decision: 'allow' };
        const rules = deps.getRules();
        const deny = evaluateGateRules(rules, { kind: 'prompt', text });
        if (deny && deny.decision === 'deny') {
          emit(sessionID, 'deny', { rule: (deny as any).rule, reason: (deny as any).reason });
          return { decision: 'deny', ...(deny.reason ? { reason: deny.reason } : {}), ...(deny.rule ? { rule: deny.rule } : {}) };
        }
        const transform = evaluateTransformRule(rules, { text });
        if (transform) {
          emit(sessionID, 'transform', { rule: transform.rule });
          return { decision: 'transform', text: transform.text, ...(transform.rule ? { rule: transform.rule } : {}) };
        }
        return { decision: 'allow' };
      } catch {
        return { decision: 'allow' };
      }
    },

    /** tool_result 输出 redact：命中 on:tool_result 规则才变换（非文本部件透传 C7）。异常原样返回。 */
    applyToolResultRedact<T extends { type: string; text?: string; [k: string]: unknown }>(
      sessionID: string,
      tool: string,
      content: T[],
    ): T[] {
      try {
        const rules = deps.getRules();
        const hit = rules.find(r => r.action === 'redact' && ruleMatches(r, { kind: 'tool_result', tool, text: content.filter((c: any) => c?.type === 'text').map((c: any) => c?.text ?? '').join('\n') }));
        if (!hit) return content;
        const out = applyRedact(content, redactFn);
        emit(sessionID, 'redact', { rule: hit.name, tool });
        return out;
      } catch {
        return content;
      }
    },
  };
}
