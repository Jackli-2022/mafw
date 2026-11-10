/**
 * Phase D1 Task H2: MCP 管理门面 → registry dispatch。
 *
 *   GET    /api/mcp/servers                    — mcp.servers
 *   POST   /api/mcp/:name/connect              — mcp.connect
 *   POST   /api/mcp/:name/disconnect           — mcp.disconnect
 *   POST   /api/mcp/config/preview             — mcp.configPreview
 *   POST   /api/mcp/config/preview-remove      — mcp.configPreviewRemove
 *   POST   /api/mcp/config/apply               — mcp.configApply
 *   POST   /api/mcp/config/restore             — mcp.configRestore
 *   DELETE /api/mcp/config/servers/:name       — mcp.configRemove
 *
 * gateway 只做能力门 + 契约调用；如实逐字委托 handleMcp / handleMcpConfig
 * （url 与 deps 闭包原样传递，`channel!` 非空断言语义不变）。
 *
 * 委托的 boolean 必须原样上抛（sessions-core.ts 的 session.background 同款）：
 * handleMcp / handleMcpConfig 返回 false = 「本模块正则未命中，请回退 legacy 链」
 * （尾随斜杠、method 不匹配、decoded-empty name 等形状）。吞掉 false 会让请求
 * 既不写响应也不落回退——dispatchAuthorized 以 `handled !== false` 判定已处理，
 * 客户端挂起。registry 只接管精确 (method,path)，false 时 legacy 链继续落空 → 反代，
 * 与迁移前一致。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { handleMcp } from './mcp';
import { handleMcpConfig } from './mcp-config';
import type { RouteRegistry } from './registry';

export interface McpMgmtRouteDeps {
  runtime: () => any;
}

export function attachMcpMgmtRoutes(registry: RouteRegistry, deps: McpMgmtRouteDeps): void {
  // GET /api/mcp/servers — runtime MCP server list
  registry.attachHandler('mcp.servers', async (req: IncomingMessage, res: ServerResponse) => {
    const rt = deps.runtime();
    const channel = rt?.mcp;
    return handleMcp(req, res, req.url!, {
      access: rt?.access ?? null,
      list: (opts) => channel!.list(opts),
      connect: (name, opts) => channel!.connect(name, opts),
      disconnect: (name, opts) => channel!.disconnect(name, opts),
    });
  });

  // POST /api/mcp/:name/connect — connect one server
  registry.attachHandler('mcp.connect', async (req: IncomingMessage, res: ServerResponse) => {
    const rt = deps.runtime();
    const channel = rt?.mcp;
    return handleMcp(req, res, req.url!, {
      access: rt?.access ?? null,
      list: (opts) => channel!.list(opts),
      connect: (name, opts) => channel!.connect(name, opts),
      disconnect: (name, opts) => channel!.disconnect(name, opts),
    });
  });

  // POST /api/mcp/:name/disconnect — disconnect one server
  registry.attachHandler('mcp.disconnect', async (req: IncomingMessage, res: ServerResponse) => {
    const rt = deps.runtime();
    const channel = rt?.mcp;
    return handleMcp(req, res, req.url!, {
      access: rt?.access ?? null,
      list: (opts) => channel!.list(opts),
      connect: (name, opts) => channel!.connect(name, opts),
      disconnect: (name, opts) => channel!.disconnect(name, opts),
    });
  });

  // POST /api/mcp/config/preview — dry-run a config write
  registry.attachHandler('mcp.configPreview', async (req: IncomingMessage, res: ServerResponse) => {
    const cfgChannel = deps.runtime()?.mcp?.config;
    return handleMcpConfig(req, res, req.url!, {
      access: deps.runtime()?.access ?? null,
      preview: (input) => cfgChannel!.preview(input),
      previewRemove: (name) => cfgChannel!.previewRemove(name),
      apply: (input) => cfgChannel!.apply(input),
      remove: (name, opts) => cfgChannel!.remove(name, opts),
      restore: (opts) => cfgChannel!.restore(opts),
    });
  });

  // POST /api/mcp/config/preview-remove — dry-run a server removal
  registry.attachHandler('mcp.configPreviewRemove', async (req: IncomingMessage, res: ServerResponse) => {
    const cfgChannel = deps.runtime()?.mcp?.config;
    return handleMcpConfig(req, res, req.url!, {
      access: deps.runtime()?.access ?? null,
      preview: (input) => cfgChannel!.preview(input),
      previewRemove: (name) => cfgChannel!.previewRemove(name),
      apply: (input) => cfgChannel!.apply(input),
      remove: (name, opts) => cfgChannel!.remove(name, opts),
      restore: (opts) => cfgChannel!.restore(opts),
    });
  });

  // POST /api/mcp/config/apply — apply a config write
  registry.attachHandler('mcp.configApply', async (req: IncomingMessage, res: ServerResponse) => {
    const cfgChannel = deps.runtime()?.mcp?.config;
    return handleMcpConfig(req, res, req.url!, {
      access: deps.runtime()?.access ?? null,
      preview: (input) => cfgChannel!.preview(input),
      previewRemove: (name) => cfgChannel!.previewRemove(name),
      apply: (input) => cfgChannel!.apply(input),
      remove: (name, opts) => cfgChannel!.remove(name, opts),
      restore: (opts) => cfgChannel!.restore(opts),
    });
  });

  // POST /api/mcp/config/restore — restore a config backup
  registry.attachHandler('mcp.configRestore', async (req: IncomingMessage, res: ServerResponse) => {
    const cfgChannel = deps.runtime()?.mcp?.config;
    return handleMcpConfig(req, res, req.url!, {
      access: deps.runtime()?.access ?? null,
      preview: (input) => cfgChannel!.preview(input),
      previewRemove: (name) => cfgChannel!.previewRemove(name),
      apply: (input) => cfgChannel!.apply(input),
      remove: (name, opts) => cfgChannel!.remove(name, opts),
      restore: (opts) => cfgChannel!.restore(opts),
    });
  });

  // DELETE /api/mcp/config/servers/:name — remove one server from config
  registry.attachHandler('mcp.configRemove', async (req: IncomingMessage, res: ServerResponse) => {
    const cfgChannel = deps.runtime()?.mcp?.config;
    return handleMcpConfig(req, res, req.url!, {
      access: deps.runtime()?.access ?? null,
      preview: (input) => cfgChannel!.preview(input),
      previewRemove: (name) => cfgChannel!.previewRemove(name),
      apply: (input) => cfgChannel!.apply(input),
      remove: (name, opts) => cfgChannel!.remove(name, opts),
      restore: (opts) => cfgChannel!.restore(opts),
    });
  });
}
