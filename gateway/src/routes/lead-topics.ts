import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteRegistry } from './registry';
import { readRouteBody } from './cognition';
import type { LeadGoalStatus } from '../core/lead/goal-status';
import { buildLeadContext, type LeadContext } from '../core/lead/lead-context';
import type { LeadTopicRow, LeadTopicStore } from '../core/lead/lead-topic-store';
import { compactTopic } from '../core/lead/topic-summary';
import { recallTopics, type RecallCandidate, type RecallTopicInput } from '../core/lead/topic-recall';
import type { TopicMessageIndexRow, TopicMessageIndexStore } from '../core/lead/topic-message-index';
import { estimateTopicTokens, selectWorkingSet, type WorkingSet } from '../core/lead/working-set';
import type { MafwMessage } from '../runtime/canonical-types';

export interface LeadTopicView {
  id: string;
  title: string;
  summary: string | null;
  state: LeadTopicRow['state'];
  lastActiveAt: string;
  goalId: string;
  resumedFrom: string | null;
}

export interface LeadTopicRouteDeps {
  isLeadSession(sessionID: string): boolean;
  projectDirForSession(sessionID: string): string | null;
  topics: Pick<LeadTopicStore, 'listByProject' | 'search' | 'get' | 'updateSummary' | 'setState'>;
  index: Pick<TopicMessageIndexStore, 'listByTopic' | 'listByProject' | 'replaceTopic'>;
  goals(projectDir: string): LeadGoalStatus[];
  workingSetEnabled(): boolean;
  listMessages?(input: { sessionID: string; limit: number }): Promise<{ data: MafwMessage[] }>;
  broadcast?(event: { type: string; properties: Record<string, unknown> }): void;
  now?(): string;
}

const EMPTY_CONTEXT: LeadContext = {
  blocks: [],
  totalTokens: 0,
  recalledTopicIds: [],
  trimmed: [],
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function projectDirOf(value: unknown): string {
  return clean(value) || process.env.MAFW_PROJECT_DIR || process.cwd();
}

function limitOf(value: unknown, fallback = 20): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(1, Math.trunc(parsed))) : fallback;
}

function toView(row: LeadTopicRow): LeadTopicView {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    state: row.state,
    lastActiveAt: row.lastActiveAt,
    goalId: row.goalId,
    resumedFrom: row.resumedFrom,
  };
}

function recallInputs(rows: LeadTopicRow[], deps: LeadTopicRouteDeps): RecallTopicInput[] {
  return rows.map((topic) => ({
    id: topic.id,
    title: topic.title,
    summary: topic.summary,
    index: deps.index.listByTopic(topic.id),
  }));
}

/** GET /api/lead/context — per-turn working-set blocks for the host plugin. */
export function handleLeadContext(
  args: { sessionID?: string; query?: string },
  deps: LeadTopicRouteDeps,
): { status: number; body: LeadContext } {
  const sessionID = clean(args?.sessionID);
  const query = typeof args?.query === 'string' ? args.query : '';
  if (!sessionID || !deps.workingSetEnabled() || !deps.isLeadSession(sessionID)) {
    return { status: 200, body: EMPTY_CONTEXT };
  }
  const projectDir = deps.projectDirForSession(sessionID);
  if (!projectDir) return { status: 200, body: EMPTY_CONTEXT };

  const topics = deps.topics.listByProject(projectDir, 50);
  const inputs = recallInputs(topics, deps);
  const recalled: Array<{ candidate: RecallCandidate; topic: RecallTopicInput }> = [];
  for (const candidate of recallTopics({ query, topics: inputs })) {
    const topic = inputs.find((item) => item.id === candidate.topicId);
    if (topic) recalled.push({ candidate, topic });
  }

  return {
    status: 200,
    body: buildLeadContext({
      goals: deps.goals(projectDir),
      topics,
      query,
      recalled,
    }),
  };
}

/** GET /api/lead/topics — user-facing topic index (no session ids). */
export function handleListTopics(
  args: { projectDir?: string; query?: string; limit?: number },
  deps: LeadTopicRouteDeps,
): { status: number; body: { items: LeadTopicView[] } } {
  const projectDir = projectDirOf(args?.projectDir);
  const query = clean(args?.query);
  const limit = limitOf(args?.limit);
  const rows = query
    ? deps.topics.search(projectDir, query, limit)
    : deps.topics.listByProject(projectDir, limit);
  return { status: 200, body: { items: rows.map(toView) } };
}

/** GET /api/lead/topics/:id — topic detail + searchable index rows. */
export function handleGetTopic(
  args: { id?: string },
  deps: LeadTopicRouteDeps,
): { status: number; body: { topic: LeadTopicView; messages: TopicMessageIndexRow[] } | { error: string } } {
  const id = clean(args?.id);
  const row = id ? deps.topics.get(id) : null;
  if (!row) return { status: 404, body: { error: 'topic not found' } };
  return {
    status: 200,
    body: {
      topic: toView(row),
      messages: deps.index.listByTopic(row.id, 100),
    },
  };
}

