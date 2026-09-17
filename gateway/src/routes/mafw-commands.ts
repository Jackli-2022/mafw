/**
 * /api/mafw-commands 路由（UI-driven，刻意不进 MCP）：
 * - POST /run：注册表派发（内置 + 自定义）
 * - GET：命令元数据清单（客户端补全/面板）
 */
import { MafwCommandRegistry, BUILTIN_COMMAND_DEFS } from '../commands/registry';
import { buildBuiltinHandlers, type MafwBuiltinDeps } from '../commands/builtin-handlers';

export interface MafwCommandsRouteDeps {
  registry: MafwCommandRegistry;
  resolveProjectDir(): string;
}

export interface RouteReply {
  status: number;
  body: any;
}

/** 组装注册表：内置元数据 + handler。自定义命令由 index.ts 的 loader 追加注册。 */
export function buildMafwCommandRegistry(builtinDeps: MafwBuiltinDeps): MafwCommandRegistry {
  const registry = new MafwCommandRegistry();
  const handlers = buildBuiltinHandlers(builtinDeps);
  for (const def of BUILTIN_COMMAND_DEFS) {
    registry.register(def, handlers.get(def.name));
  }
  return registry;
}

export async function handleMafwCommandRun(deps: MafwCommandsRouteDeps, rawBody: unknown): Promise<RouteReply> {
  try {
    const body = (rawBody ?? {}) as { command?: unknown; args?: unknown; sessionID?: unknown };
    const cmd = String(body.command || '').trim().toLowerCase();
    const entry = deps.registry.resolve(cmd);
    if (!entry?.handler) {
      return { status: 400, body: { ok: false, error: `Unknown command: ${cmd}` } };
    }
    const result = await entry.handler({
      args: String(body.args || '').trim(),
      sessionID: body.sessionID ? String(body.sessionID) : undefined,
      projectDir: deps.resolveProjectDir(),
    });
    return { status: result.ok ? 200 : 400, body: result };
  } catch (err: any) {
    return { status: 500, body: { ok: false, error: err.message } };
  }
}

export function handleMafwCommandList(deps: MafwCommandsRouteDeps): RouteReply {
  return { status: 200, body: { commands: deps.registry.list() } };
}
