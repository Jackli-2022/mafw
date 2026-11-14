/**
 * Unified plugin package REST surface (Task 6).
 *
 * Handlers stay thin: every operation delegates to `PackageManager` (filesystem
 * + enabled state) or `PluginHost` (committed action registry). The route layer
 * owns HTTP shape only — body validation, status mapping and the neutral
 * response envelopes.
 *
 * Error mapping is explicit:
 * - `PackageManagerError.status` → the manager's status (400/404/409/500).
 * - `PluginActionError.status` → the registry's status (404/400/409/...).
 * - `checkPath` `{ok:false}` is a successful diagnostic (200), not a failure.
 */
import type * as http from 'http';
import { log } from '../core/utils/logger';
import { PackageManager, PackageManagerError } from '../plugins/package-manager';
import { PluginActionError, type PluginActionInvokeOptions } from '../plugins/plugin-actions';
import type { PluginClientSnapshot } from '../plugins/client-descriptor';
import type { PluginSafety } from '../plugins/plugin-safety';
import type { PluginDoctor } from '../plugins/plugin-doctor';
import type { PluginAuditStore } from '../plugins/plugin-audit-store';
import type { PackageLastGoodStore } from '../plugins/package-last-good';
import type { InstallConsent } from '../plugins/package-manager';
import { isHumanPrincipal } from '../core/auth';

export interface PluginPackageParams {
  name: string;
}

export interface PluginActionParams extends PluginPackageParams {
  action: string;
}

export interface PluginPackagesRouteDeps {
  /** Manager thunk: undefined until gateway startup finishes. */
  manager: () => PackageManager | undefined;
  /** Latest committed client snapshot (`revision` + active descriptors). */
  snapshot: () => PluginClientSnapshot;
  /**
   * Committed action invocation. Missing while the host is not initialized:
   * the route then answers 404 (no package can be known yet).
   */
  invokeAction?: (
    packageName: string,
    action: string,
    input: unknown,
    options: PluginActionInvokeOptions,
  ) => Promise<unknown>;
  /**
   * Switch/re-instantiate the runtime a package contributes.
   *
   * Wired to the gateway's existing runtime-switch orchestration (loader/
   * config/persist + `onSwitched` event resubscription + identity
   * rematerialization). Absent in headless hosts: the apply response then
   * reports `runtimeSwitch: 'required'` — an explicit manual signal instead of
   * a silent no-op.
   */
  switchRuntime?: (name: string) => Promise<{ success: boolean; error?: string; active?: unknown }>;
  /** Phase 6 safety policy; absent in headless hosts. */
  safety?: () => PluginSafety | undefined;
  doctor?: () => PluginDoctor | undefined;
  audit?: () => PluginAuditStore | undefined;
  /** Rescan every installed package after leaving safe mode. */
  reloadAll?: () => Promise<void>;
  /** Kill switch closes this package's web surfaces. */
  revokeWebTickets?: (name: string) => void;
  /** Phase 6C last-known-good snapshots. */
  lastGood?: () => PackageLastGoodStore | undefined;
}

