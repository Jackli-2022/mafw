/**
 * Phase D1 Task H1 — GET /api/media/plugins + POST /api/media/plugins/reload。
 *
 * handler 体从 index.ts legacy 分支逐字迁移（loader 状态投影逐字保留：
 * file/name/status/error/modalities；GET 返回 {plugins}，POST reload 返回
 * {ok:true,plugins}）。mediaPluginLoader 在 boot 后才赋值 → live getter；
 * 未初始化时 `?.` 语义不变（GET 空列表，reload 静默 no-op）。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import type { MediaPluginLoader } from '../media/media-plugin-loader';
import type { RouteRegistry } from './registry';

export interface MediaPluginsRouteDeps {
  mediaPluginLoader: () => MediaPluginLoader | undefined;
}

export function attachMediaPluginRoutes(registry: RouteRegistry, deps: MediaPluginsRouteDeps): void {
  // GET /api/media/plugins — media engine plugin state list
  registry.attachHandler('media.plugins', async (_req: IncomingMessage, res: ServerResponse) => {
    const plugins = (deps.mediaPluginLoader()?.getState() ?? []).map(s => ({
      file: s.file,
      name: s.name,
      status: s.status,
      error: s.error,
      modalities: s.modalities,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ plugins }));
  });

  // POST /api/media/plugins/reload — manual reload
  registry.attachHandler('media.pluginsReload', async (_req: IncomingMessage, res: ServerResponse) => {
    await deps.mediaPluginLoader()?.reload();
    const plugins = (deps.mediaPluginLoader()?.getState() ?? []).map(s => ({
      file: s.file,
      name: s.name,
      status: s.status,
      error: s.error,
      modalities: s.modalities,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, plugins }));
  });
}
