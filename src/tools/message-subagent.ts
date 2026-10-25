import { z } from 'zod';

/** mafw_message_subagent — parent → child prompt (Batch 3). */
const PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const BASE = `http://127.0.0.1:${PORT}`;

export const messageSubagentTool = {
  description: '给当前父会话派生的子代理发一条消息（带 [from parent ...] 标记，进入子会话队列）。',
  args: {
    sessionID: z.string().describe('子代理 sessionID（mafw_spawn_subagent 返回）'),
    message: z.string().describe('要发送的消息'),
  },
  async execute(args: { sessionID: string; message: string }, ctx: { sessionID: string; abort?: AbortSignal }) {
    if (!ctx?.sessionID) return { title: '消息发送失败', output: 'missing sessionID', isError: true, metadata: {} };
    try {
      const res = await fetch(
        `${BASE}/api/sessions/${encodeURIComponent(ctx.sessionID)}/subagents/${encodeURIComponent(args.sessionID)}/message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: args.message }),
          signal: ctx.abort,
        },
      );
      let body: any = {};
      try { body = await res.json(); } catch { /* ignore */ }
      if (!res.ok) {
        return { title: '消息发送失败', output: body?.error ?? `HTTP ${res.status}`, isError: true, metadata: body };
      }
      return { title: '消息已发送', output: JSON.stringify({ ok: true }), metadata: { sessionID: args.sessionID } };
    } catch (err: any) {
      return { title: '消息发送失败', output: `gateway unreachable: ${err?.message ?? err}`, isError: true, metadata: {} };
    }
  },
};
