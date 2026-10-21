import * as http from 'http';
import { log } from '../core/utils/logger';
import { AgentRuntime } from '../runtime/contract';
import { RuntimePluginLoader } from '../runtime/loader';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export interface RuntimeSwitchDeps {
  loader?: RuntimePluginLoader;
  persist: (overrides: Record<string, any>) => { changed: string[] };
  getCurrent: () => AgentRuntime | null;
  /** Current runtime name (e.g. 'opencode' or plugin name). */
  runtimeName: () => string;
  /** Current runtime capabilities. */
  runtimeCaps: () => any;
  /** Whether an env override (MAFW_RUNTIME_PLUGIN) is active. */
  envOverride: () => boolean;
  /** Create the runtime for the persisted config (reads config.runtime.plugin). */
  createRuntime: () => Promise<AgentRuntime>;
  /** Wire the new runtime into the gateway (client/caps/name/session) and re-subscribe events. */
  onSwitched: (rt: AgentRuntime, prev: AgentRuntime | null) => Promise<void>;
  /** 未知事件遥测快照（per-source per-type 计数）；缺省空对象。 */
  unknownEvents?: () => Record<string, Record<string, number>>;
  /** 激活期"声明 vs 实现"校验记录（降级 + 警告）；缺省空数组。 */
  validationNotes?: () => string[];
  /** B2 翻译守卫失败计数（transformEvent/normalizeMessages per-runtime）；缺省空对象。 */
  translationErrors?: () => Record<string, unknown>;
  /** B3 入口拦截计数（unmatched/suppressed per-runtime per-type）；缺省空对象。 */
  translationDrops?: () => Record<string, unknown>;
  /** canonical v3：当前方言标签（'v1'|'v2'|…；钉死名取 @ 后缀，自适应取探测结果）；缺省 null。 */
  activeDialect?: () => string | null;
}

// ─── GET /api/runtime ─── active runtime identity + capabilities + plugin scan state
export async function handleRuntimeGet(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: Pick<RuntimeSwitchDeps, 'runtimeName' | 'runtimeCaps' | 'envOverride' | 'loader' | 'unknownEvents' | 'validationNotes' | 'translationErrors' | 'translationDrops' | 'activeDialect'>,
): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    active: {
      name: deps.runtimeName(),
      capabilities: deps.runtimeCaps(),
      envOverride: deps.envOverride(),
      dialect: deps.activeDialect ? deps.activeDialect() : null,
    },
    plugins: deps.loader?.getState() ?? [],
    unknownEvents: deps.unknownEvents ? deps.unknownEvents() : {},
    validation: deps.validationNotes ? deps.validationNotes() : [],
    translationErrors: deps.translationErrors ? deps.translationErrors() : {},
    translationDrops: deps.translationDrops ? deps.translationDrops() : {},
  }));
}

// ─── POST /api/runtime/switch ─── hot-swap the active runtime plugin
export async function handleRuntimeSwitch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: RuntimeSwitchDeps,
): Promise<void> {
  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err: any) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
    return;
  }

  const plugin = typeof body?.plugin === 'string' ? body.plugin.trim() : '';
  if (plugin) {
    // D 收敛：opencode 与其他 runtime 同走 loader 校验（注册表成员语义，特判已删）
    const found = deps.loader?.get(plugin);
    if (!found) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: `Runtime plugin '${plugin}' not found`,
        available: deps.loader?.getState().map(s => s.name).filter(Boolean) ?? [],
      }));
      return;
    }
  }

  try {
    deps.persist({ runtime: { plugin } });
    const prev = deps.getCurrent();
    const rt = await deps.createRuntime();
    await deps.onSwitched(rt, prev);
    log.info(`[Runtime] switched to '${rt.name}' (capabilities: ${JSON.stringify(rt.capabilities)})`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      active: { name: rt.name, capabilities: rt.capabilities },
      envOverride: deps.envOverride(),
    }));
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// ─── POST /api/runtime/reload ─── rescan plugins without switching
export async function handleRuntimeReload(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: Pick<RuntimeSwitchDeps, 'loader'>,
): Promise<void> {
  if (!deps.loader) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Runtime plugin loader not available' }));
    return;
  }
  await deps.loader.scan();
  const state = deps.loader.getState();
  log.info(`[Runtime] reloaded plugins (${state.length} scanned)`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ plugins: state }));
}
