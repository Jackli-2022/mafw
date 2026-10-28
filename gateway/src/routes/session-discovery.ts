import * as http from 'http';
import { DiscoveryError, type DiscoveryService } from '../core/discovery/discovery-service';

export interface SessionDiscoveryDeps {
  discovery: DiscoveryService | null;
}

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function query(req: http.IncomingMessage): { directory?: string; force: boolean } {
  const url = new URL(req.url || '/', 'http://x');
  return {
    directory: url.searchParams.get('directory') ?? undefined,
    force: url.searchParams.get('force') === '1',
  };
}

function fail(res: http.ServerResponse, err: unknown): void {
  if (err instanceof DiscoveryError) {
    json(res, err.status, { error: err.message });
    return;
  }
  json(res, 500, { error: (err as any)?.message ?? String(err) });
}

export async function handleSessionDiscovery(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>,
  deps: SessionDiscoveryDeps,
): Promise<boolean> {
  const m = (req.url || '').match(/^\/api\/sessions\/([^/]+)\/discovery(?:\?|$)/);
  if (!m || req.method !== 'GET') return false;
  if (!deps.discovery) {
    json(res, 503, { error: 'discovery service unavailable' });
    return true;
  }
  const q = query(req);
  try {
    const snap = await deps.discovery.get(params.id, {
      directory: q.directory,
      force: q.force,
    });
    json(res, 200, snap);
  } catch (err) {
    fail(res, err);
  }
  return true;
}

export async function handleSessionDiscoveryRefresh(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>,
  deps: SessionDiscoveryDeps,
): Promise<boolean> {
  const m = (req.url || '').match(/^\/api\/sessions\/([^/]+)\/discovery\/refresh(?:\?|$)/);
  if (!m || req.method !== 'POST') return false;
  if (!deps.discovery) {
    json(res, 503, { error: 'discovery service unavailable' });
    return true;
  }
  const q = query(req);
  try {
    const snap = await deps.discovery.refresh(params.id, { directory: q.directory });
    json(res, 200, snap);
  } catch (err) {
    fail(res, err);
  }
  return true;
}

export async function handleSessionDiscoverySkill(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>,
  deps: SessionDiscoveryDeps,
): Promise<boolean> {
  const m = (req.url || '').match(/^\/api\/sessions\/([^/]+)\/discovery\/skills\/([^/?]+)(?:\?|$)/);
  if (!m || req.method !== 'GET') return false;
  if (!deps.discovery) {
    json(res, 503, { error: 'discovery service unavailable' });
    return true;
  }
  const q = query(req);
  const key = params.key ?? decodeURIComponent(m[2]);
  try {
    const skill = await deps.discovery.loadSkill(params.id, key, {
      directory: q.directory,
      force: q.force,
    });
    json(res, 200, skill);
  } catch (err) {
    fail(res, err);
  }
  return true;
}

export async function handleLegacyCommand(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: SessionDiscoveryDeps,
): Promise<boolean> {
  const m = (req.url || '').match(/^\/command(?:\?|$)/);
  if (!m || req.method !== 'GET') return false;
  if (!deps.discovery) {
    json(res, 503, { error: 'discovery service unavailable' });
    return true;
  }
  const q = query(req);
  try {
    const result = await deps.discovery.getLegacyCommands(q.directory, { force: q.force });
    json(res, 200, result);
  } catch (err) {
    fail(res, err);
  }
  return true;
}

export async function handleLegacySkill(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: SessionDiscoveryDeps,
): Promise<boolean> {
  const m = (req.url || '').match(/^\/skill(?:\?|$)/);
  if (!m || req.method !== 'GET') return false;
  if (!deps.discovery) {
    json(res, 503, { error: 'discovery service unavailable' });
    return true;
  }
  const q = query(req);
  try {
    const result = await deps.discovery.getLegacySkills(q.directory, { force: q.force });
    json(res, 200, result);
  } catch (err) {
    fail(res, err);
  }
  return true;
}
