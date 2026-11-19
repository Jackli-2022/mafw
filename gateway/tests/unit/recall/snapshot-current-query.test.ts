/**
 * Snapshot current-query admission: a pre-rendered snapshot is built from a
 * ROLLING WINDOW of recent turns, so its block can be topically stale even when
 * the deterministic containment guard says "use" (a short follow-up such as
 * 「再分析一下」 overlaps nothing, and a memory that was relevant two turns ago
 * may already be off-topic).
 *
 * The adapter is pure: it validates the snapshot's STRUCTURED metadata against
 * the CURRENT query, keeps only lexically supported anchors (and neighbours that
 * are independently supported by a retained anchor), drops T1 evidence already
 * carried by a retained Harmonic pointer, and re-renders deterministically.
 * No metadata (legacy snapshot) keeps the legacy serve; no current support means
 * the live fallback must run instead.
 */
import type { RecallSnapshot } from '../../../src/recall/recall-snapshot';
import { adaptSnapshotToCurrentQuery } from '../../../src/recall/snapshot-current-query';

const ID = (tail: string): string => `mem_1750000000_${tail}`;

type SnapshotMemory = NonNullable<RecallSnapshot['memories']>[number];

function mem(tail: string, abstraction: string, extra: Partial<SnapshotMemory> = {}) {
  return {
    id: ID(tail),
    type: 'semantic',
    abstraction,
    date: '2026-11-18T10:00:00.000Z',
    energy: 0.9,
    cue_anchors: [] as string[],
    ...extra,
  };
}

/**
 * The real 2026-11-19 mis-recall: a session about memory-recall performance
 * built this snapshot, then the user said 「再分析一下」.
 */
function exampleSnapshot(over: Partial<RecallSnapshot> = {}): RecallSnapshot {
  return {
    query:
      '记忆召回性能优化 我们把 snapshot 的构建从同步改成了后台预取，再看看延迟分布和 lexical support 过滤，'
      + '关注 p95 和 p99，顺便确认一下 note-board 预算',
    block: '<recall>stale prefetched block</recall>',
    ids: [ID('nzi4oy'), ID('pflowx'), ID('uxaaaa'), ID('bashan')],
    builtAt: '2026-11-19T09:30:00.000Z',
    fokStatus: 'inject',
    top1prob: 0.71,
    memories: [
      mem('nzi4oy', '子代理实施偏好 deepseek-v4.1-flash 模型'),
      mem('pflowx', '一般流程偏好：先写失败测试再实现'),
      mem('uxaaaa', '五家 Agent 与 Desktop UX 调研结论'),
      mem('bashan', 'bash 缓存路径错误：npm 缓存目录失效'),
      mem('jviztm', 'bash 缓存路径错误：npm prefix 指向失效目录', { neighborOf: ID('nzi4oy') }),
    ],
    t1Hits: [
      {
        sessionId: 's1',
        turnId: 1,
        traceId: 't1t_a',
        cosine: 0.93,
        excerpt: '子代理实施偏好 deepseek-v4.1-flash 模型，不要用 pro',
        source: 'user_input',
      },
      {
        sessionId: 's1',
        turnId: 2,
        traceId: 't1t_b',
        cosine: 0.91,
        excerpt: '子代理实施偏好   deepseek-v4.1-flash   模型，不要用 pro',
        source: 'user_input',
      },
      {
        sessionId: 's1',
        turnId: 3,
        traceId: 't1t_c',
        cosine: 0.88,
        excerpt: '子代理偏好：实施用 deepseek 模型 即可',
        source: 'user_input',
      },
    ],
    t1Rendered: true,
    ...over,
  };
}

