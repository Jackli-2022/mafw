import {
  emptyDirectionState,
  normalizeDirectionDecision,
  normalizeDirectionOptions,
  parseDirectionArtifact,
  parseDirectionState,
  renderDirectionBlock,
  serializeDirectionArtifact,
  serializeDirectionState,
} from '../../../src/core/goal/direction-decision';

const NOW = '2026-11-02T00:00:00.000Z';
const LATER = '2026-11-02T00:10:00.000Z';

describe('normalizeDirectionOptions', () => {
  test('normalizes options and rejects duplicate ids', () => {
    const options = normalizeDirectionOptions([
      { id: ' A ', title: '方案 A', summary: ' 更稳 ', risks: [' 迁移成本 ', '迁移成本', ''] },
      { id: 'B', title: '方案 B' },
    ]);
    expect(options).toEqual([
      { id: 'A', title: '方案 A', summary: '更稳', risks: ['迁移成本'] },
      { id: 'B', title: '方案 B', summary: null, risks: [] },
    ]);

    expect(() => normalizeDirectionOptions([{ id: 'A', title: 'a' }, { id: 'A', title: 'b' }]))
      .toThrow('duplicate direction option id: A');
    expect(() => normalizeDirectionOptions([{ id: '', title: 'a' }]))
      .toThrow('direction option id is required');
    expect(() => normalizeDirectionOptions([{ id: 'A', title: '  ' }]))
      .toThrow('direction option title is required');
  });
});

describe('normalizeDirectionDecision', () => {
  test('preserves user words verbatim and snapshots the presented options', () => {
    const options = normalizeDirectionOptions([
      { id: 'A', title: '方案 A', summary: '沿用当前架构' },
      { id: 'B', title: '方案 B' },
    ]);
    const words = '  采用 A，禁止改并行架构\n第二行保持原样  ';
    const decision = normalizeDirectionDecision({
      userWords: words,
      optionId: ' A ',
      options,
      reason: ' 成本最低 ',
      revision: 2,
      source: 'user',
      decidedAt: NOW,
    });

    expect(decision.userWords).toBe(words);
    expect(decision.optionId).toBe('A');
    expect(decision.reason).toBe('成本最低');
    expect(decision.options).toEqual(options);
    expect(decision.revision).toBe(2);
    expect(decision.source).toBe('user');
    expect(decision.decidedAt).toBe(NOW);
  });

  test('requires user words or an option id', () => {
    expect(() => normalizeDirectionDecision({ userWords: '   ' }))
      .toThrow('direction decision requires user words or an option');
    expect(() => normalizeDirectionDecision({}))
      .toThrow('direction decision requires user words or an option');
  });

  test('rejects an option id that was not offered', () => {
    expect(() => normalizeDirectionDecision({
      userWords: '选 Z',
      optionId: 'Z',
      options: [{ id: 'A', title: '方案 A' }],
    })).toThrow('unknown direction option: Z');
  });

  test('defaults the source and derives a stable id when none is supplied', () => {
    const a = normalizeDirectionDecision({ userWords: '按方案 A', optionId: 'A' });
    const b = normalizeDirectionDecision({ userWords: '按方案 A', optionId: 'A' });
    const c = normalizeDirectionDecision({ userWords: '按方案 B' });

    expect(a.source).toBe('user');
    expect(a.id).toMatch(/^dirdec_/);
    expect(a.id).toBe(b.id);
    expect(c.id).not.toBe(a.id);
  });

  test('honours an explicit decision id (replay-safe input)', () => {
    const decision = normalizeDirectionDecision({ id: 'decision-1', userWords: '按方案 A' });
    expect(decision.id).toBe('decision-1');
  });

  test('rejects an invalid revision number', () => {
    expect(() => normalizeDirectionDecision({ userWords: '按方案 A', revision: 0 }))
      .toThrow('invalid direction decision revision: 0');
    expect(() => normalizeDirectionDecision({ userWords: '按方案 A', revision: 1.5 }))
      .toThrow('invalid direction decision revision: 1.5');
  });
});

