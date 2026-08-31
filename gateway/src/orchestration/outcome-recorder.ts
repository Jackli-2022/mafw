import * as fs from 'fs';
import * as path from 'path';
import { GatewayDatabase, GoalOutcome } from '../memory/gateway-db';
import { getActivePolicy } from './policy';
import { log } from '../core/utils/logger';

export type GoalVerdict = 'PASS' | 'FAIL' | 'MAX_RETRIES' | 'ERROR' | 'CANCELLED';

export interface OutcomeInput {
  goalId: string;
  verdict: GoalVerdict;
  rounds: number;
  lastError?: string | null;
  reviewFeedback?: string | null;
  projectDir: string;
  mafwDir: string;
  projectId: string;
}

const EMPTY_TOKENS = { input: 0, output: 0 };

export function inferFailureKind(input: { verdict: string; lastError?: string | null }): string | null {
  if (input.verdict === 'PASS') return null;
  if (input.verdict === 'CANCELLED') return 'user_cancel';
  if (input.verdict === 'MAX_RETRIES') return 'max_retries';
  const err = (input.lastError || '').toLowerCase();
  if (err.includes('archive')) return 'archive_error';
  if (err.includes('waves.json') || err.includes('plan')) return 'bad_plan';
  if (err.includes('review report')) return 'review_false_fail';
  return 'exec_error';
}

export interface FailureSignatureInput {
  kind: string | null;
  errorText?: string | null;
  firstErrorTool?: string | null;
}

export function buildFailureSignature(input: FailureSignatureInput): string | null;
export function buildFailureSignature(kind: string | null, text?: string | null): string | null;
export function buildFailureSignature(
  inputOrKind: FailureSignatureInput | string | null,
  text?: string | null
): string | null {
  let kind: string | null;
  let errorText: string | null;
  let firstErrorTool: string | null;

  if (typeof inputOrKind === 'object' && inputOrKind !== null) {
    kind = inputOrKind.kind;
    errorText = inputOrKind.errorText ?? null;
    firstErrorTool = inputOrKind.firstErrorTool ?? null;
  } else {
    kind = inputOrKind;
    errorText = text ?? null;
    firstErrorTool = null;
  }

  if (!kind) return null;
  const raw = errorText || '';
  const norm = raw
    .replace(/[0-9a-f]{8,}/gi, '#')
    .replace(/\d+/g, 'N')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  
  // Extract tool name from error text when not explicitly provided
  let tool = firstErrorTool;
  if (!tool) {
    // Try to extract tool name from common error patterns
    const m = raw.match(/(?:tool\s+(\w+)|(?:error|failed|exception)\s+(?:in\s+)?(\w+)|(mafw_\w+)|\bexcept(?:ion)?\s+(?:in\s+)?(\w+))/i);
    const candidate = m ? (m[1] || m[2] || m[3] || m[4]).toLowerCase() : null;
    // Filter out common prepositions and articles
    const stopwords = new Set(['in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now']);
    tool = candidate && !stopwords.has(candidate) ? candidate : 'unknown';
  }
  const textPart = norm || 'no_details';
  
  return `${kind}:${tool}:${textPart}`;
}

function aggregateTrajectory(db: GatewayDatabase, sessionIds: string[]) {
  if (sessionIds.length === 0) return null;
  const rawDb = (db as any).db;
  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = rawDb.prepare(
    `SELECT tokens, cost, tool_error_count FROM trajectory_turns WHERE session_id IN (${placeholders})`
  ).all(...sessionIds) as any[];
  if (rows.length === 0) return null;
  let input = 0, output = 0, cost = 0, toolErrors = 0;
  for (const r of rows) {
    const t = r.tokens ? JSON.parse(r.tokens) : EMPTY_TOKENS;
    input += t.input || 0;
    output += t.output || 0;
    cost += r.cost || 0;
    toolErrors += r.tool_error_count || 0;
  }
  return { tokens_input: input, tokens_output: output, total_cost: cost, tool_error_count: toolErrors };
}

function aggregateFeedback(projectDir: string, goalId: string): { thumbs_up: number; thumbs_down: number } {
  let up = 0, down = 0;
  const dirs = ['.mafw/feedback', '.mafw/user-feedback'];
  const seen = new Set<string>();
  for (const d of dirs) {
    const dir = path.join(projectDir, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        if (data.goalId !== goalId) continue;
        const key = data.feedbackId || f;
        if (seen.has(key)) continue;
        seen.add(key);
        if (data.type === 'thumbs_up') up++;
        if (data.type === 'thumbs_down') down++;
      } catch { /* skip malformed */ }
    }
  }
  return { thumbs_up: up, thumbs_down: down };
}

function readRequestSnapshot(mafwDir: string, goalId: string): { createdAt?: string } {
  try {
    const p = path.join(mafwDir, 'requests', `${goalId}.json`);
    if (!fs.existsSync(p)) return {};
    const req = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return { createdAt: req.createdAt };
  } catch { return {}; }
}

function readStateFile(mafwDir: string, goalId: string): any {
  try {
    const p = path.join(mafwDir, 'state', `${goalId}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return null; }
}

function getFirstErrorTool(db: GatewayDatabase, sessionIds: string[]): string | null {
  if (sessionIds.length === 0) return null;
  const rawDb = (db as any).db;
  const placeholders = sessionIds.map(() => '?').join(',');
  const row = rawDb.prepare(
    `SELECT tool_name FROM trajectory_events 
     WHERE session_id IN (${placeholders}) AND error IS NOT NULL 
     ORDER BY turn_id ASC, seq ASC LIMIT 1`
  ).get(...sessionIds) as any;
  return row?.tool_name ?? null;
}

export function recordGoalOutcome(db: GatewayDatabase, input: OutcomeInput): void {
  try {
    const state = readStateFile(input.mafwDir, input.goalId);
    const snapshot = state?.policySnapshot ?? null;
    const policy = snapshot ?? getActivePolicy(input.mafwDir);
    const req = readRequestSnapshot(input.mafwDir, input.goalId);
    const createdAt = req.createdAt ?? null;
    const durationMs = createdAt ? Date.now() - new Date(createdAt).getTime() : null;
    const sessions = db.listGoalSessions(input.goalId);
    const sessionIds = sessions.map(s => s.session_id);
    const traj = aggregateTrajectory(db, sessionIds);
    const fb = aggregateFeedback(input.projectDir, input.goalId);
    const kind = inferFailureKind(input);
    const firstErrorTool = getFirstErrorTool(db, sessionIds);
    db.upsertGoalOutcome({
      goal_id: input.goalId,
      project_id: input.projectId,
      verdict: input.verdict,
      rounds: input.rounds,
      duration_ms: durationMs,
      tokens_input: traj?.tokens_input ?? null,
      tokens_output: traj?.tokens_output ?? null,
      total_cost: traj?.total_cost ?? null,
      tool_error_count: traj?.tool_error_count ?? null,
      thumbs_up: fb.thumbs_up,
      thumbs_down: fb.thumbs_down,
      policy_version: policy.version,
      evolution_proposal_id: policy.proposalId,
      failure_kind: kind,
      failure_signature: buildFailureSignature({
        kind,
        errorText: input.lastError ?? input.reviewFeedback,
        firstErrorTool,
      }),
      created_at: createdAt,
      archived_at: new Date().toISOString(),
    });
  } catch (err: any) {
    log.warn(`[Outcome] recordGoalOutcome failed (non-fatal): ${err.message}`);
  }
}
