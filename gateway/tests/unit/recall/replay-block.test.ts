import { buildReplayBlock, type TimelineTurn } from '../../../src/recall/replay-block';

function turn(seq: number, feature: Partial<TimelineTurn['feature']> = {}, summary = `turn ${seq}`): TimelineTurn {
  return {
    traceId: `t1t_${seq}`,
    sessionId: 's1',
    turnSeq: seq,
    createdAt: seq,
    archived: false,
    summary,
    rows: [],
    feature: feature
      ? {
          traceId: `t1t_${seq}`,
          sessionId: 's1',
          turnSeq: seq,
          entities: [],
          outcome: 'unknown',
          confidence: 0.7,
          ...feature,
        }
      : null,
  };
}

describe('buildReplayBlock', () => {
  test('renders feature fields in forward order', () => {
    const block = buildReplayBlock(
      [
        turn(1, { intent: 'fix reflection', error: 'unparseable' }),
        turn(2, { intent: 'check coverage', decision: 'backfill' }),
      ],
      { mode: 'forward', maxChars: 2000, perTurnChars: 400 },
    );
    expect(block.block).toContain('[trace:t1t_1][INTENT] fix reflection');
    expect(block.block).toContain('[trace:t1t_1][ERROR] unparseable');
    expect(block.block.indexOf('t1t_1')).toBeLessThan(block.block.indexOf('t1t_2'));
    expect(block.usedTraceIds).toEqual(['t1t_1', 't1t_2']);
    expect(block.truncated).toBe(false);
  });

  test('reverse mode reverses the turn order', () => {
    const block = buildReplayBlock([turn(1), turn(2), turn(3)], {
      mode: 'reverse',
      maxChars: 2000,
      perTurnChars: 400,
    });
    expect(block.block.indexOf('t1t_3')).toBeLessThan(block.block.indexOf('t1t_1'));
  });

  test('interleaved mode alternates from both ends', () => {
    const block = buildReplayBlock([turn(1), turn(2), turn(3)], {
      mode: 'interleaved',
      maxChars: 2000,
      perTurnChars: 400,
    });
    expect(block.block.indexOf('t1t_1')).toBeLessThan(block.block.indexOf('t1t_2'));
    expect(block.block.indexOf('t1t_3')).toBeLessThan(block.block.indexOf('t1t_2'));
  });

  test('falls back to the summary when no feature exists', () => {
    const block = buildReplayBlock([turn(1, null as any, 'raw summary')], {
      mode: 'forward',
      maxChars: 500,
      perTurnChars: 400,
    });
    expect(block.block).toContain('[trace:t1t_1][TURN] raw summary');
  });

  test('truncates at the budget', () => {
    const block = buildReplayBlock(
      Array.from({ length: 10 }, (_, i) => turn(i + 1, { intent: 'x'.repeat(100) })),
      { mode: 'forward', maxChars: 220, perTurnChars: 100 },
    );
    expect(block.truncated).toBe(true);
    expect(block.chars).toBeLessThanOrEqual(220);
    expect(block.usedTraceIds.length).toBeGreaterThan(0);
    expect(block.usedTraceIds.length).toBeLessThan(10);
  });

  test('empty input returns an empty block', () => {
    expect(buildReplayBlock([], { mode: 'forward', maxChars: 500, perTurnChars: 100 })).toEqual({
      block: '',
      chars: 0,
      usedTraceIds: [],
      truncated: false,
    });
  });
});
