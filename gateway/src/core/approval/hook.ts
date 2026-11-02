// handleOpencodeEvent 的 approval 钩子：同步评估 → 富化广播 props.mafwPolicy
// → auto 路径 fire-and-forget permissionReply（失败 warn 不重试，桌面 5s 对账兜底）。
// 调用点必须在 internal 过滤（memoryWorker drop）之前 —— 内部会话 deny 先于事件丢弃。
//
// Task 14：Spike 探针会话先过 ProbeScopeGuard（在政策环**之前**）：
//   - deny → auto-deny（主工作区写入 / 路径逃逸，人工也不批）；
//   - ask  → 强制 human（内部 Session / full-access 身份不得自动放行越界动作）；
//   - allow → 继续走正常政策（范围内可按身份自动放行）。

import type { BusinessRuntime } from '../../runtime/contract';
import { ApprovalFacet } from '../../runtime/normalize';
import { log } from '../../core/utils/logger';
import { ApprovalPolicyService } from './policy-service';
import { appendApprovalRecord } from './decision-log';

export function applyApprovalPolicy(
  policy: ApprovalPolicyService,
  runtime: BusinessRuntime | null,
  facet: ApprovalFacet,
  sessionID: string,
  props: Record<string, any>,
): void {
  try {
    // 认知面 ask 强制 human（终审 #4）：gate 规则 action:'ask' 的意图是"问人"——
    // 政策环在 auto/full-access 模式会自动答复（ask 规则变成 no-op + 卡片闪烁）。
    // forceHuman 标记（permission.asked 载荷携带）使政策环让路，保 ask 语义。
    const candidate = {
      toolName: facet.toolName,
      patterns: facet.patterns,
      metadata: facet.metadata,
    };
    const probe = policy.probeScope(sessionID, candidate);
    if (probe) props.probeScope = probe;
    const forceHuman = facet.metadata?.forceHuman === true
      || props?.forceHuman === true
      || probe?.verdict === 'ask';
    const decision = forceHuman
      ? {
        action: 'human' as const,
        reason: probe?.verdict === 'ask'
          ? `probe scope (${probe.probeId}) — action outside declared probe scope`
          : 'cognition rule requested human confirmation',
      }
      : policy.evaluate(sessionID, candidate, { probeVerdict: probe?.verdict });
    props.mafwPolicy = decision;
    // P1.5: record the verdict for later offline calibration (fail-open).
    appendApprovalRecord({
      e: 'eval',
      requestId: facet.requestId,
      sessionID,
      tool: facet.toolName,
      patterns: facet.patterns ?? [],
      action: decision.action,
      reason: (decision as any).reason,
      ts: Date.now(),
    });
    if (decision.action !== 'human') {
      const reply = decision.action === 'auto-approve' ? 'once' : 'reject';
      void runtime?.session?.permissionReply?.(sessionID, facet.requestId, reply, decision.reason)
        .catch((err: any) => log.warn(`[Approval] auto-reply failed (${decision.action}): ${err?.message ?? err}`));
    }
  } catch (err: any) {
    // 评估器异常 → 不富化（下游当 human 处理）：宁多问不误放行
    log.warn(`[Approval] evaluate failed (fail-open → human): ${err?.message ?? err}`);
  }
}
