import { randomUUID } from 'crypto';
import type { RawRuntimeEvent } from '../normalize';
import type { ApprovalBridge } from './pi-approval-bridge';

export interface ApprovalPolicy {
  /** 会话级动态 allowlist（'always' 决定 + config 显式预置；2026-10-08 起无隐式默认五件套） */
  autoApprove: string[];
  /** 显式配置的拒绝表（默认空） */
  autoDeny: string[];
}

const DEFAULT_POLICY: ApprovalPolicy = { autoApprove: [], autoDeny: [] };

/** gateway 三档政策的同步直评（ApprovalPolicyService.evaluate 的窄化签名）。 */
export type PermissionEvaluator = (
  sessionID: string,
  candidate: { toolName: string; patterns?: string[]; metadata?: Record<string, unknown> },
) => { action: 'auto-approve' | 'auto-deny' | 'human'; reason: string } | null;

export function createMafwApprovalExtension(
  bridge: ApprovalBridge,
  emitEvent: (event: RawRuntimeEvent) => void,
  policy: ApprovalPolicy = DEFAULT_POLICY,
  gatewaySessionId: string,
  evaluatePermission?: PermissionEvaluator,
) {
  return {
    name: 'mafw-approval',
    on: (emitter: any) => {
      emitter.on('tool_call', async (event: any, ctx: any) => {
        const toolName = event.toolName;

        // 1. 会话 allowlist（用户 'always' / config 显式预置）
        if (policy.autoApprove.includes(toolName)) {
          return;
        }

        // 2. 显式 autoDeny
        if (policy.autoDeny.includes(toolName)) {
          return { block: true, reason: 'auto-denied by policy' };
        }

        // 3. gateway 三档政策（同步直评——auto 路径不 emit，避免卡片闪烁）
        if (evaluatePermission) {
          try {
            const decision = evaluatePermission(gatewaySessionId, {
              toolName,
              patterns: [],
              metadata: { args: event.input },
            });
            if (decision?.action === 'auto-approve') return;
            if (decision?.action === 'auto-deny') {
              return { block: true, reason: decision.reason || 'auto-denied by gateway policy' };
            }
          } catch { /* 评估器异常 → human 兜底（宁多问不误放行） */ }
        }

        // 4. human：emit permission.asked + await bridge
        //    （ask→normalize facet→applyApprovalPolicy 政策环仍是兜底路径）
        const requestId = randomUUID();
        // pi 原生 ctx.sessionId 与 gateway 生成的 pi_* 注册 id 不同——事件
        // 必须携带 gateway id，否则 permissionReply 按 id 查 bridge 404。
        const sessionID = gatewaySessionId;

        emitEvent({
          payload: {
            type: 'permission.asked',
            properties: {
              sessionID,
              requestId,
              toolName,
              args: event.input,
              risk: 'medium',
            },
          },
        });

        // permissionList 元数据：PendingMeta 与 permission.asked 事件同源
        const approved = await bridge.request(requestId, {
          sessionID,
          permission: toolName,
          patterns: [],
          metadata: { args: event.input, risk: 'medium' },
        });
        const record = bridge.lastDecision(requestId);
        const decision = record?.decision ?? (approved ? 'once' : 'reject');
        const message = record?.message;

        emitEvent({
          payload: {
            type: 'permission.replied',
            properties: {
              sessionID,
              requestId,
              approved,
              ...(decision !== 'once' ? { decision, ...(message ? { message } : {}) } : {}),
            },
          },
        });

        if (decision === 'always') {
          // session 级动态 allowlist：policy 是构造时共享引用，后续 tool_call 即时免审
          if (!policy.autoApprove.includes(toolName)) policy.autoApprove.push(toolName);
          return;
        }

        if (!approved) {
          return { block: true, reason: message || 'rejected by user' };
        }
      });
    },
  };
}
