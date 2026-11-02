import * as http from 'http';
import { log } from '../core/utils/logger';
import { HubDeps, HubError, PluginType, listPlugins, installPlugin, setPluginEnabled, deletePlugin } from '../plugins/hub';
import { PackageManager, PackageManagerError } from '../plugins/package-manager';
import type { PackageState } from '../plugins/package-types';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: string) => body += c);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function readBodyBuffer(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const raw = await readBody(req);
  try { return JSON.parse(raw); } catch (err: any) {
    throw new HubError(400, `invalid JSON body: ${err.message}`);
  }
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function guarded(res: http.ServerResponse, fn: () => Promise<unknown>): Promise<void> {
  try {
    const result = await fn();
    send(res, 200, result);
  } catch (err: any) {
    if (err instanceof HubError) { send(res, err.status, { error: err.message }); return; }
    if (err instanceof PackageManagerError) { send(res, err.status, { error: err.message }); return; }
    log.error(`[PluginsHub] unexpected error: ${err.message}`);
    send(res, 500, { error: err.message });
  }
}

/**
 * Unified package inventory row for `GET /api/plugins`.
 *
 * Host state omits disabled packages entirely (they are skipped during scans),
 * so the gateway merges the manager's persisted disabled names into this view.
 */
export interface PluginsPackageEntry extends Omit<PackageState, 'status'> {
  status: PackageState['status'] | 'disabled';
  enabled: boolean;
}

export interface PluginsRouteDeps {
  hub: HubDeps;
  /**
   * Manager-backed inventory (active + pending + disabled). When absent the
   * legacy `hub.getPackages()` provider is used unchanged.
   */
  packages?: () => PluginsPackageEntry[];
  /** Current committed client revision (`<bootId>:<counter>`). */
  packageRevision?: () => string;
  /** Unified package manager thunk (package-mode enable/disable/delete). */
  getManager?: () => PackageManager | undefined;
}

function isPackageBody(body: any): body is { package: string } {
  return !!body && typeof body === 'object' && typeof body.package === 'string';
}

function assertBodyShape(body: any): void {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HubError(400, 'body must be a JSON object');
  }
  const hasPackage = body.package !== undefined;
  const hasLegacy = body.type !== undefined || body.filename !== undefined;
  if (hasPackage && hasLegacy) {
    throw new HubError(400, 'use either { package } or { type, filename }, not both');
  }
  if (hasPackage && (typeof body.package !== 'string' || body.package.length === 0)) {
    throw new HubError(400, `invalid package name: ${String(body.package)}`);
  }
}

function requireManager(deps: PluginsRouteDeps): PackageManager {
  const manager = deps.getManager?.();
  if (!manager) throw new HubError(503, 'plugin package manager is not available');
  return manager;
}

export async function handlePluginsList(_req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const packages = deps.packages?.() ?? (deps.hub.getPackages?.() as PluginsPackageEntry[] | undefined) ?? [];
    const revision = deps.packageRevision?.();
    return {
      plugins: listPlugins(deps.hub),
      packages,
      ...(revision ? { revision } : {}),
    };
  });
}

export async function handlePluginsInstall(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const url = new URL(req.url || '/', 'http://localhost');
    const filename = url.searchParams.get('filename') || '';
    const type = (url.searchParams.get('type') || undefined) as PluginType | undefined;
    const overwrite = url.searchParams.get('overwrite') === '1' || url.searchParams.get('overwrite') === 'true';
    const bytes = await readBodyBuffer(req);
    const entry = await installPlugin(deps.hub, { filename, type, bytes, overwrite });
    log.info(`[PluginsHub] installed ${entry.type}/${filename}`);
    return entry;
  });
}

export async function handlePluginsEnable(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonBody(req);
    assertBodyShape(body);
    if (isPackageBody(body)) {
      const out = await requireManager(deps).enable(body.package);
      log.info(`[PluginsHub] enabled package ${body.package}`);
      return out;
    }
    return setPluginEnabled(deps.hub, { type: body.type, filename: body.filename, enabled: true });
  });
}

export async function handlePluginsDisable(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonBody(req);
    assertBodyShape(body);
    if (isPackageBody(body)) {
      const out = await requireManager(deps).disable(body.package);
      log.info(`[PluginsHub] disabled package ${body.package}`);
      return out;
    }
    return setPluginEnabled(deps.hub, { type: body.type, filename: body.filename, enabled: false });
  });
}

export async function handlePluginsDelete(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonBody(req);
    assertBodyShape(body);
    if (isPackageBody(body)) {
      const out = await requireManager(deps).remove(body.package);
      log.info(`[PluginsHub] removed package ${body.package}`);
      return out;
    }
    const out = await deletePlugin(deps.hub, { type: body.type, filename: body.filename });
    log.info(`[PluginsHub] deleted ${body.type}/${body.filename}`);
    return out;
  });
}
