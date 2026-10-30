import { randomUUID } from 'crypto';
import { z } from 'zod';
import { POD_BASE, podRequest, toolError, type PodTool } from './pod-common';

function a2aMessage(input: {
  podId: string;
  toMemberId?: string;
  kind: string;
  body: string;
  sessionID: string;
}) {
  const messageId = `podmsg_${randomUUID()}`;
  return {
    payload: {
      jsonrpc: '2.0',
      id: messageId,
      method: 'message/send',
      params: {
        message: {
          role: 1,
          messageId,
          contextId: `pod:${input.podId}`,
          taskId: '',
          parts: [
            {
              content: { $case: 'text', value: input.body },
              metadata: {},
              filename: '',
              mediaType: 'text/plain',
            },
            {
              content: {
                $case: 'data',
                value: {
                  kind: input.kind,
                  toMemberId: input.toMemberId,
                  body: input.body,
                },
              },
              metadata: {},
              filename: '',
              mediaType: 'application/json',
            },
          ],
          metadata: {
            podId: input.podId,
            actorSessionID: input.sessionID,
            toMemberId: input.toMemberId,
          },
          extensions: [],
          referenceTaskIds: [],
        },
      },
    },
    messageId,
  };
}

export const podMessageTool: PodTool = {
  description: '向项目鲸群（Pod）发送 handoff/消息（默认 A2A，失败回退 REST）。',
  args: {
    podId: z.string().describe('Pod id'),
    toMemberId: z.string().optional().describe('收件 member id；省略为广播'),
    kind: z.enum(['note', 'request', 'review', 'decision', 'escalation']),
    body: z.string().describe('消息内容'),
  },
  async execute(args, ctx) {
    const a2a = a2aMessage({ ...args, sessionID: ctx.sessionID });
    try {
      const res = await fetch(`${POD_BASE}/a2a/pods/${encodeURIComponent(args.podId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0' },
        body: JSON.stringify(a2a.payload),
        signal: ctx.abort,
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(body?.error?.message ?? body?.error ?? `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const result = body?.result?.task ?? body?.result ?? body;
      return {
        title: '鲸群 handoff 已发送（A2A）',
        output: JSON.stringify(result),
        metadata: {
          podId: args.podId,
          protocol: 'a2a',
          taskId: result?.id,
          messageId: a2a.messageId,
        },
      };
    } catch (err: any) {
      if (err?.status && err.status !== 404) {
        return toolError('鲸群消息发送失败', err);
      }
      try {
        const body = await podRequest(`/api/pods/${encodeURIComponent(args.podId)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toMemberId: args.toMemberId,
            kind: args.kind,
            body: args.body,
            actorSessionID: ctx.sessionID,
          }),
        }, ctx);
        return {
          title: '鲸群消息已发送（REST 回退）',
          output: JSON.stringify(body?.message ?? body),
          metadata: {
            podId: args.podId,
            protocol: 'rest',
            messageId: body?.message?.id,
          },
        };
      } catch (fallbackErr) {
        return toolError('鲸群消息发送失败', fallbackErr);
      }
    }
  },
};
