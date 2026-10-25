import * as http from 'http';
import type { SubagentService } from '../runtime/subagent-service';

export interface SubagentRouteDeps {
  service: SubagentService;
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

/** POST /api/sessions/:parent/subagents */
export async function handleSubagentSpawn(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parentID: string,
  deps: SubagentRouteDeps,
): Promise<void> {
  let body: any;
  try { body = await readJson(req); } catch { json(res, 400, { error: 'invalid json' }); return; }
  try {
    const record = await deps.service.spawn({
      parentID,
      ...(typeof body.directory === 'string' ? { directory: body.directory } : {}),
      ...(typeof body.agent === 'string' ? { agent: body.agent } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      prompt: String(body.prompt ?? ''),
      ...(body.background === true ? { background: true } : {}),
      ...(body.model ? { model: body.model } : {}),
      ...(body.outputSchema ? { outputSchema: body.outputSchema } : {}),
    });
    json(res, record.status === 'failed' ? 502 : 200, record);
  } catch (err) { fail(res, err); }
}

/** GET /api/sessions/:parent/subagents */
export async function handleSubagentList(
  res: http.ServerResponse,
  parentID: string,
  deps: SubagentRouteDeps,
): Promise<void> {
  try {
    json(res, 200, { items: await deps.service.list(parentID) });
  } catch (err) { fail(res, err); }
}

/** POST /api/sessions/:parent/subagents/:child/message */
export async function handleSubagentMessage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parentID: string,
  childID: string,
  deps: SubagentRouteDeps,
): Promise<void> {
  let body: any;
  try { body = await readJson(req); } catch { json(res, 400, { error: 'invalid json' }); return; }
  try {
    await deps.service.message(parentID, childID, String(body.message ?? ''));
    json(res, 200, { ok: true });
  } catch (err) { fail(res, err); }
}

/** POST /api/sessions/:parent/subagents/:child/cancel */
export async function handleSubagentCancel(
  res: http.ServerResponse,
  parentID: string,
  childID: string,
  deps: SubagentRouteDeps,
): Promise<void> {
  try {
    await deps.service.cancel(parentID, childID);
    json(res, 200, { ok: true });
  } catch (err) { fail(res, err); }
}

/** GET /api/sessions/:parent/subagents/:child/result */
export async function handleSubagentResult(
  res: http.ServerResponse,
  parentID: string,
  childID: string,
  deps: SubagentRouteDeps,
): Promise<void> {
  try {
    json(res, 200, await deps.service.result(parentID, childID));
  } catch (err) { fail(res, err); }
}
