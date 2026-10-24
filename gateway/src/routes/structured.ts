import * as http from 'http';
import type { StructuredOutputService } from '../runtime/structured-output';

export interface StructuredRouteDeps {
  service: StructuredOutputService;
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

/** POST /api/structured/submit {sessionID, data} */
export async function handleStructuredSubmit(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: StructuredRouteDeps,
): Promise<void> {
  let body: any;
  try { body = await readJson(req); } catch { json(res, 400, { error: 'invalid json' }); return; }
  const sessionID = typeof body?.sessionID === 'string' ? body.sessionID : '';
  if (!sessionID) { json(res, 400, { error: 'sessionID is required' }); return; }
  if (!Object.prototype.hasOwnProperty.call(body, 'data')) {
    json(res, 400, { error: 'data is required' });
    return;
  }
  const result = deps.service.submit(sessionID, body.data);
  if (!result.ok && result.errors.length === 1 && result.errors[0] === 'no active output schema') {
    json(res, 400, result);
    return;
  }
  json(res, 200, result);
}

/** GET /api/sessions/:id/structured */
export function handleStructuredGet(
  res: http.ServerResponse,
  sessionID: string,
  deps: StructuredRouteDeps,
): void {
  const state = deps.service.get(sessionID);
  if (!state) {
    json(res, 404, { error: 'no structured output state' });
    return;
  }
  json(res, 200, {
    sessionID,
    name: state.spec.name,
    schema: state.spec.schema,
    submitted: state.submitted,
    errors: state.errors ?? [],
    updatedAt: state.updatedAt,
  });
}
