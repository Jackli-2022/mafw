import { z } from 'zod';

/** mafw_task_list — list durable tasks for the current parent session (Batch 4). */
const PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const BASE = `http://127.0.0.1:${PORT}`;

export const taskListTool = {
  description: '列出当前会话提交的 gateway 持久任务（working/input_required/completed/failed/cancelled），可按状态过滤。',
  args: {
    status: z.enum(['working', 'input_required', 'completed', 'failed', 'cancelled']).optional().describe('可选状态过滤'),
  },
  async execute(args: { status?: string }, ctx: { sessionID: string; abort?: AbortSignal }) {
    if (!ctx?.sessionID) return { title: '任务列表读取失败', output: 'missing sessionID', isError: true, metadata: {} };
    try {
      const q = new URLSearchParams({ parentSessionID: ctx.sessionID });
      if (args.status) q.set('status', args.status);
      const res = await fetch(`${BASE}/api/tasks?${q.toString()}`, { signal: ctx.abort });
      let body: any = {};
      try { body = await res.json(); } catch { /* ignore */ }
      if (!res.ok) {
        return { title: '任务列表读取失败', output: body?.error ?? `HTTP ${res.status}`, isError: true, metadata: body };
      }
      return {
        title: `任务列表（${body.items?.length ?? 0}）`,
        output: JSON.stringify(body),
        metadata: { count: body.items?.length ?? 0 },
      };
    } catch (err: any) {
      return { title: '任务列表读取失败', output: `gateway unreachable: ${err?.message ?? err}`, isError: true, metadata: {} };
    }
  },
};
