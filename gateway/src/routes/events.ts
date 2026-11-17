import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteRegistry } from './registry';
import { readRouteBody } from './cognition';
import { humanOnlyDenied, isHumanPrincipal } from '../core/auth';
import type {
  EventDeliveryRow,
  EventSourceKind,
  EventSourceRow,
  EventSubscriptionRow,
  EventThreadRow,
  EventTriggerRow,
} from '../core/events/event-types';

const SOURCE_KINDS: readonly EventSourceKind[] = ['github', 'cron', 'internal', 'webhook'];

export interface EventSourceView {
  id: string;
  kind: EventSourceKind;
  name: string;
  enabled: boolean;
  cursor: Record<string, unknown>;
  updatedAt: string;
}

function sourceView(row: EventSourceRow): EventSourceView {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    enabled: row.enabled,
    cursor: row.cursor,
    updatedAt: row.updatedAt,
  };
}

export interface EventRouteDeps {
  enabled(): boolean;
  sources: {
    list(projectDir: string): EventSourceRow[];
    create(input: unknown): EventSourceRow;
    setEnabled(id: string, enabled: boolean): boolean;
  };
  threads: {
    list(projectDir: string, sourceId?: string): EventThreadRow[];
    triggers(threadId: string): EventTriggerRow[];
    subscriptions(threadId: string): EventSubscriptionRow[];
    close(threadId: string): { closed: boolean; handedBack: number; dropped: number };
  };
  subscribe(input: unknown): EventSubscriptionRow;
  unsubscribe(id: string): boolean;
  deliveries(threadId: string): EventDeliveryRow[];
  markReceipt?(id: string, next: 'read' | 'answered'): EventDeliveryRow;
  webhook(
    sourceId: string,
    headers: Record<string, string | undefined>,
    body: unknown,
    rawBody?: string,
  ): Promise<{ accepted: boolean; duplicate?: boolean; status?: number }>;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Human-only receipt for one external delivery (read / answered). */
export function handleDeliveryReceipt(
  input: { id: string; next: 'read' | 'answered' },
  deps: EventRouteDeps,
): { status: number; body: any } {
  const denied = gate(deps);
  if (denied) return denied;
  if (!input.id) return { status: 400, body: { error: 'delivery id is required' } };
  if (!deps.markReceipt) return { status: 503, body: { error: 'event layer disabled' } };
  try {
    return { status: 200, body: { delivery: deps.markReceipt(input.id, input.next) } };
  } catch (err: any) {
    const message = String(err?.message ?? err);
    if (message.includes('delivery not found')) return { status: 404, body: { error: message } };
    if (message.includes('invalid delivery transition')) return { status: 409, body: { error: message } };
    throw err;
  }
}

function projectDirOf(value: unknown): string {
  return clean(value) || process.env.MAFW_PROJECT_DIR || process.cwd();
}

function gate(deps: EventRouteDeps): { status: number; body: any } | null {
  return deps.enabled() ? null : { status: 503, body: { error: 'event layer disabled' } };
}

function fail(status: number, error: string): { status: number; body: { error: string } } {
  return { status, body: { error } };
}

export function handleListSources(
  args: { projectDir?: string },
  deps: EventRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  return { status: 200, body: { items: deps.sources.list(projectDirOf(args?.projectDir)).map(sourceView) } };
}

export function handleCreateSource(
  args: { kind?: string; projectDir?: string; name?: string; config?: Record<string, unknown> },
  deps: EventRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  const kind = clean(args?.kind) as EventSourceKind;
  if (!SOURCE_KINDS.includes(kind)) return fail(400, `unknown event source kind: ${args?.kind ?? ''}`);
  const name = clean(args?.name);
  if (!name) return fail(400, 'event source name is required');
  const config = args?.config && typeof args.config === 'object' ? args.config : {};
  try {
    return {
      status: 200,
      body: sourceView(deps.sources.create({ projectDir: projectDirOf(args?.projectDir), kind, name, config })),
    };
  } catch (err: any) {
    return fail(typeof err?.status === 'number' ? err.status : 500, String(err?.message ?? err));
  }
}

export function handlePatchSource(
  args: { id?: string; enabled?: boolean },
  deps: EventRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  const id = clean(args?.id);
  if (!id) return fail(400, 'event source id is required');
  if (typeof args?.enabled !== 'boolean') return fail(400, 'enabled must be a boolean');
  return deps.sources.setEnabled(id, args.enabled)
    ? { status: 200, body: { ok: true } }
    : fail(404, `event source not found: ${id}`);
}

export function handleListThreads(
  args: { projectDir?: string; sourceId?: string },
  deps: EventRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  return {
    status: 200,
    body: { items: deps.threads.list(projectDirOf(args?.projectDir), clean(args?.sourceId) || undefined) },
  };
}

export function handleListTriggers(
  args: { id?: string },
  deps: EventRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  const id = clean(args?.id);
  if (!id) return fail(400, 'event thread id is required');
  return { status: 200, body: { items: deps.threads.triggers(id) } };
}

export function handleListSubscriptions(
  args: { id?: string },
  deps: EventRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  const id = clean(args?.id);
  if (!id) return fail(400, 'event thread id is required');
  return { status: 200, body: { items: deps.threads.subscriptions(id) } };
}

export function handleCloseThread(
  args: { id?: string },
  deps: EventRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  const id = clean(args?.id);
  if (!id) return fail(400, 'event thread id is required');
  try {
    return { status: 200, body: deps.threads.close(id) };
  } catch (err: any) {
    return fail(typeof err?.status === 'number' ? err.status : 500, String(err?.message ?? err));
  }
}

export function handleCreateSubscription(
  args: { id?: string; subscriberType?: string; subscriberId?: string; mode?: string },
  deps: EventRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  const threadId = clean(args?.id);
  const subscriberType = clean(args?.subscriberType);
  const subscriberId = clean(args?.subscriberId);
  const mode = clean(args?.mode);
  if (!threadId || !subscriberType || !subscriberId || (mode !== 'work' && mode !== 'context')) {
    return fail(400, 'threadId, subscriberType, subscriberId and mode (work|context) are required');
  }
  try {
    return {
      status: 200,
      body: deps.subscribe({ threadId, subscriberType, subscriberId, mode }),
    };
  } catch (err: any) {
    return fail(typeof err?.status === 'number' ? err.status : 500, String(err?.message ?? err));
  }
}

export function handleDeleteSubscription(
  args: { id?: string },
  deps: EventRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  const id = clean(args?.id);
  if (!id) return fail(400, 'event subscription id is required');
  return deps.unsubscribe(id)
    ? { status: 200, body: { ok: true } }
    : fail(404, `event subscription not found: ${id}`);
}

export function handleListDeliveries(
  args: { threadId?: string },
  deps: EventRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  const threadId = clean(args?.threadId);
  if (!threadId) return fail(400, 'threadId is required');
  return { status: 200, body: { items: deps.deliveries(threadId) } };
}

export async function handleWebhook(
  args: { id?: string },
  headers: Record<string, string | undefined>,
  body: unknown,
  deps: EventRouteDeps,
  rawBody?: string,
): Promise<{ status: number; body: any }> {
  const off = gate(deps);
  if (off) return off;
  const id = clean(args?.id);
  if (!id) return fail(400, 'event source id is required');
  const result = await deps.webhook(id, headers, body, rawBody);
  if (!result.accepted) return fail(result.status ?? 401, 'webhook rejected');
  return { status: 200, body: { accepted: true, duplicate: result.duplicate ?? false } };
}

function send(res: ServerResponse, out: { status: number; body: unknown }): void {
  res.writeHead(out.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(out.body));
}

export function attachEventRoutes(registry: RouteRegistry, deps: EventRouteDeps): void {
  registry.attachHandler('events.sources.list', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    send(res, handleListSources({ projectDir: url.searchParams.get('projectDir') ?? undefined }, deps));
  });
  registry.attachHandler('events.sources.create', async (req: IncomingMessage, res: ServerResponse) => {
    let body: any = {};
    try { body = JSON.parse(await readRouteBody(req) || '{}'); } catch { body = {}; }
    send(res, handleCreateSource(body, deps));
  });
  registry.attachHandler('events.sources.patch', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    let body: any = {};
    try { body = JSON.parse(await readRouteBody(req) || '{}'); } catch { body = {}; }
    send(res, handlePatchSource({ id: params.id, enabled: body?.enabled }, deps));
  });
  registry.attachHandler('events.threads.list', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    send(res, handleListThreads({
      projectDir: url.searchParams.get('projectDir') ?? undefined,
      sourceId: url.searchParams.get('sourceId') ?? undefined,
    }, deps));
  });
  registry.attachHandler('events.threads.triggers', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    send(res, handleListTriggers({ id: params.id }, deps));
  });
  registry.attachHandler('events.threads.close', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    send(res, handleCloseThread({ id: params.id }, deps));
  });
  registry.attachHandler('events.threads.subscriptions.list', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    send(res, handleListSubscriptions({ id: params.id }, deps));
  });
  registry.attachHandler('events.threads.subscriptions.create', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    let body: any = {};
    try { body = JSON.parse(await readRouteBody(req) || '{}'); } catch { body = {}; }
    send(res, handleCreateSubscription({ id: params.id, ...body }, deps));
  });
  registry.attachHandler('events.subscriptions.delete', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    send(res, handleDeleteSubscription({ id: params.id }, deps));
  });
  registry.attachHandler('events.deliveries.list', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    send(res, handleListDeliveries({ threadId: url.searchParams.get('threadId') ?? undefined }, deps));
  });
  const receiptHandler = (next: 'read' | 'answered') => async (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ) => {
    if (!isHumanPrincipal((req as any).mafwPrincipal)) {
      send(res, humanOnlyDenied());
      return;
    }
    send(res, handleDeliveryReceipt({ id: params.id, next }, deps));
  };
  registry.attachHandler('events.deliveries.read', receiptHandler('read'));
  registry.attachHandler('events.deliveries.answer', receiptHandler('answered'));
  registry.attachHandler('events.webhook.receive', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    let rawBody = '';
    let body: any = {};
    try {
      rawBody = await readRouteBody(req);
      body = JSON.parse(rawBody || '{}');
    } catch {
      rawBody = '';
      body = {};
    }
    send(res, await handleWebhook(
      { id: params.id },
      Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])),
      body,
      deps,
      rawBody,
    ));
  });
}
