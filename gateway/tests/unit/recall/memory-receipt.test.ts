import {
  buildMemoryReceipt,
  mergeMemoryReceipt,
  filterT1,
  type MemoryReceipt,
} from '../../../src/recall/receipt';

const NOW = '2026-11-18T06:32:00.000Z';

function memory(over: Record<string, unknown> = {}) {
  return {
    id: 'mem_a',
    type: 'semantic',
    primary_abstraction: '用户偏好 TDD 先行',
    created_at: '2026-11-16T00:00:00.000Z',
    energy: 7.2,
    ...over,
  };
}

function t1(over: Record<string, unknown> = {}) {
  return {
    traceId: 't1t_a',
    excerpt: '元信息怎么展示',
    source: 'user',
    ...over,
  };
}

describe('filterT1', () => {
  it('keeps user/assistant text and drops tool/system noise', () => {
    const out = filterT1([
      t1({ traceId: 'keep', excerpt: '元信息怎么展示', source: 'user' }),
      t1({ traceId: 'tool', excerpt: 'ok | packages\\desktop\\app; Select-String ...', source: 'tool' }),
      t1({ traceId: 'sys', excerpt: 'You are a subagent spawned by another session. | [object Object]', source: 'system' }),
      t1({ traceId: 'unknown', excerpt: '[object Object]', source: undefined }),
      t1({ traceId: 'assistant', excerpt: '我来看看回执卡', source: 'assistant' }),
    ]);
    expect(out.kept.map((item) => item.traceId)).toEqual(['keep', 'assistant']);
    expect(out.filtered).toBe(3);
  });

  it('drops empty excerpts and caps at 240 chars', () => {
    const long = 'x'.repeat(300);
    const out = filterT1([
      t1({ traceId: 'empty', excerpt: '   ' }),
      t1({ traceId: 'long', excerpt: long }),
    ]);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0].excerpt).toHaveLength(240);
  });
});

describe('buildMemoryReceipt', () => {
  it('builds an inject receipt with memories and filtered T1', () => {
    const receipt = buildMemoryReceipt({
      status: 'inject',
      tookMs: 42,
      now: NOW,
      topic: { title: 'Lead 外部事件回执卡片设计', hasRelated: true },
      memories: [memory(), memory({ id: 'mem_b', type: 'procedural', primary_abstraction: '合入后先核验' })],
      t1: [
        t1(),
        t1({ traceId: 'tool', excerpt: 'ok | packages\\desktop\\app', source: 'tool' }),
        t1({ traceId: 'sys', excerpt: 'You are a subagent spawned by another session', source: 'system' }),
      ],
    });

    expect(receipt).not.toBeNull();
    expect(receipt!.status).toBe('inject');
    expect(receipt!.counts).toEqual({ memories: 2, t1: 1 });
    expect(receipt!.filteredT1).toBe(2);
    expect(receipt!.t1.map((item) => item.traceId)).toEqual(['t1t_a']);
    expect(receipt!.memories[0]).toMatchObject({
      id: 'mem_a',
      type: 'semantic',
      abstraction: '用户偏好 TDD 先行',
      available: true,
    });
  });

  it('returns null for an empty normal recall', () => {
    const receipt = buildMemoryReceipt({
      status: 'inject',
      tookMs: 10,
      now: NOW,
      topic: null,
      memories: [],
      t1: [],
    });
    expect(receipt).toBeNull();
  });

  it('returns no-memory only when the block was actually rendered', () => {
    const receipt = buildMemoryReceipt({
      status: 'no-memory',
      tookMs: 10,
      now: NOW,
      topic: { title: 't', hasRelated: false },
      memories: [],
      t1: [],
      noMemoryBlockRendered: true,
    });
    expect(receipt).not.toBeNull();
    expect(receipt!.status).toBe('no-memory');
    expect(receipt!.counts).toEqual({ memories: 0, t1: 0 });
  });

  it('never reports no-memory when there is content', () => {
    const receipt = buildMemoryReceipt({
      status: 'no-memory',
      tookMs: 10,
      now: NOW,
      topic: null,
      memories: [memory()],
      t1: [],
      noMemoryBlockRendered: true,
    });
    expect(receipt!.status).toBe('inject');
  });

  it('keeps low-confidence when requested and there is content', () => {
    const receipt = buildMemoryReceipt({
      status: 'low-confidence',
      tookMs: 10,
      now: NOW,
      topic: null,
      memories: [memory()],
      t1: [],
    });
    expect(receipt!.status).toBe('low-confidence');
  });

  it('caps anchors at 5, neighbors at 4, and counts only anchors', () => {
    const memories = [
      ...Array.from({ length: 7 }, (_, i) => memory({ id: `mem_${i}` })),
      memory({ id: 'n1', neighborOf: 'mem_0' }),
      memory({ id: 'n2', neighborOf: 'mem_0' }),
      memory({ id: 'n3', neighborOf: 'mem_0' }),
      memory({ id: 'n4', neighborOf: 'mem_0' }),
      memory({ id: 'n5', neighborOf: 'mem_0' }),
    ];
    const receipt = buildMemoryReceipt({
      status: 'inject',
      tookMs: 10,
      now: NOW,
      topic: null,
      memories,
      t1: [],
    });
    expect(receipt!.memories.filter((item) => !item.neighborOf)).toHaveLength(5);
    expect(receipt!.memories.filter((item) => item.neighborOf)).toHaveLength(4);
    expect(receipt!.counts.memories).toBe(5);
  });

  it('dedupes memories by id and t1 by trace id', () => {
    const receipt = buildMemoryReceipt({
      status: 'inject',
      tookMs: 10,
      now: NOW,
      topic: null,
      memories: [memory(), memory({ primary_abstraction: 'newer' })],
      t1: [t1(), t1({ excerpt: 'newer excerpt' })],
    });
    expect(receipt!.memories).toHaveLength(1);
    expect(receipt!.memories[0].abstraction).toBe('newer');
    expect(receipt!.t1).toHaveLength(1);
    expect(receipt!.t1[0].excerpt).toBe('newer excerpt');
  });

  it('does not leak memory_value or pointer ids', () => {
    const receipt = buildMemoryReceipt({
      status: 'inject',
      tookMs: 10,
      now: NOW,
      topic: null,
      memories: [memory({ memory_value: 'FULL SECRET BODY', primary_abstraction: '短摘要' })],
      t1: [],
    });
    const json = JSON.stringify(receipt);
    expect(json).not.toContain('FULL SECRET BODY');
    expect(json).not.toContain('#mem-');
  });
});

