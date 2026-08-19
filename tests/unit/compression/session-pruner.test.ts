import { SessionPruner } from '../../../gateway/src/core/compression/session-pruner';

let pruner: SessionPruner;

beforeEach(() => {
  pruner = new SessionPruner({ maxContextTokens: 1000, compressionThreshold: 0.5, toolOutputReserve: 3 });
});

test('shouldPrune returns true at threshold', () => {
  expect(pruner.shouldPrune(499)).toBe(false);
  expect(pruner.shouldPrune(500)).toBe(true);
  expect(pruner.shouldPrune(1000)).toBe(true);
});

test('prune keeps current wave items uncompressed', () => {
  const session = [
    { type: 'task_definition', taskId: 't1', status: 'done', waveId: 'w2' },
    { type: 'dialogue', content: 'hello', waveId: 'w2' }
  ];
  const result = pruner.prune(session, 'w2', []);
  expect(result).toHaveLength(2);
  expect(result.every((r: any) => r.waveId === 'w2')).toBe(true);
  expect(result.some((r: any) => r._compressed)).toBe(false);
});

test('prune compresses completed wave items', () => {
  const session = [
    { type: 'task_definition', taskId: 't1', status: 'done', waveId: 'w1' },
    { type: 'code_edit', filePath: 'a.ts', linesChanged: 5, waveId: 'w1' },
    { type: 'tool_output', content: 'line1\nline2\nline3\nline4\nline5\nline6', waveId: 'w1' },
    { type: 'dialogue', content: 'hello', waveId: 'w1' },
    { type: 'test_log_success', content: 'pass', waveId: 'w1' },
    { type: 'test_log_fail', content: 'fail', waveId: 'w1' },
    { type: 'unknown_type', content: 'x', waveId: 'w1' }
  ];
  const result = pruner.prune(session, 'w2', []);

  const task = result.find((r: any) => r.type === 'task_definition');
  expect(task._compressed).toBe(true);

  const edit = result.find((r: any) => r.type === 'code_edit');
  expect(edit._compressed).toBe(true);

  const tool = result.find((r: any) => r.type === 'tool_output');
  expect(tool._compressed).toBe(true);
  expect(tool.content).toContain('[TRUNCATED:');

  expect(result.some((r: any) => r.type === 'dialogue')).toBe(false);

  const success = result.find((r: any) => r.type === 'test_log_success');
  expect(success.status).toBe('PASS');

  const fail = result.find((r: any) => r.type === 'test_log_fail');
  expect(fail.content).toBe('fail');

  const unknown = result.find((r: any) => r.type === 'unknown_type');
  expect(unknown.content).toBe('x');
});

test('prune prepends completed wave digests', () => {
  const session: any[] = [];
  const digests = [{
    id: 'w1', status: 'PASS' as const, domain: 'auth', tokens_saved: 100,
    completed_tasks: ['t1'], key_decisions: ['d1'], blockers: [], files_changed: ['a.ts'],
    metrics: {}
  }];
  const result = pruner.prune(session, 'w2', digests);
  expect(result[0].type).toBe('wave_digests');
  expect(result[0].content).toContain('w1');
});

test('prune handles empty session', () => {
  const result = pruner.prune([], 'w1', []);
  expect(result).toEqual([]);
});
