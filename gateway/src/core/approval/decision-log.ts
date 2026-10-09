// P1.5 approval decision log: records the policy verdict for each approval
// request and the human's later reply, keyed by requestId. Two line shapes
// (eval / reply) that a future classifier can join to learn from real
// decisions. Pure formatting + fail-open append; zero behavior change.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log } from '../utils/logger';

export type ApprovalLogRecord =
  | { e: 'eval'; requestId: string; sessionID: string; tool: string; patterns: string[]; action: string; mode?: string; reason?: string; ts: number }
  | { e: 'reply'; requestId: string; sessionID?: string; reply: string; ts: number };

export const APPROVAL_DECISIONS_FILE = (): string =>
  path.join(os.homedir(), '.mafw', 'logs', 'approval-decisions.jsonl');

const MAX_PATTERN = 200;

/** JSON line; patterns are truncated to keep the log compact. */
export function formatApprovalRecord(rec: ApprovalLogRecord): string {
  if (rec.e === 'eval') {
    return JSON.stringify({
      ...rec,
      patterns: (rec.patterns ?? []).slice(0, 8).map((p) => String(p).slice(0, MAX_PATTERN)),
    });
  }
  return JSON.stringify(rec);
}

/** Fail-open append (creates dirs; never throws into the approval path). */
export function appendApprovalRecord(
  rec: ApprovalLogRecord,
  file: string = APPROVAL_DECISIONS_FILE(),
): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, formatApprovalRecord(rec) + '\n', 'utf-8');
  } catch (err: any) {
    log.warn?.(`[ApprovalLog] append failed: ${err?.message || err}`);
  }
}
