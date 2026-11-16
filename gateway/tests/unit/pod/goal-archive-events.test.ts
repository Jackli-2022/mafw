import { archiveDomainEvent } from '../../../src/core/goal/goal-archive-events';

test('PASS and UNREVIEWED produce goal.result', () => {
  for (const verdict of ['PASS', 'UNREVIEWED']) {
    const e = archiveDomainEvent({
      goalId: 'g1', revision: 1, verdict, status: 'done', projectDir: '/p',
      occurredAt: '2026-11-16T00:00:00.000Z',
    });
    expect(e.type).toBe('goal.result');
    expect(e.audience).toBe('human');
    expect(e.payload).toMatchObject({ verdict });
  }
});

test('FAIL, MAX_RETRIES, ERROR and CANCELLED produce goal.failed', () => {
  for (const verdict of ['FAIL', 'MAX_RETRIES', 'ERROR', 'CANCELLED']) {
    const status = verdict === 'CANCELLED' ? 'aborted' : 'done';
    const e = archiveDomainEvent({
      goalId: 'g1', revision: 1, verdict, status, projectDir: '/p',
      occurredAt: '2026-11-16T00:00:00.000Z',
    });
    expect(e.type).toBe('goal.failed');
    expect(e.payload).toMatchObject({ verdict, status });
  }
});

test('carries lastError and projectDir in the payload', () => {
  const e = archiveDomainEvent({
    goalId: 'g1', revision: 2, verdict: 'ERROR', status: 'done',
    lastError: 'worktree failed', projectDir: '/p',
    occurredAt: '2026-11-16T00:00:00.000Z',
  });
  expect(e.payload).toMatchObject({ lastError: 'worktree failed', projectDir: '/p', revision: 2 });
});
