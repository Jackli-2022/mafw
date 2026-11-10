/**
 * Phase D1 Task H1 — POST /api/llm/compress（LLM 压缩代理，经 runtime session）。
 *
 * handler 体从 index.ts legacy 分支逐字迁移；压缩实现仍是 MafwScheduler 的私有
 * 方法，经 `compress` 依赖桥接（签名逐字：observations: string[], model?: string）。
 * readBody → readRouteBody（accepted deviation R3；读取位置保持在 try 内）。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { readRouteBody } from './cognition';
import type { RouteRegistry } from './registry';

export interface LlmRouteDeps {
  compress: (observations: string[], model?: string) => Promise<any>;
}

export function attachLlmRoutes(registry: RouteRegistry, deps: LlmRouteDeps): void {
  // POST /api/llm/compress — LLM compression proxy (via SDK)
  registry.attachHandler('llm.compress', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = await readRouteBody(req);
      const { observations, model } = JSON.parse(body);
      if (!observations || !Array.isArray(observations)) throw new Error('observations array required');
      const result = await deps.compress(observations, model);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
