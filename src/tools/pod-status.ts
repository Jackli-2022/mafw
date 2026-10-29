import { z } from 'zod';
import { podRequest, resolvePodId, toolError, type PodTool } from './pod-common';

export const podStatusTool: PodTool = {
  description: '查看项目鲸群（Pod）的成员、任务、邮箱和当前 goal 状态；podId 可省略，按当前会话目录解析。',
  args: {
    podId: z.string().optional().describe('Pod id；省略时按当前会话目录解析'),
  },
  async execute(args, ctx) {
    try {
      const podId = await resolvePodId(ctx, args.podId);
      const body = await podRequest(`/api/pods/${encodeURIComponent(podId)}`, { method: 'GET' }, ctx);
      return {
        title: `鲸群状态 · ${body?.pod?.name ?? podId}`,
        output: JSON.stringify(body),
        metadata: { podId, members: body?.members?.length ?? 0, tasks: body?.tasks?.length ?? 0 },
      };
    } catch (err) {
      return toolError('鲸群状态读取失败', err);
    }
  },
};
