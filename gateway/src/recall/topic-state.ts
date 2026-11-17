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

const LIMITS = {
  topic: 200,
  summary: 1_000,
  listItem: 200,
  listCount: 32,
  matterId: 200,
} as const;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function bounded(value: unknown, max: number, field: string): string {
  const text = clean(value);
  if (text.length > max) throw new Error(`${field} too long (max ${max})`);
  return text;
}

function list(value: unknown, fallback: string[], field: string): string[] {
  if (!Array.isArray(value)) return fallback;
  if (value.length > LIMITS.listCount) throw new Error(`${field} has too many items`);
  return [...new Set(value.map((item) => {
    const text = bounded(item, LIMITS.listItem, field);
    return text;
  }).filter(Boolean))];
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
    entities: list(value.entities, [], 'entities'),
    aliases: list(value.aliases, [], 'aliases'),
    openLoops: list(value.openLoops, [], 'openLoops'),
    retrievalKeys: list(value.retrievalKeys, [], 'retrievalKeys'),
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
  if (
    input.expectedRevision !== undefined &&
    (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0)
  ) {
    throw new Error('expectedRevision must be a non-negative integer');
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
    throw new TopicRevisionConflict(input.expectedRevision, currentRevision);
  }
  if (input.active !== undefined && typeof input.active !== 'boolean') {
    throw new Error('active must be boolean');
  }

  const topic = bounded(input.topic, LIMITS.topic, 'topic') || clean(previous?.topic);
  const active = input.active ?? true;
  if (active && !topic) throw new Error('topic required when active');
  const summary = bounded(input.summary, LIMITS.summary, 'summary') || clean(previous?.summary);
  const matterId = bounded(input.matterId, LIMITS.matterId, 'matterId') || clean(previous?.matterId);

  const state: TopicState = {
    sessionId: sessionID,
    topic,
    ...(summary ? { summary } : {}),
    entities: list(input.entities, list(previous?.entities, [], 'entities'), 'entities'),
    aliases: list(input.aliases, list(previous?.aliases, [], 'aliases'), 'aliases'),
    openLoops: list(input.openLoops, list(previous?.openLoops, [], 'openLoops'), 'openLoops'),
    retrievalKeys: list(input.retrievalKeys, list(previous?.retrievalKeys, [], 'retrievalKeys'), 'retrievalKeys'),
    ...(matterId ? { matterId } : {}),
    active,
    revision: currentRevision + 1,
    updatedAt: new Date().toISOString(),
  };
  const currentTraceId = db.currentTurn(sessionID)?.trace_id;
  if (currentTraceId) state.sourceTraceId = currentTraceId;

  db.kvSet(TOPIC_STATE_SCOPE, sessionID, state);
  return state;
}
