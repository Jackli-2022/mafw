import {
  computeEpisodeRanges,
  type EpisodeTurnInput,
} from '../../../src/recall/t1-episode-boundary';
import type { T1EpisodeBoundary } from '../../../src/recall/t1-episodes';

function turn(n: number, over: Partial<EpisodeTurnInput> = {}): EpisodeTurnInput {
  return {
    turnSeq: n,
    traceId: `t1t_${n}`,
    createdAt: n * 1000,
    isUserTurn: false,
    specificActors: [],
    conceptIds: [],
    entities: [],
    semanticAtoms: [],
    ...over,
  };
}

function boundary(afterTurn: number, reason: T1EpisodeBoundary['reason'] = 'agent_declared'): T1EpisodeBoundary {
  return { sessionId: 's1', afterTurn, source: 'agent', reason, createdAt: 1 };
}

function ranges(turns: EpisodeTurnInput[], over: Partial<Parameters<typeof computeEpisodeRanges>[0]> = {}) {
  return computeEpisodeRanges({
    sessionId: 's1',
    turns,
    boundaries: [],
    maxTurns: 30,
    idleCloseMs: 6 * 3600_000,
    now: 100 * 1000,
    ...over,
  });
}

describe('computeEpisodeRanges', () => {
  test('ignores a declaration that would create an empty first episode', () => {
    const out = ranges([turn(1, { isUserTurn: true }), turn(2)], {
      boundaries: [boundary(0)],
    });
    expect(out.map((r) => [r.startTurn, r.endTurn])).toEqual([[1, 2]]);
  });

  test('declared boundary cuts after the named turn', () => {
    const out = ranges(
      [turn(1, { isUserTurn: true }), turn(2), turn(3, { isUserTurn: true }), turn(4)],
      { boundaries: [boundary(2)] },
    );
    expect(out.map((r) => [r.startTurn, r.endTurn])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(out[0]).toMatchObject({ boundarySource: 'session_start', status: 'closed' });
    expect(out[1]).toMatchObject({ boundarySource: 'declared', boundaryReason: 'agent_declared' });
  });

  test('inferred boundaries only evaluate on user turns', () => {
    const out = ranges([
      turn(1, { isUserTurn: true, conceptIds: ['concept:a'] }),
      turn(2, { conceptIds: ['concept:b'] }),
      turn(3, { isUserTurn: true, conceptIds: ['concept:c'] }),
    ]);
    expect(out.map((r) => [r.startTurn, r.endTurn])).toEqual([
      [1, 2],
      [3, 3],
    ]);
    expect(out[1]).toMatchObject({ boundarySource: 'inferred', boundaryReason: 'topic_shift' });
  });

  test('actor shift uses specific actors, not the generic user', () => {
    const out = ranges([
      turn(1, { isUserTurn: true, specificActors: ['agent:reviewer'] }),
      turn(2),
      turn(3, { isUserTurn: true, specificActors: ['agent:builder'] }),
    ]);
    expect(out.map((r) => [r.startTurn, r.endTurn])).toEqual([
      [1, 2],
      [3, 3],
    ]);
    expect(out[1].boundaryReason).toBe('actor_shift');
  });

  test('topic profile is the episode union, not only the previous turn', () => {
    const out = ranges([
      turn(1, { isUserTurn: true, conceptIds: ['concept:a'] }),
      turn(2, { conceptIds: ['concept:b'] }),
      turn(3, { isUserTurn: true, conceptIds: ['concept:a'] }),
      turn(4, { isUserTurn: true, conceptIds: ['concept:c'] }),
    ]);
    expect(out.map((r) => [r.startTurn, r.endTurn])).toEqual([
      [1, 3],
      [4, 4],
    ]);
  });

  test('intent shift triggers only when actor/topic did not', () => {
    const out = ranges([
      turn(1, {
        isUserTurn: true,
        conceptIds: ['concept:shared'],
        semanticAtoms: ['parse'],
        intent: 'fix the parser regression',
      }),
      turn(2),
      turn(3, {
        isUserTurn: true,
        conceptIds: ['concept:shared'],
        semanticAtoms: ['deploy'],
        intent: 'deploy the gateway release',
      }),
    ]);
    expect(out.map((r) => [r.startTurn, r.endTurn])).toEqual([
      [1, 2],
      [3, 3],
    ]);
    expect(out[1].boundaryReason).toBe('intent_shift');
  });

  test('intent shift works for CJK intents', () => {
    const out = ranges([
      turn(1, {
        isUserTurn: true,
        conceptIds: ['concept:shared'],
        semanticAtoms: ['parse'],
        intent: '修复解析器',
      }),
      turn(2),
      turn(3, {
        isUserTurn: true,
        conceptIds: ['concept:shared'],
        semanticAtoms: ['deploy'],
        intent: '部署网关',
      }),
    ]);
    expect(out.map((r) => r.boundaryReason)).toContain('intent_shift');
  });

  test('max length closes the episode', () => {
    const turns = Array.from({ length: 4 }, (_, i) => turn(i + 1, { isUserTurn: true }));
    const out = ranges(turns, { maxTurns: 2 });
    expect(out.map((r) => [r.startTurn, r.endTurn])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(out[1].boundarySource).toBe('max_length');
  });

  test('idle tail closes as session_end/idle_timeout', () => {
    const out = ranges([turn(1, { isUserTurn: true, createdAt: 1 })], {
      now: 7 * 3600_000,
    });
    expect(out[0]).toMatchObject({
      status: 'closed',
      boundarySource: 'session_end',
      boundaryReason: 'idle_timeout',
    });
  });

  test('session deletion closes every open episode', () => {
    const out = ranges(
      [turn(1, { isUserTurn: true }), turn(2), turn(3, { isUserTurn: true }), turn(4)],
      { boundaries: [boundary(2)], sessionDeleted: true },
    );
    expect(out.every((r) => r.status === 'closed')).toBe(true);
    expect(out[1]).toMatchObject({
      status: 'closed',
      boundarySource: 'session_end',
      boundaryReason: 'session_deleted',
    });
  });

  test('empty input returns no ranges', () => {
    expect(ranges([])).toEqual([]);
  });
});
