/**
 * Phase D3 Task 2 — `GET/PATCH /api/runtime-config` (runtime 中立的运行时配置
 * 读写；Settings 页的数据面)。
 *
 * 迁移纪律（D3 global constraint「extract as-is」）：handler 体从 index.ts
 * legacy 链逐字搬出（仅 `this.x` → `deps.x()` / `deps.x`），状态码、响应包络
 * （GET `{ config }` / PATCH `{ status: 'ok', config }`）、503 文案与日志格式
 * 全部照搬：
 *   - capGuard 仍在**最前**（`provider.config` / `provider.config.update`），
 *     缺能力时中性 503（无 status 之外的包装）；
 *   - `this.runtime` 与 `this.runtimeHost` 都是可重赋值字段（adopt / 切换后
 *     指向新 host），deps 收 live getter，attach 时不得取值快照；
 *   - readBody 用 `core/http/http-util` 的原函数（D3 Task 1 搬出的同一实现，
 *     错误经 `error` 事件 reject → 外层 catch 500）。
 *
 * 匹配语义：catalog 条目 `runtime.config.get` / `runtime.config.update` 是
 * 精确路径 `/api/runtime-config`；registry.match 只取 path 部分（`url.split('?')[0]`
 * 并剥尾斜杠），因此旧的 `^/api/runtime-config(?:\?|$)` 查询串容忍度保持不变。
 * 旧名 opencode-config 别名已删除（canonical-v3 Task 15），registry 精确匹配
 * 天然不命中。
 *
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2 / Ruling D3-R5.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { readBody } from '../core/http/http-util';
import { log } from '../core/utils/logger';
import type { RuntimeHost } from '../runtime/runtime-facade';
import type { RouteRegistry } from './registry';

export interface RuntimeConfigRouteDeps {
  /** legacy capGuard 原文（503 + surface 文案）。 */
  capGuard: (res: ServerResponse, surface: string) => boolean;
  /** live getter：runtime 在 boot / 切换后重赋值。 */
  runtime: () => any;
  /** live getter：runtimeHost 在 adopt / 切换后重赋值。 */
  runtimeHost: () => RuntimeHost | null;
}

export function attachRuntimeConfigRoutes(registry: RouteRegistry, deps: RuntimeConfigRouteDeps): void {
  // GET /api/runtime-config — return the effective runtime Config
  registry.attachHandler('runtime.config.get', async (_req: IncomingMessage, res: ServerResponse) => {
    if (deps.capGuard(res, 'provider.config')) return;
    try {
      if (!deps.runtime()) { res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return; }
      const configData = await deps.runtimeHost()?.config.get();
      res.end(JSON.stringify({ config: configData ?? {} }));
    } catch (err: any) {
      log.error('[OpenCodeConfig] get error:', err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // PATCH /api/runtime-config — merge-update the runtime Config (native merge semantics)
  registry.attachHandler('runtime.config.update', async (req: IncomingMessage, res: ServerResponse) => {
    if (deps.capGuard(res, 'provider.config.update')) return;
    try {
      if (!deps.runtime()) { res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return; }
      const body = JSON.parse(await readBody(req));
      const result = await deps.runtimeHost()?.config.update(body);
      res.end(JSON.stringify({ status: 'ok', config: result ?? null }));
    } catch (err: any) {
      log.error('[OpenCodeConfig] update error:', err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
