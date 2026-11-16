// Deterministic sparse event code for one T1 turn.
//
// This is a derived, rebuildable index — never a replacement for the immutable
// T1 observations. It gives replay a compact state sequence (intent/action/
// error/decision/entities) without dumping the full transcript into the prompt.
// No LLM calls: fast, deterministic, fail-open at the caller.
import type { T1Observation, T1Turn, T1TurnFeature } from '../memory/gateway-db';

const MAX_FIELD = 200;
const MAX_ACTION = 240;
const MAX_ENTITIES = 20;

const PATH_RE =
  /(?:[A-Za-z]:\\[^\s"'`]+|(?:\.{0,2}\/)?(?:[\w.@-]+\/)+[\w.@-]+|[\w.@-]+\.(?:ts|tsx|js|jsx|json|md|py|yaml|yml|sql|css|html|toml|sh))/g;
const IDENT_RE =
  /`([^`]{2,80})`|\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+|[a-z]+[A-Z][A-Za-z0-9]+)\b|\b([A-Z][A-Z0-9_]{3,})\b/g;
const TOOL_RE =
  /\b(read|grep|glob|edit|write|shell|bash|npm|git|node|python|webfetch|task|patch|multiedit)\b/gi;
const ERROR_RE =
  /\b(error|failed|failure|timeout|timed out|exception|econn\w*|unparseable|denied|refused|reset|enoent)\b|错误|失败|超时|异常|拒绝|未找到/i;
const DECISION_RE =
  /\b(use|switch|adopt|fix|should|must|don't|do not|instead|change|keep|avoid|prefer)\b|决定|改用|不要|应当|必须|修复|切换|保留|避免|优先/i;

function clean(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function cap(text: string, max = MAX_FIELD): string {
  const value = clean(text);
  return value.length > max ? value.slice(0, max) : value;
}

function firstSentence(text: string): string {
  const value = clean(text);
  const match = value.match(/^.*?[.!?。！？](?:\s|$)/);
  return cap(match ? match[0] : value);
}

function segments(text: string): string[] {
  return clean(text)
    .split(/[.!?。！？；;]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniq(values: string[], max = MAX_ENTITIES): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = clean(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function pathsIn(text: string): string[] {
  return Array.from(text.matchAll(PATH_RE)).map((m) => m[0]);
}

function identifiersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(IDENT_RE)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}

/**
 * Extract the compact event code for one turn. Returns null when the turn has
 * no observations (nothing to replay). Every failure mode at the caller should
 * fall back to the raw T1 turn.
 */
export function extractTurnFeature(
  turn: Pick<T1Turn, 'trace_id' | 'session_id' | 'turn_seq'>,
  rows: T1Observation[],
): T1TurnFeature | null {
  if (!rows || rows.length === 0) return null;

  const userRows = rows.filter((r) => r.source === 'user_input');
  const toolRows = rows.filter((r) => r.source === 'tool_result');
  const assistantRows = rows.filter((r) => r.source === 'assistant_reply');

  const intent = userRows.length > 0 ? firstSentence(userRows[0].content) : undefined;
  const actionParts = toolRows
    .slice(0, 3)
    .map((r) => cap(r.content, 80))
    .filter(Boolean);
  const action = actionParts.length > 0 ? cap(actionParts.join('; '), MAX_ACTION) : undefined;

  const tools = uniq(
    toolRows.flatMap((r) => Array.from(r.content.matchAll(TOOL_RE)).map((m) => m[1].toLowerCase())),
    8,
  );
  const tool = tools.length > 0 ? tools.join(',') : undefined;

  const allText = rows.map((r) => r.content).join('\n');
  const target = uniq(pathsIn(allText)).join(',') || undefined;

  const resultRow = assistantRows[assistantRows.length - 1];
  const result = resultRow ? cap(resultRow.content, MAX_FIELD) : undefined;

  // Prefer tool/assistant rows for the error field: a user's "why did it fail"
  // question should not shadow the actual failure output.
  const errorRow = [...toolRows, ...assistantRows, ...userRows].find((r) => ERROR_RE.test(r.content))
    ?? rows.find((r) => ERROR_RE.test(r.content));
  const error = errorRow ? cap(errorRow.content, MAX_FIELD) : undefined;

  let decision: string | undefined;
  for (const row of assistantRows) {
    const hit = segments(row.content).find((part) => DECISION_RE.test(part));
    if (hit) {
      decision = cap(hit, MAX_FIELD);
      break;
    }
  }

  const entities = uniq([...pathsIn(allText), ...identifiersIn(allText)]);

  let confidence = 0.35;
  if (userRows.length > 0) confidence += 0.2;
  if (toolRows.length > 0) confidence += 0.1;
  if (error || decision) confidence += 0.1;
  if (assistantRows.length > 0) confidence += 0.05;
  confidence = Math.max(0.3, Math.min(0.9, confidence));

  return {
    traceId: turn.trace_id,
    sessionId: turn.session_id,
    turnSeq: turn.turn_seq,
    intent,
    action,
    tool,
    target,
    result,
    error,
    decision,
    entities,
    outcome: 'unknown',
    confidence,
  };
}

export interface T1FeatureBackfillDeps {
  listTurnsMissingFeatures(limit: number): T1Turn[];
  readTurnRows(sessionId: string, turnSeq: number): T1Observation[];
  upsertTurnFeature(feature: T1TurnFeature): void;
}

export interface T1FeatureBackfillResult {
  scanned: number;
  written: number;
  skipped: number;
  failed: number;
}

/**
 * Bounded backfill for existing T1 turns. One call processes at most `limit`
 * turns; the caller can repeat until `scanned === 0`. Turns with no rows are
 * excluded by listTurnsMissingFeatures, so a no-progress loop is impossible.
 */
export function backfillT1Features(
  deps: T1FeatureBackfillDeps,
  opts: { limit?: number } = {},
): T1FeatureBackfillResult {
  const result: T1FeatureBackfillResult = { scanned: 0, written: 0, skipped: 0, failed: 0 };
  const limit = Math.max(0, Math.trunc(opts.limit ?? 500));
  if (limit === 0) return result;

  const turns = deps.listTurnsMissingFeatures(limit);
  for (const turn of turns) {
    result.scanned++;
    try {
      const rows = deps.readTurnRows(turn.session_id, turn.turn_seq);
      const feature = extractTurnFeature(turn, rows);
      if (!feature) {
        result.skipped++;
        continue;
      }
      deps.upsertTurnFeature(feature);
      result.written++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
