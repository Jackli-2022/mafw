import * as http from 'http';
import { log } from '../core/utils/logger';
import type { RuntimeFacade } from '../runtime/runtime-facade';
import { RuntimePluginLoader } from '../runtime/loader';
import type { RuntimeContractManifest } from '../runtime/contract-manifest-types';
import type { RuntimeCoverage } from '../runtime/coverage';

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
  getCurrent: () => RuntimeFacade | null;
  /** Current runtime name (e.g. 'opencode' or plugin name). */
  runtimeName: () => string;
  /** Current runtime capabilities. */
  runtimeCaps: () => any;
  /** Whether an env override (MAFW_RUNTIME_PLUGIN) is active. */
  envOverride: () => boolean;
  /** Create the runtime for the persisted config (reads config.runtime.plugin). */
  createRuntime: () => Promise<RuntimeFacade>;
  /** Wire the new runtime into the gateway (client/caps/name/session) and re-subscribe events. */
  onSwitched: (rt: RuntimeFacade, prev: RuntimeFacade | null) => Promise<void>;
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
  /** Active runtime coverage（GET /api/runtime.active.coverage）。 */
  contractCoverage?: () => RuntimeCoverage | null;
  /** Contract manifest + coverage（GET /api/runtime/contract）。 */
  contract?: () => { manifest: RuntimeContractManifest; coverage: RuntimeCoverage | null };
}

// ─── GET /api/runtime ─── active runtime identity + capabilities + plugin scan state
export async function handleRuntimeGet(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: Pick<RuntimeSwitchDeps, 'runtimeName' | 'runtimeCaps' | 'envOverride' | 'loader' | 'unknownEvents' | 'validationNotes' | 'translationErrors' | 'translationDrops' | 'activeDialect' | 'contractCoverage'>,
): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    active: {
      name: deps.runtimeName(),
      capabilities: deps.runtimeCaps(),
      envOverride: deps.envOverride(),
      dialect: deps.activeDialect ? deps.activeDialect() : null,
      coverage: deps.contractCoverage ? deps.contractCoverage() : null,
    },
    plugins: deps.loader?.getState() ?? [],
    unknownEvents: deps.unknownEvents ? deps.unknownEvents() : {},
    validation: deps.validationNotes ? deps.validationNotes() : [],
    translationErrors: deps.translationErrors ? deps.translationErrors() : {},
    translationDrops: deps.translationDrops ? deps.translationDrops() : {},
  }));
}

// ─── GET /api/runtime/contract ─── manifest + active coverage
export async function handleRuntimeContract(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: Pick<RuntimeSwitchDeps, 'contract'>,
): Promise<void> {
  if (!deps.contract) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'runtime contract manifest is not available' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(deps.contract()));
}

// ─── POST /api/runtime/switch ─── hot-swap the active runtime plugin

/** Guard/mutex around a switch (shared by the HTTP route and the apply path). */
export interface RuntimeSwitchGuard {
  /** True while the serve sidecar is recovering or another switch is running. */
  blocked: () => boolean;
  begin: () => void;
  end: () => void;
}

/**
 * Outcome of one switch attempt. `code` is a machine-readable class so callers
 * can map it to their own transport (HTTP status vs. an apply result).
 */
export type RuntimeSwitchOutcome =
  | { success: true; active: { name: string; capabilities: any } }
  | {
      success: false;
      code: 'blocked' | 'not-found' | 'failed';
      error: string;
      /** Present for `failed` when a runtime was built but is not the wanted one. */
      active?: { name: string; capabilities: any };
    };

/**
 * Does the reached runtime satisfy the requested plugin name?
 *
 * `opencode@v2` and friends are pinned *dialects* of the same runtime: the
 * facade identity is the bare runtime name, so a pinned-dialect request must not
 * read as a fallback. Anything else that differs means `createRuntime()` fell
 * back to builtin opencode instead of building the requested plugin.
 */
function runtimeNameMatches(wanted: string, actual: string): boolean {
  if (actual === wanted) return true;
  const at = wanted.indexOf('@');
  return at > 0 && actual === wanted.slice(0, at);
}

/**
 * One orchestration for every runtime switch: `/api/runtime/switch` and the
 * plugin-package apply path both call this, so the guard/mutex, validation,
 * persistence, rebuild, event resubscription and fallback detection can never
 * drift apart.
 *
 * Fallback detection: `createRuntime()` silently falls back to builtin opencode
 * when the wanted plugin fails to build. A resolved facade is therefore not
 * proof of success — for a named plugin the active runtime name must match
 * after `onSwitched`.
 */
export async function performRuntimeSwitch(
  deps: RuntimeSwitchDeps,
  plugin: string,
  guard?: RuntimeSwitchGuard,
): Promise<RuntimeSwitchOutcome> {
  if (guard?.blocked()) {
    return {
      success: false,
      code: 'blocked',
      error: 'runtime switch is blocked while the serve sidecar is recovering or another switch is in progress',
    };
  }

  const wanted = typeof plugin === 'string' ? plugin.trim() : '';
  if (wanted) {
    // D 收敛：opencode 与其他 runtime 同走 loader 校验（注册表成员语义，特判已删）
    if (!deps.loader?.get(wanted)) {
      return { success: false, code: 'not-found', error: `Runtime plugin '${wanted}' not found` };
    }
  }

  guard?.begin();
  try {
    deps.persist({ runtime: { plugin: wanted } });
    const prev = deps.getCurrent();
    const rt = await deps.createRuntime();
    await deps.onSwitched(rt, prev);
    // 切换后诊断视图已指向新 runtime（不再经 facade 回读 identity/capabilities）。
    const name = deps.runtimeName();
    const capabilities = deps.runtimeCaps();
    if (wanted && !runtimeNameMatches(wanted, name)) {
      return {
        success: false,
        code: 'failed',
        error: `runtime "${wanted}" did not activate (active runtime is "${name}")`,
        active: { name, capabilities },
      };
    }
    log.info(`[Runtime] switched to '${name}' (capabilities: ${JSON.stringify(capabilities)})`);
    return { success: true, active: { name, capabilities } };
  } catch (err: any) {
    return { success: false, code: 'failed', error: err?.message ?? String(err) };
  } finally {
    guard?.end();
  }
}

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
  // The guard/mutex is owned by the route wrapper (`attachWave2Handlers`), so it
  // is deliberately not passed here: the wrapper already began the switch.
  const result = await performRuntimeSwitch(deps, plugin);

  if (result.success) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      active: result.active,
      envOverride: deps.envOverride(),
    }));
    return;
  }

  if (result.code === 'not-found') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: result.error,
      available: deps.loader?.getState().map(s => s.name).filter(Boolean) ?? [],
    }));
    return;
  }

  res.writeHead(result.code === 'blocked' ? 409 : 500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: result.error }));
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
