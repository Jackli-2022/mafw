import { z } from 'zod';

/** mafw_task_message — message a durable subagent task (Batch 4). */
const PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const BASE = `http://127.0.0.1:${PORT}`;

export const taskMessageTool = {
  description: '给 gateway 持久子代理任务发一条消息（仅 subagent 任务；shell 任务不支持 stdin）。',
  args: {
    taskID: z.string().describe('mafw_task_submit 返回的任务 id'),
    message: z.string().describe('要发送的消息'),
  },
  async execute(args: { taskID: string; message: string }, ctx: { sessionID: string; abort?: AbortSignal }) {
    if (!ctx?.sessionID) return { title: '消息发送失败', output: 'missing sessionID', isError: true, metadata: {} };
    try {
      const res = await fetch(`${BASE}/api/tasks/${encodeURIComponent(args.taskID)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: args.message }),
        signal: ctx.abort,
      });
      let body: any = {};
      try { body = await res.json(); } catch { /* ignore */ }
      if (!res.ok) {
        return { title: '消息发送失败', output: body?.error ?? `HTTP ${res.status}`, isError: true, metadata: body };
      }
      return { title: '消息已发送', output: JSON.stringify({ ok: true }), metadata: { taskID: args.taskID } };
    } catch (err: any) {
      return { title: '消息发送失败', output: `gateway unreachable: ${err?.message ?? err}`, isError: true, metadata: {} };
    }
  },
};
