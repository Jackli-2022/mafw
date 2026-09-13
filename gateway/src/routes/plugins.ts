import * as http from 'http';
import { log } from '../core/utils/logger';
import { HubDeps, HubError, listPlugins, installPlugin, setPluginEnabled, deletePlugin } from '../plugins/hub';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: string) => body += c);
    req.on('end', () => resolve(body));
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
    log.error(`[PluginsHub] unexpected error: ${err.message}`);
    send(res, 500, { error: err.message });
  }
}

export interface PluginsRouteDeps { hub: HubDeps }

export async function handlePluginsList(_req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => ({ plugins: listPlugins(deps.hub) }));
}

export async function handlePluginsInstall(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonBody(req);
    const entry = await installPlugin(deps.hub, {
      type: body.type, filename: body.filename, contentBase64: body.contentBase64, overwrite: !!body.overwrite,
    });
    log.info(`[PluginsHub] installed ${body.type}/${body.filename}`);
    return entry;
  });
}

export async function handlePluginsEnable(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonBody(req);
    return setPluginEnabled(deps.hub, { type: body.type, filename: body.filename, enabled: true });
  });
}

export async function handlePluginsDisable(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonBody(req);
    return setPluginEnabled(deps.hub, { type: body.type, filename: body.filename, enabled: false });
  });
}

export async function handlePluginsDelete(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonBody(req);
    const out = await deletePlugin(deps.hub, { type: body.type, filename: body.filename });
    log.info(`[PluginsHub] deleted ${body.type}/${body.filename}`);
    return out;
  });
}
