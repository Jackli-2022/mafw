/**
 * /api/mafw-commands 路由（UI-driven，刻意不进 MCP）：
 * - POST /run：注册表派发（内置 + 自定义）
 * - GET：命令元数据清单（客户端补全/面板）
 */
import { MafwCommandRegistry, BUILTIN_COMMAND_DEFS } from '../commands/registry';
import { buildBuiltinHandlers, type MafwBuiltinDeps } from '../commands/builtin-handlers';
import { readRouteBody } from './cognition';
import type { RouteRegistry } from './registry';

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

// ─── Phase D1 Task A2: registry dispatch wiring ───────────────────────────────

export interface MafwCommandsWiringDeps {
  getRegistry: () => MafwCommandRegistry;
  registeredProjects: () => Map<string, { projectDir: string }>;
  projectDir: () => string;
  /** hold-queue 预检（runCoordinator 可能未初始化 → undefined = 不 hold）。 */
  shouldHoldQueue: (sessionID: string) => boolean | undefined;
}

/**
 * 绑定 catalog 的 mafwCommands.run / mafwCommands.list。
 * 409 hold-queue 预检仍在该路由内、delegate 之前；请求体 JSON.parse 不设
 * try/catch（非法 JSON 依原样抛到外层 500）。
 */
export function attachMafwCommandRoutes(registry: RouteRegistry, deps: MafwCommandsWiringDeps): void {
  registry.attachHandler('mafwCommands.run', async (req, res) => {
    const cmdBody = JSON.parse(await readRouteBody(req));
    const cmdSessionID = typeof cmdBody?.sessionID === 'string' ? cmdBody.sessionID : '';
    if (cmdSessionID && deps.shouldHoldQueue(cmdSessionID)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'session is suspended; resume or discard the run first' }));
      return;
    }
    const reply = await handleMafwCommandRun(
      {
        registry: deps.getRegistry(),
        resolveProjectDir: () => deps.registeredProjects().values().next().value?.projectDir || deps.projectDir(),
      },
      cmdBody,
    );
    res.writeHead(reply.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });

  registry.attachHandler('mafwCommands.list', async (_req, res) => {
    const reply = handleMafwCommandList({ registry: deps.getRegistry(), resolveProjectDir: () => deps.projectDir() });
    res.writeHead(reply.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
}