/** 400 for a malformed request body; never leaks parser internals. */
class BodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyError';
  }
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer | string) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function readJsonObject(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new BodyError(`invalid JSON body: ${err?.message ?? String(err)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BodyError('body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function sendError(res: http.ServerResponse, err: unknown): void {
  if (err instanceof BodyError) {
    send(res, 400, { error: err.message });
    return;
  }
  if (err instanceof PackageManagerError) {
    send(res, err.status, {
      error: err.message,
      ...(err.code !== undefined ? { code: err.code } : {}),
    });
    return;
  }
  if (err instanceof PluginActionError) {
    send(res, err.status, { error: err.message, code: err.code });
    return;
  }
  log.error(`[PluginPackages] unexpected error: ${(err as any)?.message ?? String(err)}`);
  send(res, 500, { error: (err as any)?.message ?? String(err) });
}

async function guarded(res: http.ServerResponse, fn: () => Promise<unknown>): Promise<void> {
  try {
    send(res, 200, await fn());
  } catch (err) {
    sendError(res, err);
  }
}

function requireManager(deps: PluginPackagesRouteDeps): PackageManager {
  const manager = deps.manager();
  if (!manager) {
    // Neutral 503: the package surface exists but the manager is not ready.
    throw new PackageManagerError(503, 'plugin package manager is not available');
  }
  return manager;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BodyError(`${field} must be a string`);
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new BodyError(`${field} must be a boolean`);
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalConsent(value: unknown): InstallConsent | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new BodyError('accept must be an object');
  if (value.trust !== 'trusted' && value.trust !== 'untrusted') {
    throw new BodyError('accept.trust must be "trusted" or "untrusted"');
  }
  if (!Array.isArray(value.permissions) || value.permissions.some((item) => typeof item !== 'string')) {
    throw new BodyError('accept.permissions must be an array of strings');
  }
  return { trust: value.trust, permissions: value.permissions as string[] };
}

function principalOf(req: http.IncomingMessage): { principalKind?: string; principalMethod?: string } {
  const principal = (req as any).mafwPrincipal;
  return {
    ...(typeof principal?.kind === 'string' ? { principalKind: principal.kind } : {}),
    ...(typeof principal?.method === 'string' ? { principalMethod: principal.method } : {}),
  };
}

function assertHuman(req: http.IncomingMessage): void {
  if (!isHumanPrincipal((req as any).mafwPrincipal)) {
    throw new PackageManagerError(403, 'human principal required', 'human_principal_required');
  }
}

function requireSafety(deps: PluginPackagesRouteDeps): PluginSafety {
  const safety = deps.safety?.();
  if (!safety) throw new PackageManagerError(503, 'plugin safety is not available', 'safety_unavailable');
  return safety;
}

function requireDoctor(deps: PluginPackagesRouteDeps): PluginDoctor {
  const doctor = deps.doctor?.();
  if (!doctor) throw new PackageManagerError(503, 'plugin doctor is not available', 'doctor_unavailable');
  return doctor;
}

function requireAudit(deps: PluginPackagesRouteDeps): PluginAuditStore {
  const audit = deps.audit?.();
  if (!audit) throw new PackageManagerError(503, 'plugin audit is not available', 'audit_unavailable');
  return audit;
}

/** GET /api/plugins/client — committed descriptors only (never pending). */
export async function handlePluginClient(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
): Promise<void> {
  await guarded(res, async () => deps.snapshot());
}

/** POST /api/plugins/packages/install — install an absolute local directory. */
export async function handlePluginPackageInstall(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonObject(req);
    const overwrite = optionalBoolean(body.overwrite, 'overwrite');
    const requestId = optionalString(body.requestId, 'requestId');
    const path = optionalString(body.path, 'path');
    const accept = optionalConsent(body.accept);
    if (!path) throw new BodyError('path is required');
    // v2 packages always carry `accept`; only a human/device principal may
    // grant that consent. v1 packages omit it and keep the existing auth path.
    if (accept) assertHuman(req);
    const result = await requireManager(deps).installFromPath({ path, overwrite, requestId, accept });
    log.info(`[PluginPackages] installed ${result.name} (${result.application})`);
    return result;
  });
}

/** POST /api/plugins/check — validate a candidate without publishing it. */
export async function handlePluginPackageCheck(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonObject(req);
    const path = optionalString(body.path, 'path');
    if (!path) throw new BodyError('path is required');
    // `{ok:false}` is the diagnostic channel: always 200.
    return requireManager(deps).checkPath(path);
  });
}

/** POST /api/plugins/:name/apply — commit the staged pending candidate. */
export async function handlePluginApply(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
  params: PluginPackageParams,
): Promise<void> {
  await guarded(res, async () => {
    const name = requireName(params);
    const result = await requireManager(deps).applyPending(name);
    if (!result.runtimeSwitchRequired) return result;

    // The committed package owns the live runtime: the new revision is not in
    // use until the runtime is rebuilt. Reuse the gateway's switch path (event
    // resubscription + identity rematerialization live there, not here).
    if (!deps.switchRuntime) {
      return { ...result, runtimeSwitch: 'required' as const };
    }
    // The runtime contribution's declared name is the loader key; it may differ
    // from the package name. Fall back to the package name only for older hosts
    // that do not report it.
    const target = result.runtimeName ?? name;
    try {
      const switched = await deps.switchRuntime(target);
      if (switched?.success) {
        return { ...result, runtimeSwitch: 'applied' as const, active: switched.active };
      }
      return {
        ...result,
        runtimeSwitch: 'failed' as const,
        runtimeError: switched?.error ?? `runtime switch for "${target}" failed`,
      };
    } catch (err: any) {
      return {
        ...result,
        runtimeSwitch: 'failed' as const,
        runtimeError: err?.message ?? String(err),
      };
    }
  });
}

/** POST /api/plugins/:name/reload — rescan one package through staging/commit. */
export async function handlePluginReload(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
  params: PluginPackageParams,
): Promise<void> {
  await guarded(res, async () => requireManager(deps).reload(requireName(params)));
}

/**
 * POST /api/plugins/:name/actions/:action — invoke one committed action.
 *
 * Body: `{input?, sessionID?, revision?}`. `revision` (or `?revision=`) is the
 * client snapshot the caller built its request against; a superseded token is
 * rejected by the registry as `stale-revision` (409).
 */
export async function handlePluginInvokeAction(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
  params: PluginActionParams,
): Promise<void> {
  await guarded(res, async () => {
    const name = requireName(params);
    const action = requireAction(params);
    const body = await readJsonObject(req);
    const sessionID = optionalString(body.sessionID, 'sessionID');
    const queryRevision = new URL(req.url || '/', 'http://localhost').searchParams.get('revision') ?? undefined;
    const revision = optionalString(body.revision, 'revision') ?? queryRevision;
    const invokeAction = deps.invokeAction;
    if (!invokeAction) {
      throw new PluginActionError('unknown-package', `unknown plugin package "${name}"`);
    }
    const output = await invokeAction(name, action, body.input, { sessionID, revision });
    return {
      package: name,
      action,
      revision: deps.snapshot().revision,
      output,
    };
  });
}

/** POST /api/plugins/kill — enter safe mode and stop every package. */
export async function handlePluginKill(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
): Promise<void> {
  await guarded(res, async () => {
    const result = await requireSafety(deps).kill(principalOf(req));
    for (const name of result.stopped) deps.revokeWebTickets?.(name);
    return result;
  });
}

/** POST /api/plugins/resume — leave safe mode (human/device only). */
export async function handlePluginResume(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
): Promise<void> {
  await guarded(res, async () => {
    assertHuman(req);
    const result = await requireSafety(deps).resume(principalOf(req));
    await deps.reloadAll?.();
    return result;
  });
}

/** POST /api/plugins/:name/quarantine — isolate one package. */
export async function handlePluginQuarantine(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
  params: PluginPackageParams,
): Promise<void> {
  await guarded(res, async () => {
    const name = requireName(params);
    const body = await readJsonObject(req);
    const reason = optionalString(body.reason, 'reason');
    if (!reason) throw new BodyError('reason is required');
    requireSafety(deps).quarantine(name, reason, principalOf(req));
    return { name, quarantined: true, reason };
  });
}

/** POST /api/plugins/:name/unquarantine — clear isolation (human/device only). */
export async function handlePluginUnquarantine(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
  params: PluginPackageParams,
): Promise<void> {
  await guarded(res, async () => {
    assertHuman(req);
    const name = requireName(params);
    requireSafety(deps).unquarantine(name, principalOf(req));
    await deps.reloadAll?.();
    return { name, quarantined: false };
  });
}

/** POST /api/plugins/:name/doctor — diagnose one package. */
export async function handlePluginDoctor(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
  params: PluginPackageParams,
): Promise<void> {
  await guarded(res, async () => requireDoctor(deps).check(requireName(params)));
}

/** POST /api/plugins/doctor — diagnose every installed package. */
export async function handlePluginDoctorAll(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
): Promise<void> {
  await guarded(res, async () => requireDoctor(deps).checkAll());
}

/** GET /api/plugins/:name/last-good — rollback target metadata. */
export async function handlePluginLastGood(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
  params: PluginPackageParams,
): Promise<void> {
  await guarded(res, async () => {
    const name = requireName(params);
    const store = deps.lastGood?.();
    if (!store) {
      throw new PackageManagerError(503, 'last-known-good store is not available', 'last_good_unavailable');
    }
    const meta = store.read(name);
    if (!meta) {
      throw new PackageManagerError(404, `no last-known-good snapshot for ${name}`, 'last_good_missing');
    }
    return { name, lastGood: meta };
  });
}

/** POST /api/plugins/:name/rollback — restore last-known-good (human only). */
export async function handlePluginRollback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
  params: PluginPackageParams,
): Promise<void> {
  await guarded(res, async () => {
    assertHuman(req);
    const name = requireName(params);
    return requireManager(deps).rollback(name);
  });
}

/** GET /api/plugins/audit — recent trust audit events. */
export async function handlePluginAudit(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginPackagesRouteDeps,
): Promise<void> {
  await guarded(res, async () => {
    const query = new URL(req.url || '/', 'http://localhost').searchParams;
    const packageName = query.get('package') ?? undefined;
    const limitRaw = query.get('limit');
    const limit = limitRaw === null ? undefined : Number(limitRaw);
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1 || limit > 500)) {
      throw new BodyError('limit must be between 1 and 500');
    }
    return { events: requireAudit(deps).list({ package: packageName, limit }) };
  });
}

function requireName(params: PluginPackageParams): string {
  if (!params || typeof params.name !== 'string' || params.name.length === 0) {
    throw new BodyError('package name is required');
  }
  return params.name;
}

function requireAction(params: PluginActionParams): string {
  if (!params || typeof params.action !== 'string' || params.action.length === 0) {
    throw new BodyError('action name is required');
  }
  return params.action;
}
