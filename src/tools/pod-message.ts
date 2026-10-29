import { z } from 'zod';
import { podRequest, toolError, type PodTool } from './pod-common';

export const podMessageTool: PodTool = {
  description: '向项目鲸群（Pod）的邮箱发送消息（可广播或指定成员）。',
  args: {
    podId: z.string().describe('Pod id'),
    toMemberId: z.string().optional().describe('收件 member id；省略为广播'),
    kind: z.enum(['note', 'request', 'review', 'decision', 'escalation']),
    body: z.string().describe('消息内容'),
  },
  async execute(args, ctx) {
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
        title: '鲸群消息已发送',
        output: JSON.stringify(body?.message ?? body),
        metadata: { podId: args.podId, messageId: body?.message?.id },
      };
    } catch (err) {
      return toolError('鲸群消息发送失败', err);
    }
  },
};
