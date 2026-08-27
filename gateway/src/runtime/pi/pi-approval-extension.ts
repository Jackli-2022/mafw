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
        const sessionID = ctx.sessionId;

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

        emitEvent({
          payload: {
            type: 'permission.replied',
            properties: {
              sessionID,
              requestId,
              approved,
            },
          },
        });

        if (!approved) {
          return { block: true, reason: 'rejected by user' };
        }
      });
    },
  };
}
