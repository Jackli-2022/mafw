import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteRegistry } from './registry';
import type { LeadGoalStatus } from '../core/lead/goal-status';
import { buildLeadContext, type LeadContext } from '../core/lead/lead-context';
import type { LeadTopicStore } from '../core/lead/lead-topic-store';
import { recallTopics, type RecallCandidate, type RecallTopicInput } from '../core/lead/topic-recall';
import type { TopicMessageIndexStore } from '../core/lead/topic-message-index';

export interface LeadTopicRouteDeps {
  isLeadSession(sessionID: string): boolean;
  projectDirForSession(sessionID: string): string | null;
  topics: Pick<LeadTopicStore, 'listByProject'>;
  index: Pick<TopicMessageIndexStore, 'listByTopic'>;
  goals(projectDir: string): LeadGoalStatus[];
  workingSetEnabled(): boolean;
}

const EMPTY_CONTEXT: LeadContext = {
  blocks: [],
  totalTokens: 0,
  recalledTopicIds: [],
  trimmed: [],
};

/** GET /api/lead/context — per-turn working-set blocks for the host plugin. */
export function handleLeadContext(
  args: { sessionID?: string; query?: string },
  deps: LeadTopicRouteDeps,
): { status: number; body: LeadContext } {
  const sessionID = typeof args?.sessionID === 'string' ? args.sessionID.trim() : '';
  const query = typeof args?.query === 'string' ? args.query : '';
  if (!sessionID || !deps.workingSetEnabled() || !deps.isLeadSession(sessionID)) {
    return { status: 200, body: EMPTY_CONTEXT };
  }
  const projectDir = deps.projectDirForSession(sessionID);
  if (!projectDir) return { status: 200, body: EMPTY_CONTEXT };

  const topics = deps.topics.listByProject(projectDir, 50);
  const recallInputs: RecallTopicInput[] = topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    summary: topic.summary,
    index: deps.index.listByTopic(topic.id),
  }));
  const recalled: Array<{ candidate: RecallCandidate; topic: RecallTopicInput }> = [];
  for (const candidate of recallTopics({ query, topics: recallInputs })) {
    const topic = recallInputs.find((item) => item.id === candidate.topicId);
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

/** Attach the Lead working-set routes to the unified route registry. */
export function attachLeadTopicRoutes(registry: RouteRegistry, deps: LeadTopicRouteDeps): void {
  registry.attachHandler('lead.context', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const out = handleLeadContext({
      sessionID: url.searchParams.get('sessionID') ?? '',
      query: url.searchParams.get('query') ?? '',
    }, deps);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });
}
