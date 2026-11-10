/**
 * Phase D1 Task C2: chat 面（registry dispatch 接线）。
 *
 *   POST /api/chat          — fire-and-forget promptAsync，返回 sessionID 供 SSE
 *   POST /api/chat/enriched — 记忆上下文注入版（自有 inline enrichment 副本）
 *
 * handler 体从 index.ts legacy 分支逐字迁移。注意（index.ts 注释 ~L3998-4001）：
 * HTTP /api/chat/enriched **刻意**保留自己的 enrichment 副本以保证稳定，不要
 * 合并到 sendEnrichedInternal() 或任何共享 helper。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../core/utils/logger';
import { readRouteBody } from './cognition';
import type { RouteRegistry } from './registry';
import type { RuntimeFacade } from '../runtime/runtime-facade';
import type { MemoryService } from '../memory/service';

export interface ChatRouteDeps {
  registeredProjects: () => Map<string, { projectDir: string }>;
  projectDir: () => string;
  runtime: () => RuntimeFacade | null;
  shouldHoldQueue: (sessionID: string) => boolean | undefined;
  memoryService: () => MemoryService | null | undefined;
}

export function attachChatRoutes(registry: RouteRegistry, deps: ChatRouteDeps): void {
  // Chat API — fire-and-forget promptAsync, returns sessionID for SSE streaming
  registry.attachHandler('chat.send', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = await readRouteBody(req);
      const { message } = JSON.parse(body);
      if (!message) { res.writeHead(400); res.end(JSON.stringify({ error: 'message required' })); return; }

      const firstProject = deps.registeredProjects().values().next().value;
      const projectDir = firstProject?.projectDir || deps.projectDir();

      const runtime = deps.runtime();
      if (!runtime) {
        res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return;
      }

      const session = await runtime.session.create({ directory: projectDir });
      const sessionID = session.id;
      if (!sessionID) {
        res.writeHead(500); res.end(JSON.stringify({ error: 'Failed to create session' })); return;
      }

      const result = await runtime.session.promptAsync({
        sessionID,
        parts: [{ type: 'text', text: message }],
      });
      if (result?.error) {
        log.warn(`[Scheduler] promptAsync failed for ${sessionID}: ${JSON.stringify(result.error)}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'promptAsync failed: ' + (result.error?.data?.message || result.error?.message || JSON.stringify(result.error)) }));
        return;
      }
      log.info(`[Scheduler] promptAsync ok session=${sessionID} status=${result?.response?.status}`);

      res.writeHead(200);
      res.end(JSON.stringify({ sessionID }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // POST /api/chat/enriched — chat with memory context injection
  registry.attachHandler('chat.sendEnriched', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = await readRouteBody(req);
      const { message, sessionID: existingID, parts, agent, model } = JSON.parse(body);
      if (!message && !Array.isArray(parts)) { res.writeHead(400); res.end(JSON.stringify({ error: 'message or parts required' })); return; }
      if (existingID && deps.shouldHoldQueue(existingID)) {
        res.writeHead(409);
        res.end(JSON.stringify({ error: 'session is suspended; resume or discard the run first' }));
        return;
      }

      const firstProject = deps.registeredProjects().values().next().value;
      const projectDir = firstProject?.projectDir || deps.projectDir();

      const runtime = deps.runtime();
      if (!runtime) {
        res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return;
      }

      let enrichedMessage = message;
      const memoryService = deps.memoryService();
      if (memoryService) {
        const results = await memoryService.mergedSearch(message, 5);
        if (results.length > 0) {
          const { renderMemoryBlocks } = require('../recall/inject-format');
          const chunks = renderMemoryBlocks(results.map((r: any) => ({
            source: r.source,
            type: r.type,
            content: r.content,
          })));
          if (chunks.length > 0) enrichedMessage = chunks.join('\n\n') + '\n\n' + message;
        }
      }

      const sessionID = existingID || (await runtime.session.create({ directory: projectDir })).id;
      if (!sessionID) {
        res.writeHead(500); res.end(JSON.stringify({ error: 'Failed to create session' })); return;
      }
      // Extra parts (file/agent attachments) ride along after the enriched text.
      const promptParts: any[] = [];
      if (enrichedMessage) promptParts.push({ type: 'text', text: enrichedMessage });
      if (Array.isArray(parts) && parts.length > 0) promptParts.push(...parts);
      const promptOpts: any = { sessionID, parts: promptParts };
      if (agent) promptOpts.agent = agent;
      if (model?.providerID && model?.modelID) promptOpts.model = model;
      const result = await runtime.session.promptAsync(promptOpts);
      if (result?.error) {
        log.warn(`[Scheduler] promptAsync failed for ${sessionID}: ${JSON.stringify(result.error)}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'promptAsync failed: ' + (result.error?.data?.message || result.error?.message || JSON.stringify(result.error)) }));
        return;
      }
      log.info(`[Scheduler] promptAsync ok session=${sessionID} status=${result?.response?.status}`);

      res.writeHead(200);
      res.end(JSON.stringify({ sessionID }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
