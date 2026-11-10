/**
 * Phase D1 Task A3: merge-memory 面（registry dispatch 接线）。
 *
 *   POST /api/merge-memory — direct merge endpoint used by the plugin
 *   /merge-memory slash command. Reuses the MCP handler.
 *
 * 动态 import 逐字保留（启动时不拖入 MCP handler 图）。
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { readRouteBody } from './cognition';
import type { RouteRegistry } from './registry';

export interface MergeMemoryRouteDeps {
  memory: () => unknown;
}

export function attachMergeMemoryRoutes(registry: RouteRegistry, deps: MergeMemoryRouteDeps): void {
  registry.attachHandler('memory.merge', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = await readRouteBody(req);
      const { sourceWorktree, strategy, resolveStrategy } = JSON.parse(body);
      if (!sourceWorktree) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'sourceWorktree is required' }));
        return;
      }
      const { handleMergeMemory } = await import('../mcp/handlers/merge-memory.js');
      const result = await handleMergeMemory(
        { sourceWorktree, resolveStrategy: strategy || resolveStrategy || 'manual' } as any,
        { memory: deps.memory() } as any,
      );
      const text = result.content?.[0]?.text || '{}';
      let parsed: any;
      try { parsed = JSON.parse(text) } catch { parsed = { text } }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: parsed.success !== false, ...parsed }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}
