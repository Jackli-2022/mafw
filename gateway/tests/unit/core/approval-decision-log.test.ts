import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatApprovalRecord, appendApprovalRecord } from '../../../src/core/approval/decision-log';

describe('formatApprovalRecord', () => {
  test('eval record keeps fields, truncates patterns to 8 and 200 chars', () => {
    const rec = {
      e: 'eval' as const, requestId: 'r1', sessionID: 's1', tool: 'bash',
      patterns: [...Array.from({ length: 10 }, (_, i) => `p${i}`), 'x'.repeat(300)],
      action: 'human', ts: 1,
    };
    const line = JSON.parse(formatApprovalRecord(rec));
    expect(line.patterns.length).toBe(8);
    expect(line.patterns[0]).toBe('p0');
    expect(line.action).toBe('human');
  });
  test('reply record passes through', () => {
    const line = JSON.parse(formatApprovalRecord({ e: 'reply', requestId: 'r1', reply: 'always', ts: 2 }));
    expect(line).toEqual({ e: 'reply', requestId: 'r1', reply: 'always', ts: 2 });
  });
});

describe('appendApprovalRecord', () => {
  test('appends one JSON line per record; never throws on a bad path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-log-'));
    const file = path.join(dir, 'approval-decisions.jsonl');
    appendApprovalRecord({ e: 'eval', requestId: 'r1', sessionID: 's1', tool: 'bash', patterns: ['rm *'], action: 'human', ts: 1 }, file);
    appendApprovalRecord({ e: 'reply', requestId: 'r1', reply: 'reject', ts: 2 }, file);
    const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).requestId).toBe('r1');
    expect(JSON.parse(lines[1]).reply).toBe('reject');
    expect(() => appendApprovalRecord({ e: 'reply', requestId: 'r2', reply: 'once', ts: 3 }, path.join(dir, 'nope', 'deep', 'x.jsonl'))).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
