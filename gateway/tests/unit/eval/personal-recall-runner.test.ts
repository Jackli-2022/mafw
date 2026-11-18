/**
 * Task 1 — personal-recall evaluation runner contract.
 *
 * These tests pin the runner's *measurement* semantics before the runner
 * exists: REST hit@1/3, `#mem-xxxxxx` pointer matching by the last 6 id
 * chars, negative false injection, must_exclude stale injection, and the
 * note-board exclusion rule (note-board is must-surface, NOT related recall).
 *
 * The real fixture is validated here too: 40 entries, exactly 10 per
 * category, no duplicate ids, no unknown ids, and no empty must_include
 * outside negative / explicitly-marked no-answer implicit cases.
 */
import * as fs from 'fs';
import * as path from 'path';

const runner = require('../../../../evaluation/personal-recall/run.js');

interface Entry {
  id: string;
  category: 'current-state' | 'exact' | 'implicit' | 'negative';
  query: string;
  sessionID?: string;
  must_include: string[];
  must_exclude: string[];
  note: string;
}

interface MockRoute {
  rest?: Record<string, string[]>;
  auto?: Record<string, string>;
  get?: Record<string, any>;
}

function entry(over: Partial<Entry> & Pick<Entry, 'id' | 'category' | 'query'>): Entry {
  return {
    id: over.id,
    category: over.category,
    query: over.query,
    ...(over.sessionID ? { sessionID: over.sessionID } : {}),
    must_include: over.must_include ?? [],
    must_exclude: over.must_exclude ?? [],
    note: over.note ?? 'fixture',
  };
}

function fixture(entries: Entry[], meta: Record<string, any> = {}) {
  return {
    version: 1,
    createdAt: '2026-11-18',
    corpus: 'unit-fixture',
    status: 'personal-regression-set',
    entries,
    ...meta,
  };
}

function mockFetch(route: MockRoute) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    const raw = String(url);
    calls.push(raw);
    const parsed = new URL(raw);
    if (parsed.pathname === '/api/memory/search') {
      const query = parsed.searchParams.get('query') ?? '';
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: (route.rest?.[query] ?? []).map((id) => ({ id })) }),
      } as any;
    }
    if (parsed.pathname === '/api/recall/context') {
      const query = parsed.searchParams.get('query') ?? '';
      return { ok: true, status: 200, json: async () => ({ pointers: route.auto?.[query] ?? null }) } as any;
    }
    if (parsed.pathname === '/api/memory/get') {
      const id = parsed.searchParams.get('id') ?? '';
      const memory = route.get?.[id];
      return {
        ok: Boolean(memory),
        status: memory ? 200 : 404,
        json: async () => (memory ? { success: true, memory } : { success: false }),
      } as any;
    }
    return { ok: false, status: 404, json: async () => ({}) } as any;
  };
  return Object.assign(fn, { calls });
}

const A = 'mem_1794900000001_aaaaaa';
const B = 'mem_1794900000002_bbbbbb';
const C = 'mem_1794900000003_cccccc';
const STALE = 'mem_1794900000004_dddddd';
const NOISE = 'mem_1794900000005_eeeeee';

describe('personal-recall runner: REST hit@1 / hit@3', () => {
  it('records rank 1 and rank 3 targets from a two-query fixture', async () => {
    const fx = fixture([
      entry({ id: 'p-one', category: 'exact', query: 'alpha', must_include: [A] }),
      entry({ id: 'p-three', category: 'implicit', query: 'beta', must_include: [B] }),
    ]);
    const fetchImpl = mockFetch({
      rest: { alpha: [A, NOISE, NOISE], beta: [NOISE, NOISE, B] },
      auto: { alpha: '- #mem-aaaaaa "alpha answer"', beta: '- #mem-bbbbbb "beta answer"' },
    });
    const report = await runner.runEvaluation({ fixture: fx, baseUrl: 'http://gw', fetchImpl });
    const one = report.rows.find((r: any) => r.id === 'p-one');
    const three = report.rows.find((r: any) => r.id === 'p-three');
    expect(one.rest.hit1).toBe(true);
    expect(one.rest.rank).toBe(1);
    expect(three.rest.hit1).toBe(false);
    expect(three.rest.hit3).toBe(true);
    expect(three.rest.rank).toBe(3);
    expect(report.summary.rest.positive).toBe(2);
    expect(report.summary.rest.hit1).toBeCloseTo(0.5);
    expect(report.summary.rest.hit3).toBeCloseTo(1);
    expect(report.summary.rest.mrr).toBeCloseTo((1 + 1 / 3) / 2);
  });
});