describe('mergeMemoryReceipt', () => {
  const base = (over: Partial<MemoryReceipt> = {}): MemoryReceipt => ({
    version: 1,
    status: 'inject',
    tookMs: 10,
    createdAt: '2026-11-18T06:30:00.000Z',
    updatedAt: '2026-11-18T06:30:00.000Z',
    topic: { title: 't', hasRelated: true },
    memories: [{
      id: 'mem_a', type: 'semantic', abstraction: 'a', date: null, available: true,
    }],
    t1: [{ traceId: 't1a', excerpt: 'a', available: true }],
    counts: { memories: 1, t1: 1 },
    ...over,
  });

  it('dedupes across recalls and keeps the earliest/latest timestamps', () => {
    const merged = mergeMemoryReceipt(
      base(),
      base({
        tookMs: 30,
        createdAt: '2026-11-18T06:31:00.000Z',
        updatedAt: '2026-11-18T06:32:00.000Z',
        memories: [
          { id: 'mem_a', type: 'semantic', abstraction: 'a2', date: null, available: true },
          { id: 'mem_b', type: 'procedural', abstraction: 'b', date: null, available: true },
        ],
        t1: [{ traceId: 't1a', excerpt: 'a2', available: true }],
        counts: { memories: 2, t1: 1 },
      }),
    );
    expect(merged.memories).toHaveLength(2);
    expect(merged.memories[0].abstraction).toBe('a2');
    expect(merged.createdAt).toBe('2026-11-18T06:30:00.000Z');
    expect(merged.updatedAt).toBe('2026-11-18T06:32:00.000Z');
    expect(merged.tookMs).toBe(30);
    expect(merged.counts).toEqual({ memories: 2, t1: 1 });
  });

  it('sums filteredT1 and keeps low-confidence only when all contributors are low', () => {
    const merged = mergeMemoryReceipt(
      base({ status: 'low-confidence', filteredT1: 2 }),
      base({ status: 'low-confidence', filteredT1: 1, memories: [], t1: [], counts: { memories: 0, t1: 0 } }),
    );
    expect(merged.filteredT1).toBe(3);
    expect(merged.status).toBe('low-confidence');
  });

  it('promotes to inject when any content contributor is inject', () => {
    const merged = mergeMemoryReceipt(
      base({ status: 'low-confidence' }),
      base({
        status: 'inject',
        memories: [{ id: 'mem_b', type: 'procedural', abstraction: 'b', date: null, available: true }],
        t1: [],
        counts: { memories: 1, t1: 0 },
      }),
    );
    expect(merged.status).toBe('inject');
  });
});