/** GET /api/lead/working-set — developer diagnostic view + topic projection. */
export function handleWorkingSet(
  args: { projectDir?: string },
  deps: LeadTopicRouteDeps,
): { status: number; body: WorkingSet & { topics: LeadTopicView[] } } {
  const projectDir = projectDirOf(args?.projectDir);
  const rows = deps.topics.listByProject(projectDir, 100);
  const ws = selectWorkingSet({
    topics: rows.map((topic) => ({
      id: topic.id,
      state: topic.state,
      summary: topic.summary,
      lastActiveAt: topic.lastActiveAt,
      goalId: topic.goalId,
      residentTokens: topic.residentTokens,
    })),
  });
  return { status: 200, body: { ...ws, topics: rows.map(toView) } };
}

/** GET /api/lead/recall — diagnostic candidates; never injects or writes. */
export function handleRecall(
  args: { projectDir?: string; q?: string },
  deps: LeadTopicRouteDeps,
): { status: number; body: { candidates: RecallCandidate[] } } {
  if (!deps.workingSetEnabled()) return { status: 200, body: { candidates: [] } };
  const projectDir = projectDirOf(args?.projectDir);
  const rows = deps.topics.listByProject(projectDir, 100);
  return {
    status: 200,
    body: {
      candidates: recallTopics({ query: clean(args?.q), topics: recallInputs(rows, deps) }),
    },
  };
}

function messageRows(topicId: string, messages: MafwMessage[], createdAt: string): TopicMessageIndexRow[] {
  const rows: TopicMessageIndexRow[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    if (!message.id || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((part: any) => part?.type === 'text' && part.synthetic !== true && typeof part.text === 'string')
      .map((part: any) => String(part.text).trim())
      .filter(Boolean)
      .join('\n');
    if (!text) continue;
    rows.push({
      topicId,
      messageId: message.id,
      role: message.role,
      text,
      tokenEstimate: estimateTopicTokens(text),
      createdAt,
    });
  }
  return rows;
}

/** POST /api/lead/compact — page out a topic; never deletes the transcript. */
export async function handleCompact(
  args: { topicId?: string },
  deps: LeadTopicRouteDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!deps.workingSetEnabled()) {
    return { status: 503, body: { error: 'lead working set is disabled' } };
  }
  const id = clean(args?.topicId);
  const row = id ? deps.topics.get(id) : null;
  if (!row) return { status: 404, body: { error: 'topic not found' } };
  if (!deps.listMessages || !deps.broadcast) {
    return { status: 503, body: { error: 'lead compaction is unavailable' } };
  }

  const now = deps.now?.() ?? new Date().toISOString();
  const page = await deps.listMessages({ sessionID: row.leadSessionId, limit: 200 });
  const result = compactTopic({ topicId: id, messages: page.data });
  deps.topics.updateSummary(id, {
    summary: result.summary,
    summaryHash: result.summaryHash,
    now,
    residentTokens: result.afterTokens,
  });
  deps.topics.setState(id, 'warm', now);
  deps.index.replaceTopic(id, messageRows(id, page.data, now));
  deps.broadcast({
    type: 'lead.compaction',
    properties: {
      topicId: id,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
    },
  });

  return {
    status: 200,
    body: {
      topicId: id,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      evictedMessageIds: result.evictedMessageIds,
    },
  };
}

function send(res: ServerResponse, out: { status: number; body: unknown }): void {
  res.writeHead(out.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(out.body));
}

/** Attach the Lead working-set routes to the unified route registry. */
export function attachLeadTopicRoutes(registry: RouteRegistry, deps: LeadTopicRouteDeps): void {
  registry.attachHandler('lead.context', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    send(res, handleLeadContext({
      sessionID: url.searchParams.get('sessionID') ?? '',
      query: url.searchParams.get('query') ?? '',
    }, deps));
  });
  registry.attachHandler('lead.topics.list', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    send(res, handleListTopics({
      projectDir: url.searchParams.get('projectDir') ?? undefined,
      query: url.searchParams.get('query') ?? undefined,
      limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
    }, deps));
  });
  registry.attachHandler('lead.topics.get', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    send(res, handleGetTopic({ id: params.id }, deps));
  });
  registry.attachHandler('lead.workingSet', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    send(res, handleWorkingSet({ projectDir: url.searchParams.get('projectDir') ?? undefined }, deps));
  });
  registry.attachHandler('lead.recall', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    send(res, handleRecall({
      projectDir: url.searchParams.get('projectDir') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
    }, deps));
  });
  registry.attachHandler('lead.compact', async (req: IncomingMessage, res: ServerResponse) => {
    let body: any = {};
    try { body = JSON.parse(await readRouteBody(req) || '{}'); } catch { body = {}; }
    send(res, await handleCompact({ topicId: body?.topicId }, deps));
  });
}
