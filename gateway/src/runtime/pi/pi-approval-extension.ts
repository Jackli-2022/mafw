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
  /** 认知面 gate（spec 2026-10-22-cognition-gate-rewrite）：autoDeny 后、政策链前；
   *  deny 更严终局 / rewrite 逐键改 input 后复评 / ask 直落 human / allow 非终局。 */
  evaluateGate?: (sessionID: string, payload: { tool: string; input: Record<string, unknown> }) =>
    { decision: 'allow' } | { decision: 'deny'; reason?: string; rule?: string }
    | { decision: 'rewrite'; input: Record<string, unknown>; rule?: string }
    | { decision: 'ask'; reason?: string; rule?: string } | null,
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

        // 2.5 认知面 gate（spec §5.3）：全 try/catch 自包——pi 的 tool_call handler
        // 异常 = fail-CLOSED（agent-loop catch 后 block），我方哲学 fail-open（C1）。
        // rewrite = Object.assign 逐键改（C2：整体重赋值被 pi 静默丢弃）→ 不 return，
        // 改写产物交下方政策链复评（C3）。ask → 落 human（跳过政策直评）。
        let gateAsk = false;
        if (evaluateGate) {
          try {
            const d = evaluateGate(gatewaySessionId, { tool: toolName, input: event.input ?? {} });
            if (d && d.decision === 'deny') {
              return { block: true, reason: (d as any).reason ?? 'denied by cognition rule' };
            }
            if (d && d.decision === 'rewrite') {
              Object.assign(event.input, (d as any).input);
              // 继续走 3——改写后的 input 复评（规范化不能绕过政策）
            } else if (d && d.decision === 'ask') {
              gateAsk = true;
            }
          } catch { /* gate 异常 → 放行继续链（fail-open） */ }
        }

        // 3. gateway 三档政策（同步直评——auto 路径不 emit，避免卡片闪烁）
        //    （gate ask 跳过政策直评，直落 human）
        if (!gateAsk && evaluatePermission) {
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