const t1LineCount = (block: string): number => (block.match(/\[t1\|/g) ?? []).length;

describe('adaptSnapshotToCurrentQuery — admission', () => {
  test('the real case: 「再分析一下」 cannot serve the stale block', () => {
    const result = adaptSnapshotToCurrentQuery(exampleSnapshot(), '再分析一下');
    expect(result.action).toBe('fallback');
    if (result.action !== 'fallback') return;
    expect(result.reason).toBe('no-current-support');
  });

  test('「记忆召回延迟」 has no support in the example snapshot → fallback (live path must search)', () => {
    const result = adaptSnapshotToCurrentQuery(exampleSnapshot(), '记忆召回延迟');
    expect(result.action).toBe('fallback');
    if (result.action !== 'fallback') return;
    expect(result.reason).toBe('no-current-support');
  });

  test('a query with no word-level unit (single CJK char / punctuation) → no-query-units', () => {
    expect(adaptSnapshotToCurrentQuery(exampleSnapshot(), '好')).toEqual({
      action: 'fallback',
      reason: 'no-query-units',
    });
    expect(adaptSnapshotToCurrentQuery(exampleSnapshot(), '?!')).toEqual({
      action: 'fallback',
      reason: 'no-query-units',
    });
  });

  test('an empty render → empty-render', () => {
    expect(adaptSnapshotToCurrentQuery(exampleSnapshot({ block: '' }), '子代理实施用哪个模型')).toEqual({
      action: 'fallback',
      reason: 'empty-render',
    });
  });

  test('episodes snapshots keep their layered block → fallback', () => {
    const result = adaptSnapshotToCurrentQuery(
      exampleSnapshot({
        episodes: [{
          episodeId: 'ep1',
          sessionId: 's1',
          startTurn: 1,
          endTurn: 4,
          status: 'closed',
          startedAt: null,
          boundarySource: 'test',
          actors: [],
          conceptIds: [],
        }],
      }),
      '子代理实施用哪个模型',
    );
    expect(result).toEqual({ action: 'fallback', reason: 'episodes-unsupported' });
  });

  test('legacy snapshot without structured metadata is served verbatim', () => {
    const legacy = {
      query: 'old window',
      block: '<recall>legacy body</recall>',
      ids: [ID('legacy')],
      builtAt: '2026-11-19T09:30:00.000Z',
      t1Hits: [{ sessionId: 's1', turnId: 1, cosine: 0.4, excerpt: 'legacy t1', traceId: 't1t_l' }],
      t1Rendered: true,
    } as RecallSnapshot;
    const result = adaptSnapshotToCurrentQuery(legacy, '记忆召回延迟');
    expect(result.action).toBe('serve');
    if (result.action !== 'serve') return;
    expect(result.snapshot.block).toBe('<recall>legacy body</recall>');
    expect(result.snapshot.ids).toEqual([ID('legacy')]);
    expect(result.snapshot.t1Hits).toHaveLength(1);
    // immutability contract: a copy, not the stored object
    expect(result.snapshot).not.toBe(legacy);
    expect(result.kept.filtered).toBe(false);
  });
});

describe('adaptSnapshotToCurrentQuery — filtering', () => {
  test('「子代理实施用哪个模型」 keeps only nzi4oy, drops the bash neighbour, dedupes T1', () => {
    const result = adaptSnapshotToCurrentQuery(exampleSnapshot(), '子代理实施用哪个模型');
    expect(result.action).toBe('serve');
    if (result.action !== 'serve') return;

    expect(result.kept).toEqual({ anchors: 1, neighbors: 0, t1: 1, filtered: true });
    expect(result.snapshot.ids).toEqual([ID('nzi4oy')]);
    expect(result.snapshot.memories?.map((m) => m.id)).toEqual([ID('nzi4oy')]);
    expect(result.snapshot.block).toContain('#mem-nzi4oy');
    expect(result.snapshot.block).not.toContain('#mem-jviztm');
    expect(result.snapshot.block).not.toContain('#mem-bashan');
    // Two of three T1 hits share the 19-char identifier phrase with the kept
    // Harmonic pointer (or duplicate each other); only the third survives.
    expect(result.snapshot.t1Hits).toHaveLength(1);
    expect(result.snapshot.t1Hits![0].traceId).toBe('t1t_c');
    expect(t1LineCount(result.snapshot.block)).toBe(1);
    expect(result.snapshot.t1Rendered).toBe(true);
  });

  test('T1 self-dedupe is exact-normalised only (no aggressive merging)', () => {
    const snap = exampleSnapshot({
      memories: [mem('nzi4oy', '子代理实施用 deepseek-v4.1-flash 模型')],
      ids: [ID('nzi4oy')],
      t1Hits: [
        { sessionId: 's1', turnId: 1, traceId: 't1t_x', cosine: 0.9, excerpt: '子代理实施用 DeepSeek 模型', source: 'user_input' },
        { sessionId: 's1', turnId: 2, traceId: 't1t_y', cosine: 0.8, excerpt: '子代理实施用   deepseek    模型', source: 'user_input' },
        { sessionId: 's1', turnId: 3, traceId: 't1t_z', cosine: 0.7, excerpt: 'cache path 完全无关的一行', source: 'user_input' },
      ],
    });
    const result = adaptSnapshotToCurrentQuery(snap, '子代理实施用哪个模型');
    expect(result.action).toBe('serve');
    if (result.action !== 'serve') return;
    expect(result.snapshot.t1Hits?.map((h) => h.traceId)).toEqual(['t1t_x']);
    expect(result.kept.t1).toBe(1);
  });

  test('a neighbour is kept only when it is independently supported AND its anchor is kept', () => {
    const snap: RecallSnapshot = {
      query: '子代理实施 历史窗口',
      block: '<recall>stale</recall>',
      ids: [ID('keepa1'), ID('dropb1')],
      builtAt: '2026-11-19T09:30:00.000Z',
      fokStatus: 'inject',
      memories: [
        mem('keepa1', '子代理实施用 deepseek-v4.1-flash 模型'),
        mem('dropb1', 'bash 缓存路径错误：npm 缓存目录失效'),
        mem('neigh1', '子代理模型实施偏好记录', { neighborOf: ID('keepa1') }),
        mem('neigh2', '子代理实施缓存路径注意', { neighborOf: ID('dropb1') }),
      ],
      t1Hits: [],
      t1Rendered: false,
    };
    const result = adaptSnapshotToCurrentQuery(snap, '子代理实施用哪个模型');
    expect(result.action).toBe('serve');
    if (result.action !== 'serve') return;
    expect(result.kept).toEqual({ anchors: 1, neighbors: 1, t1: 0, filtered: true });
    expect(result.snapshot.ids).toEqual([ID('keepa1')]);
    expect(result.snapshot.memories?.map((m) => m.id)).toEqual([ID('keepa1'), ID('neigh1')]);
    expect(result.snapshot.block).toContain('#mem-neigh1');
    expect(result.snapshot.block).not.toContain('#mem-neigh2');
    expect(result.snapshot.t1Rendered).toBe(false);
  });

  test('retained anchors keep their original order', () => {
    const snap: RecallSnapshot = {
      query: '缓存路径',
      block: '<recall>stale</recall>',
      ids: [ID('ordaaa'), ID('dropme'), ID('ordbbb')],
      builtAt: '2026-11-19T09:30:00.000Z',
      fokStatus: 'inject',
      memories: [
        mem('ordaaa', 'npm 缓存路径错误：prefix 无效'),
        mem('dropme', '五家 Agent 与 Desktop UX 调研结论'),
        mem('ordbbb', '缓存目录失效导致 npm 缓存路径回退'),
      ],
      t1Hits: [],
      t1Rendered: false,
    };
    const result = adaptSnapshotToCurrentQuery(snap, 'npm 缓存路径错误');
    expect(result.action).toBe('serve');
    if (result.action !== 'serve') return;
    expect(result.snapshot.ids).toEqual([ID('ordaaa'), ID('ordbbb')]);
    expect(result.kept.anchors).toBe(2);
  });

  test('does not mutate the stored snapshot', () => {
    const original = exampleSnapshot();
    const before = JSON.parse(JSON.stringify(original));
    const result = adaptSnapshotToCurrentQuery(original, '子代理实施用哪个模型');
    expect(result.action).toBe('serve');
    if (result.action !== 'serve') return;
    expect(result.snapshot).not.toBe(original);
    expect(original).toEqual(before);
    // The stale ids / block are still the pre-filter values on the original.
    expect(original.ids).toHaveLength(4);
    expect(original.memories).toHaveLength(5);
    expect(original.t1Hits).toHaveLength(3);
  });

  test('a cue-only identifier match must not delete a T1 line (cue anchors are not rendered)', () => {
    const snap = exampleSnapshot({
      block: '<recall>stale</recall>',
      ids: [ID('nzi4oy')],
      memories: [
        mem('nzi4oy', '子代理实施用模型偏好', { cue_anchors: ['deepseek-v4.1-flash'] }),
        // forces an explicit filter → the block is re-rendered, so the T1 line
        // has to be dropped or kept by the redundancy rule itself
        mem('dropme', 'bash 缓存路径错误：npm 缓存目录失效'),
      ],
      t1Hits: [{
        sessionId: 's1',
        turnId: 1,
        traceId: 't1t_a',
        cosine: 0.9,
        excerpt: '子代理实施用 deepseek-v4.1-flash 即可',
        source: 'user_input',
      }],
      t1Rendered: true,
    });
    const result = adaptSnapshotToCurrentQuery(snap, '子代理实施用哪个模型');
    expect(result.action).toBe('serve');
    if (result.action !== 'serve') return;
    // The phrase lives only in a cue anchor — the rendered block never shows
    // it, so the T1 line is not redundant.
    expect(result.kept.t1).toBe(1);
    expect(result.snapshot.t1Hits?.map((h) => h.traceId)).toEqual(['t1t_a']);
    expect(t1LineCount(result.snapshot.block)).toBe(1);
  });

  test('an 8-char shared word below the ≥12 identifier floor keeps the T1 line', () => {
    const snap = exampleSnapshot({
      block: '<recall>stale</recall>',
      ids: [ID('nzi4oy')],
      memories: [
        mem('nzi4oy', '子代理实施用 deepseek 模型'),
        mem('dropme', 'bash 缓存路径错误：npm 缓存目录失效'), // forces a re-render
      ],
      t1Hits: [{
        sessionId: 's1',
        turnId: 1,
        traceId: 't1t_a',
        cosine: 0.9,
        excerpt: '子代理实施用 deepseek 模型 即可',
        source: 'user_input',
      }],
      t1Rendered: true,
    });
    const result = adaptSnapshotToCurrentQuery(snap, '子代理实施用哪个模型');
    expect(result.action).toBe('serve');
    if (result.action !== 'serve') return;
    expect(result.kept.t1).toBe(1);
    expect(t1LineCount(result.snapshot.block)).toBe(1);
  });

  test('honours a caller-supplied t1MaxChars budget when re-rendering', () => {
    const make = (): RecallSnapshot => exampleSnapshot({
      block: '<recall>stale</recall>',
      ids: [ID('nzi4oy')],
      memories: [
        mem('nzi4oy', '子代理实施用模型偏好'),
        // forces an actual filter → the T1 section has to be re-rendered
        mem('dropme', 'bash 缓存路径错误：npm 缓存目录失效'),
      ],
      t1Hits: [
        { sessionId: 's1', turnId: 1, traceId: 't1t_a', cosine: 0.9, excerpt: `子代理实施用 ${'a'.repeat(200)}`, source: 'user_input' },
        { sessionId: 's1', turnId: 2, traceId: 't1t_b', cosine: 0.8, excerpt: `子代理实施用 ${'b'.repeat(200)}`, source: 'user_input' },
      ],
      t1Rendered: true,
    });
    const wide = adaptSnapshotToCurrentQuery(make(), '子代理实施用哪个模型');
    const narrow = adaptSnapshotToCurrentQuery(make(), '子代理实施用哪个模型', { t1MaxChars: 120 });
    expect(wide.action).toBe('serve');
    expect(narrow.action).toBe('serve');
    if (wide.action !== 'serve' || narrow.action !== 'serve') return;
    expect(t1LineCount(wide.snapshot.block)).toBe(2);
    expect(t1LineCount(narrow.snapshot.block)).toBe(1);
    expect(narrow.snapshot.block.length).toBeLessThan(wide.snapshot.block.length);
    const narrowT1 = narrow.snapshot.block.split('\n').filter((line) => line.startsWith('[t1|'));
    expect(narrowT1).toHaveLength(1);
    expect(narrowT1[0].length).toBeLessThanOrEqual(120);
  });

  test('serves the original block verbatim when nothing is filtered (extra anchors / gist hint preserved)', () => {
    const originalBlock = [
      '<recall>',
      '[联想线索 · 依据前请验证：取全文 → mafw_get_memory("#mem-后6位")；检索更多 → mafw_search_hybrid]',
      '- #mem-nzi4oy [2026-11-18 semantic] "子代理实施用模型偏好" (E:0.9) ↳ gist 已蒸馏（get_memory 可取）：abc123',
      '- #mem-extra9 [2026-11-17 procedural] "第二条 anchor 超出 metadata topK" (E:0.4)',
      '</recall>',
    ].join('\n');
    const snap: RecallSnapshot = {
      query: '子代理实施 窗口',
      block: originalBlock,
      ids: [ID('nzi4oy')],
      builtAt: '2026-11-19T09:30:00.000Z',
      fokStatus: 'inject',
      memories: [mem('nzi4oy', '子代理实施用 deepseek-v4.1-flash 模型')],
      t1Hits: [{
        sessionId: 's1',
        turnId: 1,
        traceId: 't1t_a',
        cosine: 0.9,
        excerpt: '子代理实施用 deepseek 即可',
        source: 'user_input',
      }],
      t1Rendered: true,
    };
    const before = JSON.parse(JSON.stringify(snap));
    const result = adaptSnapshotToCurrentQuery(snap, '子代理实施用哪个模型');
    expect(result.action).toBe('serve');
    if (result.action !== 'serve') return;
    expect(result.kept).toEqual({ anchors: 1, neighbors: 0, t1: 1, filtered: false });
    // byte-for-byte the stored block: the metadata only carries topK anchors,
    // so a re-render would drop the extra anchor and the gist hint.
    expect(result.snapshot.block).toBe(originalBlock);
    expect(result.snapshot.block).toContain('#mem-extra9');
    expect(result.snapshot.block).toContain('gist 已蒸馏');
    expect(result.snapshot.ids).toEqual([ID('nzi4oy')]);
    expect(result.snapshot).not.toBe(snap);
    expect(snap).toEqual(before);
  });
});
