// Deterministic actor / role extraction for one T1 turn.
//
// This is the "who took part" half of the sparse episode code: a user asked,
// an agent answered, a subagent reviewed, a tool was used. It is derived and
// rebuildable — raw T1 stays the source of truth.
//
// Actors come from two places:
//   1. T1 rows (a user row implies the requester), and
//   2. trajectory_events for the same (session_id, turn_id): agent / tool_name.
//
// No LLM and no embeddings: canonical IDs win over clustering, and an unknown
// agent keeps its own ID instead of being folded into a guessed role.
import type { T1Observation, T1Turn } from '../memory/gateway-db';

export type T1ActorKind = 'user' | 'agent' | 'tool' | 'service' | 'project' | 'person';

export type T1ActorRole =
  | 'requester' // the human asking
  | 'subject' // generic participant (agent)
  | 'object' // acted upon
  | 'instrument' // tool / service used
  | 'reviewer'
  | 'builder'
  | 'context';

export interface T1TurnActor {
  traceId: string;
  actorId: string;
  role: T1ActorRole;
  weight: number;
}

/** Minimal trajectory event shape needed for actor extraction. */
export interface T1ActorEvent {
  toolName?: string;
  agent?: string;
  model?: string;
}

export interface T1ActorExtractOptions {
  projectId?: string;
  /** Canonical human actor for this single-customer install. */
  userActorId?: string;
}

interface AgentRule {
  re: RegExp;
  actorId: string;
  role: T1ActorRole;
}

/**
 * Agent names are the only place a role is stated explicitly. Rules are
 * intentionally narrow: `build` (opencode's main agent) must not become
 * `agent:builder`; only an actual reviewer/builder name does.
 */
const AGENT_RULES: AgentRule[] = [
  { re: /\breview(?:er)?\b/i, actorId: 'agent:reviewer', role: 'reviewer' },
  { re: /\bbuilder\b/i, actorId: 'agent:builder', role: 'builder' },
  { re: /\btech[\s_-]?lead\b/i, actorId: 'agent:tech-lead', role: 'subject' },
  { re: /\bmemory[\s_-]?curator\b|\breflect\b/i, actorId: 'agent:memory-curator', role: 'subject' },
  { re: /\bprobe\b/i, actorId: 'agent:probe', role: 'subject' },
];

const TOOL_NAMES = [
  'read',
  'grep',
  'glob',
  'edit',
  'write',
  'multiedit',
  'patch',
  'shell',
  'bash',
  'node',
  'python',
  'webfetch',
  'task',
  'mafw_add_memory',
  'mafw_search_hybrid',
  'mafw_get_memory',
  'mafw_media_ask',
  'mafw_python',
];

/** Canonicalize the prefix (lowercase) while keeping the body readable. */
export function normalizeActorId(raw: string): string {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return '';
  const [prefix, ...rest] = value.split(':');
  const body = rest.join(':').replace(/\s+/g, '-');
  if (!prefix || !body) return '';
  return `${prefix}:${body}`;
}

export function actorKind(actorId: string): T1ActorKind {
  const prefix = String(actorId ?? '').split(':')[0];
  return prefix === 'user' ||
    prefix === 'agent' ||
    prefix === 'tool' ||
    prefix === 'service' ||
    prefix === 'project' ||
    prefix === 'person'
    ? prefix
    : 'agent';
}

function roleForAgent(agent: string): { actorId: string; role: T1ActorRole } {
  const name = String(agent ?? '').trim();
  const rule = AGENT_RULES.find((r) => r.re.test(name));
  return rule
    ? { actorId: rule.actorId, role: rule.role }
    : { actorId: `agent:${name}`, role: 'subject' };
}

/**
 * Extract the turn's participants. A user row → `user:local` requester.
 * trajectory agents → canonical role actors (or `agent:<name>` as subject).
 * trajectory tools → `tool:<name>` instrument. An optional project ID is a
 * context actor, not a subject.
 */
export function extractTurnActors(
  turn: Pick<T1Turn, 'trace_id' | 'session_id' | 'turn_seq'>,
  rows: Array<Pick<T1Observation, 'source'>>,
  events: T1ActorEvent[] = [],
  opts: T1ActorExtractOptions = {},
): T1TurnActor[] {
  const collected = new Map<string, T1TurnActor>();
  const add = (rawId: string, role: T1ActorRole, weight: number) => {
    const actorId = normalizeActorId(rawId);
    if (!actorId || !Number.isFinite(weight) || weight <= 0) return;
    const key = `${actorId}\u0000${role}`;
    const prev = collected.get(key);
    if (prev && prev.weight >= weight) return;
    collected.set(key, { traceId: turn.trace_id, actorId, role, weight });
  };

  if (rows.some((r) => r.source === 'user_input')) {
    add(opts.userActorId ?? 'user:local', 'requester', 1);
  }

  for (const event of events) {
    if (event.agent) {
      const mapped = roleForAgent(event.agent);
      add(mapped.actorId, mapped.role, 1);
    }
    if (event.toolName) {
      add(`tool:${event.toolName}`, 'instrument', 0.8);
    }
  }

  if (opts.projectId) add(`project:${opts.projectId}`, 'context', 0.5);

  return [...collected.values()].sort(
    (a, b) => b.weight - a.weight || a.actorId.localeCompare(b.actorId),
  );
}

/**
 * Parse actors out of a natural-language query. Explicit `agent:` / `tool:` /
 * `user:` tokens win; role words and known tool names are matched with word
 * boundaries. Generic words such as "user" are NOT treated as actors — too
 * many queries mention "user input" without asking about a participant.
 */
export function parseActorQuery(query: string): string[] {
  const text = String(query ?? '').toLowerCase();
  if (!text.trim()) return [];
  const ids = new Set<string>();

  for (const m of text.matchAll(/\b(agent|tool|user|service|project|person):([a-z0-9_.\-]+)/g)) {
    ids.add(`${m[1]}:${m[2]}`);
  }

  const queryRules: AgentRule[] = [
    { re: /\breview(?:er)?\b|评审|审查/i, actorId: 'agent:reviewer', role: 'reviewer' },
    { re: /\bbuilder\b|构建者/i, actorId: 'agent:builder', role: 'builder' },
    { re: /\btech[\s_-]?lead\b|技术负责人/i, actorId: 'agent:tech-lead', role: 'subject' },
    { re: /\bmemory[\s_-]?curator\b|记忆管家/i, actorId: 'agent:memory-curator', role: 'subject' },
    { re: /\bprobe\b|探针/i, actorId: 'agent:probe', role: 'subject' },
  ];  for (const rule of queryRules) {
    if (rule.re.test(text)) ids.add(rule.actorId);
  }

  for (const tool of TOOL_NAMES) {
    const re = new RegExp(`(^|[^a-z0-9_])${tool}([^a-z0-9_]|$)`);
    if (re.test(text)) ids.add(`tool:${tool}`);
  }

  return [...ids];
}
