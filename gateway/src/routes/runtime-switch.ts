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
}

// ─── GET /api/runtime ─── active runtime identity + capabilities + plugin scan state
export async function handleRuntimeGet(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: Pick<RuntimeSwitchDeps, 'runtimeName' | 'runtimeCaps' | 'envOverride' | 'loader'>,
): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    active: {
      name: deps.runtimeName(),
      capabilities: deps.runtimeCaps(),
      envOverride: deps.envOverride(),
    },
    plugins: deps.loader?.getState() ?? [],
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
  if (plugin && plugin !== 'opencode') {
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