describe('personal-recall runner: auto-recall pointer matching', () => {
  it('matches a full id by the last 6 chars of a #mem- pointer', async () => {
    const fx = fixture([entry({ id: 'p-one', category: 'exact', query: 'alpha', must_include: [A] })]);
    const fetchImpl = mockFetch({
      rest: { alpha: [A] },
      auto: {
        alpha: [
          '<recall>',
          '[联想线索]',
          '- #mem-aaaaaa [2026-11-18 semantic] "alpha answer"',
          '- #mem-eeeeee [2026-11-18 semantic] "unrelated"',
          '</recall>',
        ].join('\n'),
      },
      // Unknown tails are resolved to full ids through the same 6-char
      // pointer-tail lookup mafw_get_memory uses.
      get: { eeeeee: { id: NOISE } },
    });
    const report = await runner.runEvaluation({ fixture: fx, baseUrl: 'http://gw', fetchImpl });
    const row = report.rows[0];
    expect(row.auto.ids).toEqual([A, NOISE]);
    expect(row.auto.included).toEqual([A]);
    expect(row.auto.hit).toBe(true);
    expect(row.auto.rank).toBe(1);
    expect(row.entrypointAgreement).toBe(true);
  });
});

describe('personal-recall runner: negative false injection', () => {
  it('counts any injected pointer on a no-answer query as false injection', async () => {
    const fx = fixture([
      entry({ id: 'n-one', category: 'negative', query: 'iceland budget', note: 'true no-answer control' }),
      entry({ id: 'n-two', category: 'negative', query: 'horse rem', note: 'true no-answer control' }),
    ]);
    const fetchImpl = mockFetch({
      rest: { 'iceland budget': [NOISE], 'horse rem': [NOISE] },
      auto: {
        'iceland budget': '<recall>\n- #mem-eeeeee "wrong topic"\n</recall>',
        'horse rem': '<topic-recall>相关记忆：无</topic-recall>',
      },
    });
    const report = await runner.runEvaluation({ fixture: fx, baseUrl: 'http://gw', fetchImpl });
    expect(report.summary.falseInjection.controls).toBe(2);
    expect(report.summary.falseInjection.injected).toBe(1);
    expect(report.summary.falseInjection.rate).toBeCloseTo(0.5);
    expect(report.rows[0].auto.falseInjection).toBe(true);
    expect(report.rows[1].auto.falseInjection).toBe(false);
  });
});

describe('personal-recall runner: must_exclude stale injection', () => {
  it('flags an auto-injected superseded id and counts it in the summary', async () => {
    const fx = fixture([
      entry({
        id: 'p-stale',
        category: 'current-state',
        query: 'note-board budget now',
        must_include: [A],
        must_exclude: [STALE],
      }),
    ]);
    const fetchImpl = mockFetch({
      rest: { 'note-board budget now': [A] },
      auto: {
        'note-board budget now': '<recall>\n- #mem-aaaaaa "current"\n- #mem-dddddd "old superseded"\n</recall>',
      },
    });
    const report = await runner.runEvaluation({ fixture: fx, baseUrl: 'http://gw', fetchImpl });
    expect(report.rows[0].auto.excluded).toEqual([STALE]);
    expect(report.rows[0].auto.staleInjection).toBe(true);
    expect(report.summary.staleInjection.entries).toBe(1);
    expect(report.summary.staleInjection.ids).toEqual([STALE]);
  });
});

describe('personal-recall runner: note-board is not related recall', () => {
  it('strips note-board and pinned blocks before parsing ids', async () => {
    const pointers = [
      '<topic-recall>',
      '主题：未设置',
      '相关记忆：无',
      '</topic-recall>',
      '',
      '<note-board>',
      '- [11-20] #mem-cccccc 记得交报告（剩 2 天）',
      '</note-board>',
      '',
      '<user-profile>',
      '- #mem-dddddd pinned identity',
      '</user-profile>',
    ].join('\n');
    const fx = fixture([
      entry({ id: 'n-one', category: 'negative', query: 'no answer', note: 'true no-answer control' }),
    ]);
    const fetchImpl = mockFetch({ rest: { 'no answer': [NOISE] }, auto: { 'no answer': pointers } });
    const report = await runner.runEvaluation({ fixture: fx, baseUrl: 'http://gw', fetchImpl });
    expect(report.rows[0].auto.ids).toEqual([]);
    expect(report.rows[0].auto.falseInjection).toBe(false);
    expect(report.summary.falseInjection.injected).toBe(0);
  });
});

