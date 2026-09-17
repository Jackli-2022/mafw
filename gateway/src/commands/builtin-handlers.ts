/**
 * 内置命令 handler（从 index.ts 原 if 链逐字提取，deps 注入可单测）。
 * 语义不变：返回 { ok:false, error } 由路由层映射 4xx/5xx。
 */
import { runWaitwhat, type WaitwhatMessage } from '../routes/waitwhat-command';
import type { MafwCommandContext, MafwCommandHandler, MafwCommandResult } from './registry';

export interface MafwBuiltinDeps {
  /** 返回 manager sessionId；无 manager 时返回 '' */
  ensureManagerSession(projectDir: string): Promise<string>;
  /** 兜底新建会话，返回 id 或 null */
  createSession(projectDir: string): Promise<string | null>;
  promptAsync(sessionID: string, text: string): Promise<void>;
  listMessages(sessionID: string): Promise<WaitwhatMessage[]>;
  btwAsk(question: string): Promise<string>;
  rotateManagerSession(projectDir: string): Promise<Record<string, unknown> & { sessionId: string }>;
  mergeMemory(sourceWorktree: string, strategy: string): Promise<Record<string, unknown>>;
  readStatus(): string;
  llmAvailable(): boolean;
}

export function buildBuiltinHandlers(deps: MafwBuiltinDeps): Map<string, MafwCommandHandler> {
  const handlers = new Map<string, MafwCommandHandler>();

  handlers.set('goal', async (ctx: MafwCommandContext): Promise<MafwCommandResult> => {
    const argStr = ctx.args.trim();
    if (!argStr) return { ok: false, error: 'goal description required' };
    const manager = await deps.ensureManagerSession(ctx.projectDir).catch(() => '');
    const target = manager || (await deps.createSession(ctx.projectDir));
    if (!target || !deps.llmAvailable()) {
      return { ok: false, error: 'LLM client not available' };
    }
    await deps.promptAsync(target, `创建新 Goal：${argStr}`);
    return { ok: true, message: `Goal 已提交：${argStr}`, sessionID: target };
  });

  handlers.set('new-topic', async (ctx) => {
    const result = await deps.rotateManagerSession(ctx.projectDir);
    return { ok: true, message: `新话题已开启：${result.sessionId}`, ...result };
  });

  handlers.set('btw', async (ctx) => {
    const q = ctx.args.trim();
    if (!q) return { ok: false, error: 'usage: /btw <question>' };
    const answer = await deps.btwAsk(q);
    return { ok: true, text: answer };
  });

  handlers.set('waitwhat', async (ctx) => {
    if (!ctx.sessionID) return { ok: false, error: 'sessionID required' };
    if (!deps.llmAvailable()) return { ok: false, error: 'LLM client not available' };
    const result = await runWaitwhat(ctx.sessionID, {
      listMessages: deps.listMessages,
      promptAsync: deps.promptAsync,
    });
    return result.ok
      ? { ok: true, message: '重述请求已发送到当前会话' }
      : { ok: false, error: result.error };
  });

  handlers.set('status', async () => ({ ok: true, text: deps.readStatus() }));

  handlers.set('merge-memory', async (ctx) => {
    const parts = ctx.args.trim().split(/\s+/);
    const sourceWorktree = parts[0];
    if (!sourceWorktree) return { ok: false, error: 'Usage: /merge-memory <sourceWorktreePath> [strategy]' };
    const parsed = await deps.mergeMemory(sourceWorktree, parts[1] || 'manual');
    return { ok: parsed.success !== false, ...parsed };
  });

  return handlers;
}
