import { z } from 'zod';

/** mafw_task_cancel — cancel a durable task (Batch 4). */
const PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const BASE = `http://127.0.0.1:${PORT}`;

export const taskCancelTool = {
  description: '取消一个 gateway 持久任务（shell 会终止底层后台命令，subagent 会中止子会话）；幂等。',
  args: {
    taskID: z.string().describe('mafw_task_submit 返回的任务 id'),
  },
  async execute(args: { taskID: string }, ctx: { sessionID: string; abort?: AbortSignal }) {
    if (!ctx?.sessionID) return { title: '任务取消失败', output: 'missing sessionID', isError: true, metadata: {} };
    try {
      const res = await fetch(`${BASE}/api/tasks/${encodeURIComponent(args.taskID)}/cancel`, {
        method: 'POST',
        signal: ctx.abort,
      });
      let body: any = {};
      try { body = await res.json(); } catch { /* ignore */ }
      if (!res.ok) {
        return { title: '任务取消失败', output: body?.error ?? `HTTP ${res.status}`, isError: true, metadata: body };
      }
      return {
        title: '任务已取消',
        output: JSON.stringify({ id: body.id, status: body.status }),
        metadata: { taskID: body.id, status: body.status },
      };
    } catch (err: any) {
      return { title: '任务取消失败', output: `gateway unreachable: ${err?.message ?? err}`, isError: true, metadata: {} };
    }
  },
};