describe('renderDirectionBlock', () => {
  test('renders the decision and keeps the user words verbatim', () => {
    const decision = normalizeDirectionDecision({
      userWords: '采用 A，禁止改并行架构',
      optionId: 'A',
      options: [{ id: 'A', title: '方案 A' }],
      reason: '成本最低',
      revision: 2,
      decidedAt: NOW,
    });

    const block = renderDirectionBlock([decision]);
    expect(block).toContain('[DIRECTION DECISIONS]');
    expect(block).toContain('采用 A，禁止改并行架构');
    expect(block).toContain('option: A');
    expect(block).toContain('revision: 2');
    expect(block).toContain('reason: 成本最低');
    expect(block).toBe(renderDirectionBlock([decision]));
  });

  test('brief contract: a decision without an option catalog still renders its user words', () => {
    const decision = normalizeDirectionDecision({ userWords: '采用 A，禁止改并行架构', optionId: 'A' });
    expect(renderDirectionBlock([decision])).toContain('采用 A，禁止改并行架构');
  });

  test('prefixes multi-line user words line by line', () => {
    const decision = normalizeDirectionDecision({
      userWords: '第一行\n第二行',
      decidedAt: NOW,
    });
    const block = renderDirectionBlock([decision]);
    expect(block).toContain('> 第一行\n> 第二行');
  });

  test('renders decisions in append order and renders nothing for no decisions', () => {
    const first = normalizeDirectionDecision({ userWords: '先这样', decidedAt: NOW });
    const second = normalizeDirectionDecision({ userWords: '再改成那样', decidedAt: LATER });
    const block = renderDirectionBlock([first, second]);
    expect(block.indexOf('先这样')).toBeLessThan(block.indexOf('再改成那样'));
    expect(renderDirectionBlock([])).toBe('');
  });
});

describe('direction state persistence helpers', () => {
  test('round-trips a per-revision state through JSON', () => {
    const decision = normalizeDirectionDecision({
      userWords: '采用 A，禁止改并行架构',
      optionId: 'A',
      revision: 2,
      decidedAt: NOW,
    });
    const state = {
      ...emptyDirectionState('g1', 2),
      status: 'decided' as const,
      options: normalizeDirectionOptions([{ id: 'A', title: '方案 A' }]),
      decisions: [decision],
      updatedAt: NOW,
    };

    expect(parseDirectionState(serializeDirectionState(state), 'g1', 2)).toEqual(state);
    expect(emptyDirectionState('g1', 2)).toEqual({
      version: 1,
      goalId: 'g1',
      revision: 2,
      status: 'none',
      options: [],
      requests: [],
      decisions: [],
      updatedAt: null,
    });
    expect(parseDirectionState(null, 'g1', 2)).toEqual(emptyDirectionState('g1', 2));
    expect(parseDirectionState('not json', 'g1', 2)).toEqual(emptyDirectionState('g1', 2));
  });

  test('round-trips an artifact with several revisions without touching older ones', () => {
    const rev1 = {
      ...emptyDirectionState('g1', 1),
      status: 'decided' as const,
      decisions: [normalizeDirectionDecision({ userWords: '旧方向', decidedAt: NOW })],
      updatedAt: NOW,
    };
    const rev2 = {
      ...emptyDirectionState('g1', 2),
      status: 'pending' as const,
      options: normalizeDirectionOptions([{ id: 'A', title: '方案 A' }]),
      updatedAt: LATER,
    };
    const artifact = { version: 1, goalId: 'g1', revisions: { '2': rev2, '1': rev1 } };

    const parsed = parseDirectionArtifact(serializeDirectionArtifact(artifact));
    expect(parsed.revisions['1']).toEqual(rev1);
    expect(parsed.revisions['2']).toEqual(rev2);
    expect(parseDirectionArtifact('not json')).toEqual({ version: 1, goalId: '', revisions: {} });
  });

  test('keeps coalesced decisions from old artifacts parseable', () => {
    const parsed = parseDirectionArtifact(JSON.stringify({
      version: 1,
      goalId: 'g1',
      revisions: {
        '1': {
          status: 'decided',
          decisions: [{ userWords: '历史决定', optionId: 'A' }],
        },
      },
    }));
    expect(parsed.revisions['1'].decisions[0]).toMatchObject({
      userWords: '历史决定',
      optionId: 'A',
      source: 'unknown',
    });
    expect(parsed.revisions['1'].decisions[0].id).toMatch(/^dirdec_/);
  });
});
