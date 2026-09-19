// handleOpencodeEvent 的 approval 钩子：同步评估 → 富化广播 props.mafwPolicy
// → auto 路径 fire-and-forget permissionReply（失败 warn 不重试，桌面 5s 对账兜底）。
// 调用点必须在 internal 过滤（memoryWorker drop）之前 —— 内部会话 deny 先于事件丢弃。

import { AgentRuntime } from '../../runtime/contract';
import { ApprovalFacet } from '../../runtime/normalize';
import { log } from '../../core/utils/logger';
import { ApprovalPolicyService } from './policy-service';

export function applyApprovalPolicy(
  policy: ApprovalPolicyService,
  runtime: AgentRuntime | null,
  facet: ApprovalFacet,
  sessionID: string,
  props: Record<string, any>,
): void {
  try {
    const decision = policy.evaluate(sessionID, {
      toolName: facet.toolName,
      patterns: facet.patterns,
      metadata: facet.metadata,
    });
    props.mafwPolicy = decision;
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