describe('personal-recall runner: fixture validation', () => {
  const base = () => [
    entry({ id: 'e-1', category: 'exact', query: 'q1', must_include: [A] }),
    entry({ id: 'e-2', category: 'exact', query: 'q2', must_include: [B] }),
  ];

  it('rejects duplicate entry ids', () => {
    const fx = fixture([...base(), entry({ id: 'e-1', category: 'negative', query: 'q3', note: 'no-answer control' })]);
    expect(() => runner.validateFixture(fx)).toThrow(/duplicate/i);
  });

  it('rejects unknown memory ids when a known-id set is supplied', () => {
    const fx = fixture(base());
    expect(() => runner.validateFixture(fx, { knownIds: new Set([A]) })).toThrow(/unknown/i);
  });

  it('accepts ids the known-id set contains', () => {
    const fx = fixture(base());
    expect(() => runner.validateFixture(fx, { knownIds: new Set([A, B]) })).not.toThrow();
  });

  it('rejects an id the live corpus resolver cannot find', async () => {
    const fx = fixture([entry({ id: 'p-one', category: 'exact', query: 'q1', must_include: [A, STALE] })]);
    const fetchImpl = mockFetch({ get: { aaaaaa: { id: A } } });
    await expect(runner.verifyFixtureIds(fx, { baseUrl: 'http://gw', fetchImpl })).rejects.toThrow(/unknown/i);
  });

  it('rejects empty must_include on a positive query', () => {
    const fx = fixture([entry({ id: 'e-1', category: 'exact', query: 'q1', note: 'targets a memory' })]);
    expect(() => runner.validateFixture(fx)).toThrow(/must_include/i);
  });

  it('allows empty must_include only for negative or explicitly-marked no-answer entries', () => {
    const fx = fixture([
      entry({ id: 'n-1', category: 'negative', query: 'q0', note: 'no-answer control' }),
      entry({ id: 'i-1', category: 'implicit', query: 'q1', note: 'no-answer: corpus has no such memory' }),
    ]);
    expect(() => runner.validateFixture(fx)).not.toThrow();
  });

  it('rejects must_include on a negative query', () => {
    const fx = fixture([entry({ id: 'n-1', category: 'negative', query: 'q0', must_include: [A], note: 'bad' })]);
    expect(() => runner.validateFixture(fx)).toThrow(/negative/i);
  });

  it('rejects a category distribution other than 10/10/10/10', () => {
    const entries: Entry[] = [];
    for (let i = 0; i < 9; i++) {
      entries.push(entry({ id: `e-${i}`, category: 'exact', query: `e${i}`, must_include: [A] }));
    }
    for (let i = 0; i < 11; i++) {
      entries.push(entry({ id: `c-${i}`, category: 'current-state', query: `c${i}`, must_include: [A] }));
    }
    for (let i = 0; i < 10; i++) {
      entries.push(entry({ id: `i-${i}`, category: 'implicit', query: `i${i}`, must_include: [A] }));
    }
    for (let i = 0; i < 10; i++) {
      entries.push(entry({ id: `n-${i}`, category: 'negative', query: `n${i}`, note: 'no-answer control' }));
    }
    expect(() => runner.validateRealFixture(fixture(entries))).toThrow(/10 per category|category count/i);
  });

  it('accepts the real 40-query fixture', () => {
    const file = path.resolve(__dirname, '../../../../evaluation/personal-recall/queries.json');
    const fx = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(() => runner.validateRealFixture(fx)).not.toThrow();
    expect(fx.entries).toHaveLength(40);
    for (const category of ['current-state', 'exact', 'implicit', 'negative']) {
      expect(fx.entries.filter((e: Entry) => e.category === category)).toHaveLength(10);
    }
    expect(fx.entries.some((e: Entry) => e.query === '5cd9885f5')).toBe(true);
  });
});

describe('personal-recall runner: summary statistics', () => {
  it('computes entrypoint agreement only over positive entries', async () => {
    const fx = fixture([
      entry({ id: 'p-agree', category: 'exact', query: 'qa', must_include: [A] }),
      entry({ id: 'p-disagree', category: 'exact', query: 'qd', must_include: [B] }),
      entry({ id: 'n-one', category: 'negative', query: 'qn', note: 'no-answer control' }),
    ]);
    const fetchImpl = mockFetch({
      rest: { qa: [A], qd: [B], qn: [NOISE] },
      auto: {
        qa: '- #mem-aaaaaa "hit"',
        qd: '<topic-recall>相关记忆：无</topic-recall>',
        qn: '<topic-recall>相关记忆：无</topic-recall>',
      },
    });
    const report = await runner.runEvaluation({ fixture: fx, baseUrl: 'http://gw', fetchImpl });
    expect(report.summary.entrypointAgreement.compared).toBe(2);
    expect(report.summary.entrypointAgreement.agree).toBe(1);
    expect(report.summary.entrypointAgreement.rate).toBeCloseTo(0.5);
  });

  it('reports p50 / p95 latency from recorded samples', () => {
    const values = [10, 20, 30, 40, 100];
    expect(runner.percentile(values, 50)).toBe(30);
    expect(runner.percentile(values, 95)).toBe(100);
    expect(runner.percentile([], 50)).toBe(0);
  });
});
