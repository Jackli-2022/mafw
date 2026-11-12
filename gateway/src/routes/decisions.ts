import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteRegistry } from './registry';
import {
  DecisionRecordError,
  type DecisionRecordService,
} from '../core/decision/decision-record-service';

export interface DecisionRouteDeps {
  service: Pick<DecisionRecordService, 'list' | 'draft' | 'confirm' | 'shelve' | 'reopen'>;
}

type DecisionMutation = 'confirm' | 'shelve' | 'reopen';

function projectDirOf(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : process.env.MAFW_PROJECT_DIR || process.cwd();
}

function failure(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof DecisionRecordError) {
    return { status: error.status, body: { error: error.message } };
  }
  return { status: 500, body: { error: String((error as any)?.message ?? error) } };
}

function actorOf(body: Record<string, unknown>): string {
  return typeof body.actorSessionID === 'string' ? body.actorSessionID.trim() : '';
}

export function handleDecisionList(
  args: { projectDir?: string; goalId?: string },
  deps: DecisionRouteDeps,
): { status: number; body: { items: unknown[] } | { error: string } } {
  try {
    const items = deps.service.list(projectDirOf(args?.projectDir), args?.goalId);
    return { status: 200, body: { items } };
  } catch (error) {
    return failure(error);
  }
}

export function handleDecisionDraft(
  body: Record<string, unknown>,
  deps: DecisionRouteDeps,
): { status: number; body: { record: unknown } | { error: string } } {
  try {
    const record = deps.service.draft({
      ...(body as any),
      projectDir: projectDirOf(body.projectDir),
    });
    return { status: 200, body: { record } };
  } catch (error) {
    return failure(error);
  }
}

export function handleDecisionMutation(
  action: DecisionMutation,
  id: string,
  body: Record<string, unknown>,
  deps: DecisionRouteDeps,
): { status: number; body: { record: unknown } | { error: string } } {
  if (actorOf(body)) {
    return { status: 403, body: { error: 'decision confirmation is human-only' } };
  }
  const { actorSessionID: _actor, ...input } = body;
  try {
    const record = deps.service[action](id, {
      ...(input as any),
      projectDir: projectDirOf(input.projectDir),
    });
    return { status: 200, body: { record } };
  } catch (error) {
    return failure(error);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, out: { status: number; body: unknown }): void {
  res.writeHead(out.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(out.body));
}

export function attachDecisionRoutes(registry: RouteRegistry, deps: DecisionRouteDeps): void {
  registry.attachHandler('decisions.list', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    send(res, handleDecisionList({
      projectDir: url.searchParams.get('projectDir') ?? undefined,
      goalId: url.searchParams.get('goalId') ?? undefined,
    }, deps));
  });

  registry.attachHandler('decisions.draft', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      send(res, handleDecisionDraft(body, deps));
    } catch {
      send(res, { status: 400, body: { error: 'invalid JSON body' } });
    }
  });

  const mutation = (action: DecisionMutation) => async (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      send(res, handleDecisionMutation(action, params.id ?? '', body, deps));
    } catch {
      send(res, { status: 400, body: { error: 'invalid JSON body' } });
    }
  };

  registry.attachHandler('decisions.confirm', mutation('confirm'));
  registry.attachHandler('decisions.shelve', mutation('shelve'));
  registry.attachHandler('decisions.reopen', mutation('reopen'));
}
