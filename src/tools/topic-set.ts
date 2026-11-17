import { z } from 'zod';

/**
 * mafw_topic_set — set/correct the current per-session attention topic.
 * This is not a memory/fact write and does not mark an episode boundary.
 */

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const TOPIC_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/recall/topic`;

export interface TopicSetTool {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (
    args: {
      topic?: string;
      matterId?: string;
      summary?: string;
      entities?: string[];
      aliases?: string[];
      openLoops?: string[];
      retrievalKeys?: string[];
      active?: boolean;
      expectedRevision?: number;
    },
    ctx: { sessionID: string; abort: AbortSignal },
  ) => Promise<{ title: string; output: string; metadata: Record<string, unknown> }>;
}

export const topicSetTool: TopicSetTool = {
  description:
    '设置或纠正当前会话正在讨论的主题。每轮 recall 顶部会显示主题；未设置时使用本工具。' +
    '主题只是当前注意力状态，不写入长期事实，也不替代 mafw_mark_episode_boundary。' +
    '话题偏移时用同一工具纠正；active:false 可关闭主题。',
  args: {
    topic: z.string().max(200).optional().describe('当前主题；首次设置或纠偏时填写'),
    matterId: z.string().max(200).optional().describe('可选：关联已有事情的稳定 ID'),
    summary: z.string().max(1000).optional().describe('当前主题的一句话说明'),
    entities: z.array(z.string()).max(32).optional().describe('当前涉及的对象/实体'),
    aliases: z.array(z.string()).max(32).optional().describe('主题别名，帮助后续指代'),
    openLoops: z.array(z.string()).max(32).optional().describe('当前未解决事项'),
    retrievalKeys: z.array(z.string()).max(32).optional().describe('下一轮自动检索使用的关键词'),
    active: z.boolean().optional().describe('false=关闭当前主题'),
    expectedRevision: z.number().int().min(0).optional().describe('乐观并发版本；冲突时返回错误'),
  },
  async execute(args, ctx) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(TOPIC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionID: ctx?.sessionID,
          topic: args.topic,
          matterId: args.matterId,
          summary: args.summary,
          entities: args.entities,
          aliases: args.aliases,
          openLoops: args.openLoops,
          retrievalKeys: args.retrievalKeys,
          active: args.active,
          expectedRevision: args.expectedRevision,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      let body: any = {};
      try {
        body = await res.json();
      } catch {
        /* ignore */
      }
      if (!res.ok || body?.ok === false) {
        return {
          title: '主题设置失败',
          output: JSON.stringify(body),
          metadata: { ok: false, code: body?.code },
        };
      }
      const state = body?.state ?? {};
      return {
        title: args.active === false ? '主题已关闭' : '主题已设置',
        output: JSON.stringify({ ok: true, state }),
        metadata: { ok: true, revision: state.revision, topic: state.topic, active: state.active },
      };
    } catch (err: any) {
      return {
        title: '主题设置失败',
        output: `gateway unreachable: ${err.message}`,
        metadata: { ok: false },
      };
    }
  },
};
