/**
 * Phase D1 Task H1 — long-tail singles: presence / voice status / eval chat /
 * orchestration outcomes / provider list / agents list.
 *
 * handler 体从 index.ts legacy 分支逐字迁移（仅 `this.x` → `deps.x()`）；
 * readBody → readRouteBody（accepted deviation R3：socket error 由挂起改为
 * reject → 外层 500）。响应头/状态码/日志格式/懒求值顺序全部照搬：
 *   - provider / agents 分支从不设置 Content-Type（legacy 如此）。
 *   - presence 先 writeHead(out.status) 再写 body（handler 自带 try/catch）。
 *   - eval 的 catch 统一 400 + `{error:{message}}`，含 JSON.parse 失败。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { config } from '../config';
import { log } from '../core/utils/logger';
import type { PodPresence } from '../core/pod/pod-presence';
import { handleEvalChatCompletion } from '../eval-endpoint';
import type { GatewayDatabase } from '../memory/gateway-db';
import { mergeAgentLists } from '../runtime/identity-state';
import { projectAgents, projectProviderEnvelope } from '../runtime/view-projections';
import { handlePresence } from './presence';
import { readRouteBody } from './cognition';
import type { RouteRegistry } from './registry';
import { resolveVoiceConfig } from '../voice/config';
import type { VoiceRuntime } from '../voice/runtime';
import { handleVoiceStatus } from '../voice/routes/voice-status';

export interface MiscRouteDeps {
  /** live getter（voiceRuntime 在 boot 后才初始化）。 */
  voiceRuntime: () => VoiceRuntime | undefined;
  buildPresence: () => PodPresence;
  runtime: () => any;
  resolvedProjectDir: () => string;
  getGatewayDb: () => GatewayDatabase;
  /** legacy capGuard 原文（503 + surface 文案）。 */
  capGuard: (res: ServerResponse, surface: string) => boolean;
  identityRegistry: () => any;
  identityState: () => any;
  runtimeName: () => string;
}

export function attachMiscRoutes(registry: RouteRegistry, deps: MiscRouteDeps): void {
  // GET /api/voice/status — voice config + registered ASR engines.
  registry.attachHandler('voice.status', async (req: IncomingMessage, res: ServerResponse) => {
    await handleVoiceStatus(req, res, {
      runtime: deps.voiceRuntime(),
      config: resolveVoiceConfig(config.raw),
    });
  });

  // 跨项目常驻存在感（tray/taskbar 的唯一数据源）。
  registry.attachHandler('presence.get', async (_req: IncomingMessage, res: ServerResponse) => {
    const out = await handlePresence({ list: () => deps.buildPresence() });
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });

  // POST /api/eval/chat/completions — EvalScope adapter: OpenAI-compatible
  // endpoint that drives a full main-agent run (media → agent → A2A →
  // MediaAgent → multimodal model) and returns the final answer.
  registry.attachHandler('eval.chatCompletions', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readRouteBody(req));
      const evalHandler = handleEvalChatCompletion({
        runtime: deps.runtime(),
        directory: deps.resolvedProjectDir(),
        providerID: 'opencode-go',
        modelID: 'deepseek-v4-flash',
        timeoutMs: 300_000,
      });
      const result = await evalHandler(body);
      res.setHeader("Content-Type", "application/json");
      res.writeHead(result.status);
      res.end(JSON.stringify(result.body));
    } catch (err: any) {
      log.error(`[Eval] chat error: ${err.message}`);
      res.writeHead(400);
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
  });

  // GET /api/orchestration/outcomes — goal outcome query
  registry.attachHandler('orchestration.outcomes', async (req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url!, 'http://localhost');
    const rows = deps.getGatewayDb().listGoalOutcomes({
      policy: u.searchParams.get('policy') || undefined,
      verdict: u.searchParams.get('verdict') || undefined,
      project: u.searchParams.get('project') || undefined,
      limit: parseInt(u.searchParams.get('limit') || '100', 10),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ outcomes: rows }));
  });

  // GET /api/provider – list providers + models (legacy /provider)
  registry.attachHandler('providers.list', async (_req: IncomingMessage, res: ServerResponse) => {
    if (deps.capGuard(res, 'provider.list')) return;
    try {
      if (!deps.runtime()) { res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return; }
      const result = await deps.runtime().provider.list();
      res.end(JSON.stringify(projectProviderEnvelope(result ?? null)));
    } catch (err: any) {
      log.error('[Provider] list error:', err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/agents ─ merged list: registry identities (source:'mafw') first,
  // then runtime-native agents (source:'runtime') — uniform picker across runtimes.
  registry.attachHandler('agents.list', async (_req: IncomingMessage, res: ServerResponse) => {
    if (deps.capGuard(res, 'provider.app.agents')) return;
    try {
      if (!deps.runtime()) { res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return; }
      const runtimeAgents = await deps.runtime().app.agents();
      const items = mergeAgentLists(
        deps.identityRegistry().list().map((s: any) => ({
          name: s.name,
          description: s.description,
          scope: s.scope,
          // deprecated 身份（manager）只保留给既有会话读取，不进可选列表。
          deprecated: s.deprecated,
          // 未物化身份不出现在列表（选了也会被 withIdentityPrompt 剥离，
          // 列出是 UX 谎言）；runtime 无 agentConfigApi 时全部滤出。
          materialized: deps.identityState().isMaterialized(deps.runtimeName(), s.name),
        })),
        Array.isArray(runtimeAgents) ? runtimeAgents : [],
      );
      res.end(JSON.stringify({ items: projectAgents(items) }));
    } catch (err: any) {
      log.error('[Agents] list error:', err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
