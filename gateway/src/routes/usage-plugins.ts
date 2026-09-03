import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { log } from '../core/utils/logger';
import type { ExternalAdapter } from '../usage/types';
import { PluginState } from '../usage/plugin-loader';
import { USAGE_TEMPLATES, renderTemplate } from '../usage/templates';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface UsagePluginsDeps {
  loader: {
    getState(): PluginState[];
    getAdapters(): ExternalAdapter[];
    reload(): Promise<void>;
    isBuiltinName(name: string): boolean;
  };
  pluginsDir: string;
  getDisabled(): string[];
  getPluginConfig(name: string): any;
  readBuiltinSource(name: string): string | null;
  runAdapter(name: string): Promise<{ ok: boolean; result?: unknown; error?: string }>;
  builtinNames(): string[];
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function originOf(deps: UsagePluginsDeps, s: PluginState): 'builtin' | 'override' | 'user' {
  if (s.builtin) return 'builtin';
  if (s.name && deps.loader.isBuiltinName(s.name)) return 'override';
  return 'user';
}

/** Name regex already blocks traversal; the prefix check is belt-and-suspenders. */
function safeUserPath(deps: UsagePluginsDeps, name: string): string | null {
  if (!NAME_RE.test(name)) return null;
  const root = path.resolve(deps.pluginsDir);
  const p = path.join(root, name + '.js');
  return p.startsWith(root + path.sep) ? p : null;
}

function syntaxCheck(source: string): string | null {
  try {
    new Function(source);
    return null;
  } catch (err: any) {
    return err.message;
  }
}

function pluginSummary(deps: UsagePluginsDeps): any[] {
  return deps.loader.getState().map(s => ({
    file: s.file,
    name: s.name,
    status: s.status,
    error: s.error,
    disabled: s.disabled,
    origin: originOf(deps, s),
    configSchema: s.configSchema,
    config: s.name ? deps.getPluginConfig(s.name) : null,
  }));
}

export async function handleUsagePluginsList(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: UsagePluginsDeps,
): Promise<void> {
  json(res, 200, { plugins: pluginSummary(deps), templates: USAGE_TEMPLATES, builtins: deps.builtinNames() });
}

export async function handleUsagePluginCreate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: UsagePluginsDeps,
): Promise<void> {
  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err: any) {
    json(res, 400, { error: err.message });
    return;
  }

  const values = body?.values ?? {};
  let name: string | undefined = body?.name ?? values.name;
  let content: string | undefined;

  if (body?.template) {
    if (body.template === 'clone-builtin' && !name) name = values.sourceName;
    const rendered = renderTemplate(String(body.template), { ...values, name }, { readBuiltinSource: deps.readBuiltinSource });
    if (!rendered.ok) {
      json(res, 400, { error: rendered.error });
      return;
    }
    name = rendered.name;
    content = rendered.content;
    // clone-builtin targets a builtin name on purpose (override semantics); other templates must not collide
    if (body.template !== 'clone-builtin' && name && deps.loader.isBuiltinName(name)) {
      json(res, 409, { error: `name '${name}' collides with a builtin plugin` });
      return;
    }
  } else if (typeof body?.source === 'string' && name) {
    if (deps.loader.isBuiltinName(String(name))) {
      json(res, 409, { error: `name '${name}' collides with a builtin plugin` });
      return;
    }
    const err = syntaxCheck(body.source);
    if (err) {
      json(res, 400, { error: `syntax error: ${err}` });
      return;
    }
    content = body.source;
  } else {
    json(res, 400, { error: 'template+values or name+source required' });
    return;
  }

  if (!name || !NAME_RE.test(name)) {
    json(res, 400, { error: 'invalid name' });
    return;
  }
  const target = safeUserPath(deps, name);
  if (!target) {
    json(res, 400, { error: 'invalid name' });
    return;
  }
  if (fs.existsSync(target)) {
    json(res, 409, { error: 'plugin file already exists' });
    return;
  }
  try {
    fs.writeFileSync(target, content!);
  } catch (err: any) {
    json(res, 500, { error: err.message });
    return;
  }
  await deps.loader.reload();
  log.info(`[UsagePlugins] created ${name}`);
  json(res, 200, { ok: true, name, plugins: pluginSummary(deps) });
}

export async function handleUsagePluginSourceGet(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: UsagePluginsDeps,
  name: string,
): Promise<void> {
  const target = safeUserPath(deps, name);
  if (!target) {
    json(res, 400, { error: 'invalid name' });
    return;
  }
  if (fs.existsSync(target)) {
    json(res, 200, { source: fs.readFileSync(target, 'utf8'), origin: deps.loader.isBuiltinName(name) ? 'override' : 'user' });
    return;
  }
  if (deps.loader.isBuiltinName(name)) {
    json(res, 403, { error: 'builtin plugin source is read-only; clone it to edit', builtin: true });
    return;
  }
  json(res, 404, { error: 'plugin file not found' });
}

export async function handleUsagePluginSourcePut(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: UsagePluginsDeps,
  name: string,
): Promise<void> {
  const target = safeUserPath(deps, name);
  if (!target) {
    json(res, 400, { error: 'invalid name' });
    return;
  }
  if (!fs.existsSync(target)) {
    if (deps.loader.isBuiltinName(name)) {
      json(res, 403, { error: 'builtin plugin source is read-only; clone it to edit', builtin: true });
      return;
    }
    json(res, 404, { error: 'plugin file not found' });
    return;
  }
  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err: any) {
    json(res, 400, { error: err.message });
    return;
  }
  if (typeof body?.source !== 'string' || body.source.length === 0) {
    json(res, 400, { error: 'source required' });
    return;
  }
  const err = syntaxCheck(body.source);
  if (err) {
    json(res, 400, { error: `syntax error: ${err}` });
    return;
  }
  try {
    fs.writeFileSync(target, body.source);
  } catch (e: any) {
    json(res, 500, { error: e.message });
    return;
  }
  await deps.loader.reload();
  json(res, 200, { ok: true, plugins: pluginSummary(deps) });
}

export async function handleUsagePluginDelete(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: UsagePluginsDeps,
  name: string,
): Promise<void> {
  const target = safeUserPath(deps, name);
  if (!target) {
    json(res, 400, { error: 'invalid name' });
    return;
  }
  if (!fs.existsSync(target)) {
    if (deps.loader.isBuiltinName(name)) {
      json(res, 403, { error: 'cannot delete a builtin plugin', builtin: true });
      return;
    }
    json(res, 404, { error: 'plugin file not found' });
    return;
  }
  try {
    fs.unlinkSync(target);
  } catch (err: any) {
    json(res, 500, { error: err.message });
    return;
  }
  await deps.loader.reload();
  json(res, 200, { ok: true, plugins: pluginSummary(deps) });
}

export async function handleUsagePluginTest(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: UsagePluginsDeps,
  name: string,
): Promise<void> {
  const result = await deps.runAdapter(name);
  json(res, 200, result);
}
