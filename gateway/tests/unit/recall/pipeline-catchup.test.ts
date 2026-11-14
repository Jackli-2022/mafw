import {
  MEMORY_PIPELINE_RULES,
  findMissedPipelineRuns,
} from '../../../src/recall/pipeline-rules';

const RULES = MEMORY_PIPELINE_RULES.map((r) => ({
  id: r.id,
  action: r.action,
  schedule: r.schedule,
  timezone: r.timezone,
}));

function records(map: Record<string, string | undefined>) {
  return (action: string) => (map[action] ? { lastRunAt: map[action] } : null);
}

describe('findMissedPipelineRuns', () => {
  test('a daily pipeline whose 03:00 UTC occurrence passed while offline is due', () => {
    const due = findMissedPipelineRuns(
      RULES,
      records({ 'memory:reflect': '2026-11-13T02:00:00.000Z' }),
      Date.parse('2026-11-14T04:00:00.000Z'),
    );
    expect(due.map((r) => r.id)).toContain('memory-reflect');
  });

  test('a daily pipeline that already ran at the scheduled time is not due', () => {
    const due = findMissedPipelineRuns(
      RULES,
      records({ 'memory:reflect': '2026-11-14T03:00:06.000Z' }),
      Date.parse('2026-11-14T04:00:00.000Z'),
    );
    expect(due.map((r) => r.id)).not.toContain('memory-reflect');
  });

  test('a weekly pipeline that has not run for weeks is due once', () => {
    const due = findMissedPipelineRuns(
      RULES,
      records({ 'memory:review': '2026-10-25T04:00:01.000Z' }),
      Date.parse('2026-11-14T12:00:00.000Z'),
    );
    expect(due.map((r) => r.id)).toContain('memory-review');
  });

  test('a weekly pipeline that ran last Sunday is not due before next Sunday', () => {
    const due = findMissedPipelineRuns(
      RULES,
      records({ 'memory:review': '2026-11-08T04:00:06.000Z' }),
      Date.parse('2026-11-14T12:00:00.000Z'),
    );
    expect(due.map((r) => r.id)).not.toContain('memory-review');
  });

  test('a pipeline that never ran is not auto-started on boot', () => {
    const due = findMissedPipelineRuns(RULES, records({}), Date.parse('2026-11-14T12:00:00.000Z'));
    expect(due).toEqual([]);
  });

  test('an invalid record timestamp is ignored instead of crashing startup', () => {
    const due = findMissedPipelineRuns(
      RULES,
      records({ 'memory:reflect': 'not-a-date' }),
      Date.parse('2026-11-14T12:00:00.000Z'),
    );
    expect(due).toEqual([]);
  });

  test('rules without a matching memory pipeline action are not selected', () => {
    const due = findMissedPipelineRuns(
      [{ id: 'other', action: 'custom:thing', schedule: '0 3 * * *', timezone: 'UTC' }],
      records({ 'custom:thing': '2026-11-13T02:00:00.000Z' }),
      Date.parse('2026-11-14T04:00:00.000Z'),
    );
    expect(due).toEqual([]);
  });
});
