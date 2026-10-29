import { z } from 'zod';
import { podRequest, resolvePodId, toolError, type PodTool } from './pod-common';

export const podTaskCreateTool: PodTool = {
  description: '在项目鲸群（Pod）的任务板创建一条手工任务。',
  args: {
    podId: z.string().describe('Pod id'),
    goalId: z.string().optional().describe('关联 goal id'),
    title: z.string().describe('任务标题'),
    ownerMemberId: z.string().optional().describe('负责人 member id'),
  },
  async execute(args, ctx) {
    try {
      const podId = await resolvePodId(ctx, args.podId);
      const body = await podRequest(`/api/pods/${encodeURIComponent(podId)}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goalId: args.goalId,
          title: args.title,
          ownerMemberId: args.ownerMemberId,
          actorSessionID: ctx.sessionID,
        }),
      }, ctx);
      return {
        title: '鲸群任务已创建',
        output: JSON.stringify(body?.task ?? body),
        metadata: { podId, taskId: body?.task?.id },
      };
    } catch (err) {
      return toolError('鲸群任务创建失败', err);
    }
  },
};
