import { randomUUID } from 'crypto';
import type { RawRuntimeEvent } from '../normalize';
import type { ApprovalBridge } from './pi-approval-bridge';

export interface ApprovalPolicy {
  autoApprove: string[];
  autoDeny: string[];
}

const DEFAULT_POLICY: ApprovalPolicy = {
  autoApprove: ['read', 'grep', 'ls', 'find', 'glob'],
  autoDeny: [],
};

export function createMafwApprovalExtension(
  bridge: ApprovalBridge,
  emitEvent: (event: RawRuntimeEvent) => void,
  policy: ApprovalPolicy = DEFAULT_POLICY,
  gatewaySessionId: string,
) {
  return {
    name: 'mafw-approval',
    on: (emitter: any) => {
      emitter.on('tool_call', async (event: any, ctx: any) => {
        const toolName = event.toolName;

        if (policy.autoApprove.includes(toolName)) {
          return;
        }

        if (policy.autoDeny.includes(toolName)) {
          return { block: true, reason: 'auto-denied by policy' };
        }

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

        const approved = await bridge.request(requestId);
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
