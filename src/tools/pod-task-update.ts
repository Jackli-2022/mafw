import { z } from 'zod';
import { podRequest, toolError, type PodTool } from './pod-common';

export const podTaskUpdateTool: PodTool = {
  description: '更新项目鲸群（Pod）任务板的任务状态或负责人。',
  args: {
    podId: z.string().describe('Pod id'),
    taskId: z.string().describe('任务 id'),
    status: z.enum(['pending', 'in_progress', 'blocked', 'review', 'done', 'failed', 'reopened']).optional(),
    ownerMemberId: z.string().optional(),
  },
  async execute(args, ctx) {
    try {
      const body = await podRequest(
        `/api/pods/${encodeURIComponent(args.podId)}/tasks/${encodeURIComponent(args.taskId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: args.status,
            ownerMemberId: args.ownerMemberId,
            actorSessionID: ctx.sessionID,
          }),
        },
        ctx,
      );
      return {
        title: '鲸群任务已更新',
        output: JSON.stringify(body?.task ?? body),
        metadata: { podId: args.podId, taskId: args.taskId, status: body?.task?.status },
      };
    } catch (err) {
      return toolError('鲸群任务更新失败', err);
    }
  },
};
