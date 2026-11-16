import { extractTurnFeature } from '../../../src/recall/t1-features';
import type { T1Observation } from '../../../src/memory/gateway-db';

function obs(source: T1Observation['source'], content: string, id = 1): T1Observation {
  return {
    id,
    session_id: 's1',
    turn_id: 1,
    trace_id: 't1t_a',
    observation_key: `o${id}`,
    source,
    content,
    failure: 0,
    created_at: id,
  };
}

const turn = { traceId: 't1t_a', sessionId: 's1', turnSeq: 1 };

describe('extractTurnFeature', () => {
  test('extracts intent, action, error, decision and entities', () => {
    const feature = extractTurnFeature(turn, [
      obs('user_input', '修一下 reflection，为什么一直 unparseable', 1),
      obs('tool_result', 'read reflection.ts\nconst x = parseInsights(text)', 2),
      obs('tool_result', 'grep parseInsights -> gateway/src/recall/reflection.ts', 3),
      obs('assistant_reply', '根因是 system prompt 丢失；决定 adapter 前置 system。', 4),
    ]);

    expect(feature).not.toBeNull();
    expect(feature!.intent).toContain('修一下 reflection');
    expect(feature!.action).toContain('reflection.ts');
    expect(feature!.tool).toContain('read');
    expect(feature!.target).toContain('reflection.ts');
    expect(feature!.error).toContain('unparseable');
    expect(feature!.decision).toContain('adapter 前置 system');
    expect(feature!.entities).toEqual(expect.arrayContaining(['reflection.ts', 'parseInsights']));
    expect(feature!.outcome).toBe('unknown');
    expect(feature!.confidence).toBeGreaterThan(0.5);
  });

  test('returns null for an empty turn', () => {
    expect(extractTurnFeature(turn, [])).toBeNull();
  });

  test('a partial turn has no intent and lower confidence', () => {
    const feature = extractTurnFeature(turn, [
      obs('tool_result', 'read package.json', 1),
      obs('assistant_reply', 'done', 2),
    ]);
    expect(feature).not.toBeNull();
    expect(feature!.intent).toBeUndefined();
    expect(feature!.confidence).toBeLessThanOrEqual(0.5);
  });

  test('truncates long fields', () => {
    const feature = extractTurnFeature(turn, [
      obs('user_input', 'x'.repeat(1000), 1),
      obs('assistant_reply', 'y'.repeat(1000), 2),
    ]);
    expect(feature!.intent!.length).toBeLessThanOrEqual(200);
    expect(feature!.result!.length).toBeLessThanOrEqual(200);
  });

  test('recognizes CJK errors and decisions', () => {
    const feature = extractTurnFeature(turn, [
      obs('user_input', '为什么失败', 1),
      obs('tool_result', '错误：连接超时', 2),
      obs('assistant_reply', '决定改用本地 embedding。', 3),
    ]);
    expect(feature!.error).toContain('超时');
    expect(feature!.decision).toContain('改用本地 embedding');
  });

  test('dedupes entities', () => {
    const feature = extractTurnFeature(turn, [
      obs('user_input', 'reflection.ts reflection.ts', 1),
      obs('tool_result', 'read reflection.ts', 2),
    ]);
    expect(feature!.entities.filter((e) => e === 'reflection.ts')).toHaveLength(1);
  });
});
