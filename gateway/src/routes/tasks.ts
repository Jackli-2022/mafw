import * as http from 'http';
import type { TaskService } from '../runtime/task-service';

export interface TaskRouteDeps {
  service: TaskService | null | undefined;
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

function json(res: http.ServerResponse, status: number, body: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function fail(res: http.ServerResponse, err: any): void {
  const status = typeof err?.status === 'number' ? err.status : 500;
  json(res, status, { error: err?.message ?? String(err) });
}

function serviceOr503(res: http.ServerResponse, deps: TaskRouteDeps): TaskService | null {
  if (!deps.service) { json(res, 503, { error: 'task service not available' }); return null; }
  return deps.service;
}

/** POST /api/tasks */
export async function handleTaskSubmit(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: TaskRouteDeps,
): Promise<void> {
  const service = serviceOr503(res, deps);
  if (!service) return;
  let body: any;
  try { body = await readJson(req); } catch { json(res, 400, { error: 'invalid json' }); return; }
  try {
    const task = await service.submit({
      kind: body.kind,
      parentSessionID: String(body.parentSessionID ?? ''),
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.command === 'string' ? { command: body.command } : {}),
      ...(typeof body.cwd === 'string' ? { cwd: body.cwd } : {}),
      ...(typeof body.timeout === 'number' ? { timeout: body.timeout } : {}),
      ...(typeof body.prompt === 'string' ? { prompt: body.prompt } : {}),
      ...(typeof body.agent === 'string' ? { agent: body.agent } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(body.model ? { model: body.model } : {}),
      ...(body.outputSchema ? { outputSchema: body.outputSchema } : {}),
    });
    json(res, 200, task);
  } catch (err) { fail(res, err); }
}

/** GET /api/tasks?parentSessionID=&status= */
export function handleTaskList(
  res: http.ServerResponse,
  query: { parentSessionID?: string; status?: string },
  deps: TaskRouteDeps,
): void {
  const service = serviceOr503(res, deps);
  if (!service) return;
  try {
    json(res, 200, { items: service.list(query) });
  } catch (err) { fail(res, err); }
}

/** GET /api/tasks/:id */
export function handleTaskGet(res: http.ServerResponse, id: string, deps: TaskRouteDeps): void {
  const service = serviceOr503(res, deps);
  if (!service) return;
  const task = service.get(id);
  if (!task) { json(res, 404, { error: `task not found: ${id}` }); return; }
  json(res, 200, task);
}

/** POST /api/tasks/:id/cancel */
export async function handleTaskCancel(res: http.ServerResponse, id: string, deps: TaskRouteDeps): Promise<void> {
  const service = serviceOr503(res, deps);
  if (!service) return;
  try { json(res, 200, await service.cancel(id)); } catch (err) { fail(res, err); }
}

/** POST /api/tasks/:id/message */
export async function handleTaskMessage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
  deps: TaskRouteDeps,
): Promise<void> {
  const service = serviceOr503(res, deps);
  if (!service) return;
  let body: any;
  try { body = await readJson(req); } catch { json(res, 400, { error: 'invalid json' }); return; }
  try {
    await service.message(id, String(body.message ?? ''));
    json(res, 200, { ok: true });
  } catch (err) { fail(res, err); }
}

/** GET /api/tasks/:id/output?cursor=&limit= */
export async function handleTaskOutput(
  res: http.ServerResponse,
  id: string,
  query: { cursor?: number; limit?: number },
  deps: TaskRouteDeps,
): Promise<void> {
  const service = serviceOr503(res, deps);
  if (!service) return;
  try { json(res, 200, await service.output(id, query)); } catch (err) { fail(res, err); }
}
