import { z } from 'zod';

/**
 * mafw_mark_episode_boundary — declare an episode edge in T1.
 *
 * The gateway resolves `start_new` / `end_current` against the session's
 * current turn; `next_user_turn` is user-command only (pending flag consumed
 * by the next captured user_input).
 */

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const BOUNDARY_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/obs/episode-boundary`;

export type EpisodeBoundaryScope = 'start_new' | 'end_current' | 'next_user_turn';

export interface EpisodeBoundaryPayload {
  sessionID: string;
  scope?: EpisodeBoundaryScope;
  afterTurn?: number;
  reason?: string;
  intent?: string;
  source?: 'agent' | 'user';
}

export interface EpisodeBoundaryResult {
  ok: boolean;
  body: any;
}

/** Shared HTTP call used by the native tool and the `/new-episode` command. */
export async function postEpisodeBoundary(
  payload: EpisodeBoundaryPayload,
): Promise<EpisodeBoundaryResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(BOUNDARY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    return { ok: res.ok && body?.ok !== false, body };
  } catch (err: any) {
    return { ok: false, body: { ok: false, error: err?.message || String(err) } };
  }
}

export interface MarkEpisodeBoundaryTool {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (
    args: {
      scope?: 'start_new' | 'end_current';
      afterTurn?: number;
      reason?: string;
      intent?: string;
    },
    ctx: { sessionID: string; abort: AbortSignal },
  ) => Promise<{ title: string; output: string; metadata: Record<string, unknown> }>;
}

export const markEpisodeBoundaryTool: MarkEpisodeBoundaryTool = {
  description:
    '声明 T1 episode 边界。开始一个新任务/新话题时用 start_new（默认）；完成当前任务、下一段再开始时用 end_current。' +
    '边界只影响“哪一次”索引，不改写原始 T1；漏声明时由 actor/topic/intent 推断兜底。',
  args: {
    scope: z
      .enum(['start_new', 'end_current'])
      .optional()
      .describe('start_new=当前 turn 开始新 episode（默认）；end_current=当前 turn 结束旧 episode'),
    afterTurn: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('显式 canonical 边界（turn N 属于旧 episode；N+1 属于新）；优先于 scope'),
    reason: z.string().optional().describe('边界原因，如 new_task / finished_task'),
    intent: z.string().optional().describe('新 episode 的意图摘要（可选）'),
  },
  async execute(args, ctx) {
    const result = await postEpisodeBoundary({
      sessionID: ctx?.sessionID,
      scope: args.scope ?? 'start_new',
      source: 'agent',
      ...(args.afterTurn !== undefined ? { afterTurn: args.afterTurn } : {}),
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.intent ? { intent: args.intent } : {}),
    });
    if (!result.ok) {
      return {
        title: 'Episode 边界写入失败',
        output: JSON.stringify(result.body),
        metadata: { ok: false },
      };
    }
    return {
      title: 'Episode 边界已记录',
      output: JSON.stringify(result.body),
      metadata: { ok: true, boundary: result.body?.boundary, pending: result.body?.pending },
    };
  },
};
