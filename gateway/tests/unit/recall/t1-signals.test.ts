import {
  computeTurnSignals,
  isInformativeTurn,
  normalizeObservationText,
  scoreTurnSignals,
} from '../../../src/recall/t1-signals';

const units: Record<string, any> = {
  m1: { createdAt: '2026-01-01T00:00:00.000Z', type: 'semantic' },
};

function deps(cosByText: Record<string, number>) {
  return {
    // content and cue texts are distinct strings, each maps to a marker vector.
    embedder: { embed: async (texts: string[]) => texts.map((t) => [t.length, t.charCodeAt(0)]) },
    vectors: {
      searchByCosine: (q: number[]) => {
        const text = Object.keys(cosByText).find((t) => t.length === q[0] && t.charCodeAt(0) === q[1]);
        if (!text) return [];
        const cos = cosByText[text];
        return cos == null ? [] : [{ id: 'm1', cosine: cos }];
      },
    },
    unitFor: (id: string) => units[id],
  };
}

const BODY =
  'a long enough turn body that passes the informative gate and carries enough detail about reflection boundary recall behavior';

const input = (over: Record<string, unknown> = {}) => ({
  traceId: 't1t_a',
  text: BODY,
  cue: 'fix reflection',
  lastTs: Date.parse('2026-02-01T00:00:00.000Z') / 1000,
  anchorCount: 2,
  ...over,
});

describe('t1 signals', () => {
  test('paraphrase of a known memory is low novelty and low mismatch', async () => {
    const map = await computeTurnSignals(
      [input()],
      deps({
        'a long enough turn body that passes the informative gate and carries enough detail about reflection boundary recall behavior': 0.95,
        'fix reflection': 0.9,
      }),
    );
    expect(map.get('t1t_a')!.novelty).toBeCloseTo(0.05);
    expect(map.get('t1t_a')!.mismatch).toBe(0);
  });

  test('familiar cue with unfamiliar body is a mismatch', async () => {
    const map = await computeTurnSignals(
      [input()],
      deps({
        [BODY]: 0.4,
        'fix reflection': 0.9,
      }),
    );
    expect(map.get('t1t_a')!.novelty).toBeCloseTo(0.6);
    expect(map.get('t1t_a')!.mismatch).toBeCloseTo(0.5);
  });

  test('unrelated content is novel but not mismatched', async () => {
    const map = await computeTurnSignals(
      [input()],
      deps({
        [BODY]: 0.1,
        'fix reflection': 0.05,
      }),
    );
    expect(map.get('t1t_a')!.novelty).toBeCloseTo(0.9);
    expect(map.get('t1t_a')!.mismatch).toBe(0);
  });

  test('short turns with no anchors are not scored', async () => {
    const map = await computeTurnSignals([input({ text: '可以', cue: '', anchorCount: 0 })], deps({}));
    expect(map.size).toBe(0);
    expect(isInformativeTurn('可以', 0)).toBe(false);
  });

  test('superseded units are ignored', async () => {
    units.m1 = { ...units.m1, supersededBy: 'm2' };
    const map = await computeTurnSignals(
      [input()],
      deps({ [BODY]: 0.99 }),
    );
    expect(map.has('t1t_a')).toBe(false);
    units.m1 = { createdAt: '2026-01-01T00:00:00.000Z', type: 'semantic' };
  });

  test('memories created after the turn are ignored', async () => {
    units.m1 = { ...units.m1, createdAt: '2027-01-01T00:00:00.000Z' };
    const map = await computeTurnSignals(
      [input()],
      deps({ [BODY]: 0.99 }),
    );
    expect(map.has('t1t_a')).toBe(false);
    units.m1 = { createdAt: '2026-01-01T00:00:00.000Z', type: 'semantic' };
  });

  test('an empty memory pool yields no score, not novelty 1', async () => {
    const d = deps({});
    d.vectors.searchByCosine = () => [];
    const map = await computeTurnSignals([input()], d);
    expect(map.size).toBe(0);
  });

  test('legacy episodic units are ignored', async () => {
    units.m1 = { createdAt: '2026-01-01T00:00:00.000Z', type: 'episodic' };
    const map = await computeTurnSignals(
      [input()],
      deps({ [BODY]: 0.99 }),
    );
    expect(map.has('t1t_a')).toBe(false);
    units.m1 = { createdAt: '2026-01-01T00:00:00.000Z', type: 'semantic' };
  });

  test('embedder failure yields an empty map, not an exception', async () => {
    const d = deps({});
    d.embedder.embed = async () => {
      throw new Error('embed down');
    };
    await expect(computeTurnSignals([input()], d)).resolves.toEqual(new Map());
  });

  test('scoring clamps to [0,1] and never returns negative mismatch', () => {
    expect(scoreTurnSignals(0.4, 0.2)!.mismatch).toBe(0);
    expect(scoreTurnSignals(1.2, 0.5)!.novelty).toBe(0);
    expect(scoreTurnSignals(-0.3, 0.2)!.novelty).toBe(1);
    expect(scoreTurnSignals(null, 0.5)).toBeNull();
  });

  test('non-string observation content is serialized, not "[object Object]"', () => {
    expect(
      normalizeObservationText([{ content: 'plain' }, { content: { tool: 'read' } }]),
    ).toBe('plain\n{"tool":"read"}');
  });

  test('agent system prompts are not scored', async () => {
    const long = 'You are a subagent spawned by another session. ' + 'x'.repeat(200);
    expect(isInformativeTurn(long, 3)).toBe(false);
    expect(isInformativeTurn('[MAFW SYSTEM] gateway updated', 1)).toBe(false);
    // A user turn that merely starts with "you are asking" still scores.
    expect(isInformativeTurn('You are asking about a ' + 'x'.repeat(150), 0)).toBe(true);
    const map = await computeTurnSignals(
      [input({ text: long, cue: 'You are a subagent spawned by another session.' })],
      deps({}),
    );
    expect(map.size).toBe(0);
  });

  test('short anchored turns get novelty but no mismatch', async () => {
    const short = input({ text: '继续', cue: '继续 gateway', anchorCount: 2 });
    const map = await computeTurnSignals([short], deps({ 继续: 0.9, '继续 gateway': 0.95 }));
    expect(map.get('t1t_a')!.novelty).toBeCloseTo(0.1);
    expect(map.get('t1t_a')!.mismatch).toBe(0);
  });

  test('the "[object Object]" ingestion artifact is not scored', () => {
    expect(isInformativeTurn('[object Object]', 3)).toBe(false);
  });
});
