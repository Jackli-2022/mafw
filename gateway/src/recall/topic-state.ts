/**
 * Per-session attention topic. This is a rebuildable/attention state, not a
 * long-term fact and not an episode boundary. Records live in the existing
 * gateway kv store so a session keeps its topic across gateway restarts.
 */

export const TOPIC_STATE_SCOPE = 'session-topic';

export interface TopicState {
  sessionId: string;
  topic: string;
  summary?: string;
  entities: string[];
  aliases: string[];
  openLoops: string[];
  retrievalKeys: string[];
  matterId?: string;
  active: boolean;
  revision: number;
  sourceTraceId?: string;
  updatedAt: string;
}

export interface SetTopicInput {
  sessionID: string;
  topic?: string;
  summary?: string;
  entities?: string[];
  aliases?: string[];
  openLoops?: string[];
  retrievalKeys?: string[];
  matterId?: string;
  active?: boolean;
  expectedRevision?: number;
}

interface TopicDb {
  kvGet(scope: string, key: string): unknown;
  kvSet(scope: string, key: string, value: unknown): void;
  currentTurn(sessionID: string): { trace_id: string } | null;
}

export class TopicRevisionConflict extends Error {
  constructor(expected: number, actual: number) {
    super(`topic revision conflict: expected ${expected}, actual ${actual}`);
    this.name = 'TopicRevisionConflict';
  }
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value.map(clean).filter(Boolean))].slice(0, 32);
}

function stored(db: TopicDb, sessionID: string): Partial<TopicState> | null {
  const value = db.kvGet(TOPIC_STATE_SCOPE, sessionID);
  return value && typeof value === 'object' ? (value as Partial<TopicState>) : null;
}

export function readTopicState(db: TopicDb, sessionID: string): TopicState | null {
  if (!sessionID) return null;
  const value = stored(db, sessionID);
  if (!value || value.active !== true || !clean(value.topic)) return null;
  return {
    sessionId: sessionID,
    topic: String(value.topic),
    ...(value.summary ? { summary: String(value.summary) } : {}),
    entities: list(value.entities, []),
    aliases: list(value.aliases, []),
    openLoops: list(value.openLoops, []),
    retrievalKeys: list(value.retrievalKeys, []),
    ...(value.matterId ? { matterId: String(value.matterId) } : {}),
    active: true,
    revision: Number(value.revision) || 0,
    ...(value.sourceTraceId ? { sourceTraceId: String(value.sourceTraceId) } : {}),
    updatedAt: String(value.updatedAt ?? ''),
  };
}

export function setTopicState(db: TopicDb, input: SetTopicInput): TopicState {
  const sessionID = clean(input.sessionID);
  if (!sessionID) throw new Error('sessionID required');

  const previous = stored(db, sessionID);
  const currentRevision = Number(previous?.revision) || 0;
  if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
    throw new TopicRevisionConflict(input.expectedRevision, currentRevision);
  }

  const topic = clean(input.topic) || clean(previous?.topic);
  const active = input.active ?? true;
  if (active && !topic) throw new Error('topic required when active');

  const state: TopicState = {
    sessionId: sessionID,
    topic,
    ...(clean(input.summary) || clean(previous?.summary)
      ? { summary: clean(input.summary) || clean(previous?.summary) }
      : {}),
    entities: list(input.entities, list(previous?.entities, [])),
    aliases: list(input.aliases, list(previous?.aliases, [])),
    openLoops: list(input.openLoops, list(previous?.openLoops, [])),
    retrievalKeys: list(input.retrievalKeys, list(previous?.retrievalKeys, [])),
    ...(clean(input.matterId) || clean(previous?.matterId)
      ? { matterId: clean(input.matterId) || clean(previous?.matterId) }
      : {}),
    active,
    revision: currentRevision + 1,
    updatedAt: new Date().toISOString(),
  };
  const currentTraceId = db.currentTurn(sessionID)?.trace_id;
  if (currentTraceId) state.sourceTraceId = currentTraceId;

  db.kvSet(TOPIC_STATE_SCOPE, sessionID, state);
  return state;
}
