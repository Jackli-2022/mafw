/**
 * Task 2: exact-evidence index cache.
 *
 * The boundary path runs `findExactRecallEvidence` over the whole harmonic
 * index (~17k entries) on every non-inject turn. Re-normalizing every title and
 * every cue anchor on each scan is the dominant cost. The versioned cache
 * builds the normalized cue set, cue-length buckets, and title/identifier maps
 * once per `searchVersion` and answers every query from them.
 *
 * Non-negotiables under test:
 *   - omitting `searchVersion` keeps the old pure-function behavior (no cache);
 *   - with a version, results are identical per id, per kind, per specificity;
 *   - eligibility (superseded / retracted / unpinned episodic) is judged at
 *     query time and never memoized;
 *   - cue length / DF / coverage rules are unchanged;
 *   - a version bump or a different entry set rebuilds the index.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import {
  exactEvidenceCacheStatsForTest,
  findExactRecallEvidence,
  resetExactEvidenceCacheForTest,
  type ExactRecallEvidence,
} from '../../../src/recall/exact-evidence';

function entry(overrides: Record<string, any> = {}): any {
  return {
    id: 'mem_default',
    type: 'semantic',
    primary_abstraction: 'default abstraction',
    cue_anchors: [],
    memory_value: 'default value',
    energy: 0.8,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Comparable projection: id + kind + exact specificity (bit-for-bit). */
function shape(evidence: ExactRecallEvidence[]): Array<{ id: string; kind: string; specificity: number }> {
  return evidence.map(item => ({
    id: item.entry.id,
    kind: item.kind,
    specificity: item.specificity,
  }));
}

function cached(entries: readonly any[], query: string, version: number, limit = 10): ExactRecallEvidence[] {
  return findExactRecallEvidence(entries, query, limit, version);
}

const MIXED_CORPUS = (): any[] => [
  entry({ id: 'mem_title', primary_abstraction: 'Proactive   Topic Recall' }),
  entry({ id: 'mem_identifier', cue_anchors: ['5cd9885f5', 'retrieval'] }),
  entry({ id: 'mem_cue_strong', cue_anchors: ['proactive topic', 'topic recall design'] }),
  entry({ id: 'mem_cue_partial', cue_anchors: ['topic recall'] }),
  entry({ id: 'mem_cjk6', cue_anchors: ['主题召回边界'] }),
  entry({ id: 'mem_superseded', cue_anchors: ['5cd9885f5'], superseded_by: 'mem_identifier' }),
  entry({ id: 'mem_retracted', primary_abstraction: 'Proactive Topic Recall', retracted: true }),
  entry({ id: 'mem_episodic', type: 'episodic', cue_anchors: ['主题召回边界'] }),
  entry({ id: 'mem_pinned_episodic', type: 'episodic', pinned: true, cue_anchors: ['主题召回边界'] }),
  entry({
    id: 'mem_sticky_episodic',
    type: 'episodic',
    sticky_until: '2099-01-01T00:00:00.000Z',
    cue_anchors: ['主题召回边界'],
  }),
];

beforeEach(() => {
  resetExactEvidenceCacheForTest();
});

afterEach(() => {
  resetExactEvidenceCacheForTest();
});

describe('HarmonicIndex.getSearchVersion', () => {
  test('is a read-only monotonic version bumped by index writes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-exact-cache-'));
    const manager = new HarmonicIndexManager(dir);
    const before = manager.getSearchVersion();
    expect(typeof before).toBe('number');

    manager.addEntry(
      {
        id: 'unit_cache_probe',
        type: 'semantic',
        primary_abstraction: 'cache probe',
        cue_anchors: ['cache-probe-anchor'],
        memory_value: 'probe',
        energy: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any,
      'working',
      { save: false },
    );

    expect(manager.getSearchVersion()).toBeGreaterThan(before);
  });
});

describe('findExactRecallEvidence versioned cache', () => {
  test('builds the index once per searchVersion and reuses it', () => {
    const entries = MIXED_CORPUS();
    const query = 'Proactive Topic Recall';

    const first = cached(entries, query, 7);
    expect(exactEvidenceCacheStatsForTest().builds).toBe(1);

    const second = cached(entries, query, 7);
    expect(exactEvidenceCacheStatsForTest().builds).toBe(1);
    expect(shape(second)).toEqual(shape(first));
  });

  test('rebuilds after the searchVersion changes', () => {
    const entries = MIXED_CORPUS();
    expect(shape(cached(entries, 'Proactive Topic Recall', 7))).toContainEqual({
      id: 'mem_title',
      kind: 'title',
      specificity: 3,
    });
    expect(exactEvidenceCacheStatsForTest().builds).toBe(1);

    // Same array, in-place title rewrite, new version → rebuilt title map.
    entries[0].primary_abstraction = 'Renamed After Write';
    expect(shape(cached(entries, 'Proactive Topic Recall', 8))).not.toContainEqual({
      id: 'mem_title',
      kind: 'title',
      specificity: 3,
    });
    expect(shape(cached(entries, 'Renamed After Write', 8))).toContainEqual({
      id: 'mem_title',
      kind: 'title',
      specificity: 3,
    });
    expect(exactEvidenceCacheStatsForTest().builds).toBe(2);
  });

  test('rebuilds when the entry set itself changes', () => {
    const entries = MIXED_CORPUS();
    cached(entries, 'Proactive Topic Recall', 3);
    expect(exactEvidenceCacheStatsForTest().builds).toBe(1);

    const differentObjects = entries.map(item => ({ ...item }));
    cached(differentObjects, 'Proactive Topic Recall', 3);
    expect(exactEvidenceCacheStatsForTest().builds).toBe(2);
  });

  test('keeps the cache warm for a fresh array over the same entry objects', () => {
    // `HarmonicIndexManager.getIndex()` returns a new array wrapper every turn,
    // but the same entry objects. That must not defeat the versioned cache.
    const entries = MIXED_CORPUS();
    cached(entries, 'Proactive Topic Recall', 5);
    cached([...entries], 'Proactive Topic Recall', 5);
    expect(exactEvidenceCacheStatsForTest().builds).toBe(1);
  });

  test('drops the cached index when anchors are swapped on the same entry object', () => {
    const target = entry({ id: 'mem_swap_cache', cue_anchors: ['legacy-anchor'] });
    const entries = [target];
    expect(cached(entries, '5cd9885f5', 40)).toEqual([]);
    expect(exactEvidenceCacheStatsForTest().builds).toBe(1);

    // Same object, same version, fresh anchors array (production writers do
    // this; `normalizedCues` keys on the array, so the index must follow).
    target.cue_anchors = ['5cd9885f5'];
    expect(cached(entries, '5cd9885f5', 40).map(e => e.entry.id)).toEqual([target.id]);
    expect(exactEvidenceCacheStatsForTest().builds).toBe(2);
  });

  test('does not build or consult the cache without a searchVersion', () => {
    const entries = MIXED_CORPUS();
    findExactRecallEvidence(entries, 'Proactive Topic Recall');
    findExactRecallEvidence(entries, 'Proactive Topic Recall');
    expect(exactEvidenceCacheStatsForTest().builds).toBe(0);
  });

  test('matches the uncached result per id, kind, and specificity on all evidence kinds', () => {
    const entries = MIXED_CORPUS();
    const queries = [
      'Proactive   Topic Recall',
      'proactive topic recall',
      '5cd9885f5',
      '主题召回边界怎么改',
      'proactive topic',
      'topic recall design',
      'nothing exact here at all',
    ];
    for (const query of queries) {
      const uncached = shape(findExactRecallEvidence(entries, query, 10));
      const versioned = shape(cached(entries, query, 11));
      expect(versioned).toEqual(uncached);
    }
    // The mixed corpus really exercises all three kinds.
    expect(shape(cached(entries, 'proactive topic recall', 11)).some(e => e.kind === 'title')).toBe(true);
    expect(shape(cached(entries, '5cd9885f5', 11)).some(e => e.kind === 'identifier')).toBe(true);
    expect(shape(cached(entries, '主题召回边界怎么改', 11)).some(e => e.kind === 'cue')).toBe(true);
  });

  test('never lets superseded, retracted, or unpinned episodic entries in through the cache', () => {
    const entries = MIXED_CORPUS();
    const ids = cached(entries, '主题召回边界怎么改', 12).map(e => e.entry.id);
    expect(ids).toContain('mem_cjk6');
    expect(ids).toContain('mem_pinned_episodic');
    expect(ids).toContain('mem_sticky_episodic');
    expect(ids).not.toContain('mem_superseded');
    expect(ids).not.toContain('mem_retracted');
    expect(ids).not.toContain('mem_episodic');

    // Identifier path: the superseded duplicate must not shadow the live owner.
    const identifierIds = cached(entries, '5cd9885f5', 12).map(e => e.entry.id);
    expect(identifierIds).toEqual(['mem_identifier']);
  });

  test('keeps cue length, DF, and coverage rules identical', () => {
    const query = 'Proactive Topic Recall 主题工具设计';

    // DF 6: too common. Same array, cached and uncached agree and reject.
    const generic = Array.from({ length: 6 }, (_, i) =>
      entry({ id: `mem_generic_${i}`, cue_anchors: ['proactive topic'] }),
    );
    expect(cached(generic, query, 20)).toEqual([]);
    expect(shape(cached(generic, query, 20))).toEqual(shape(findExactRecallEvidence(generic, query)));

    // DF 5 counts documents, not occurrences: admissible, bounded to 3.
    const fiveDocuments = [
      ...Array.from({ length: 4 }, (_, i) =>
        entry({ id: `mem_doc_${i}`, cue_anchors: ['proactive topic'] }),
      ),
      entry({ id: 'mem_doc_repeat', cue_anchors: ['proactive topic', 'proactive topic'] }),
    ];
    const fiveDoc = cached(fiveDocuments, query, 21, 3);
    expect(fiveDoc).toHaveLength(3);
    expect(fiveDoc.every(e => e.kind === 'cue')).toBe(true);
    expect(shape(fiveDoc)).toEqual(shape(findExactRecallEvidence(fiveDocuments, query)));

    // Short cues and sub-50% coverage stay suppressed.
    const subThreshold = [
      entry({ id: 'mem_short', cue_anchors: ['topic'] }),
      entry({ id: 'mem_partial', cue_anchors: ['proactive recall'] }),
      entry({
        id: 'mem_low_coverage',
        cue_anchors: ['proactive topic recall'],
        primary_abstraction: 'low coverage',
      }),
    ];
    const longQuery =
      'Proactive Topic Recall 主题工具设计 with a very long unrelated trailing clause for coverage';
    expect(cached(subThreshold, longQuery, 22)).toEqual([]);
    expect(shape(cached(subThreshold, longQuery, 22))).toEqual(
      shape(findExactRecallEvidence(subThreshold, longQuery)),
    );

    // CJK 6 admissible / CJK 5 not.
    const cjk = [
      entry({ id: 'mem_cjk6b', cue_anchors: ['主题召回边界'] }),
      entry({ id: 'mem_cjk5b', cue_anchors: ['主题召回边'] }),
    ];
    expect(cached(cjk, '主题召回边界怎么改', 23).map(e => e.entry.id)).toEqual(['mem_cjk6b']);
    expect(shape(cached(cjk, '主题召回边界怎么改', 23))).toEqual(
      shape(findExactRecallEvidence(cjk, '主题召回边界怎么改')),
    );
  });

  test('does not admit NFKC-expanding titles that the uncached scan rejects', () => {
    // U+337F normalizes to "株式会社" (1 → 4 chars). The uncached title branch
    // only consults the normalized comparison when the raw title needs
    // normalization or the length delta is ≤ 2, so this title must NOT match.
    const entries = [entry({ id: 'mem_square_corp', primary_abstraction: '\u337f' })];
    expect(findExactRecallEvidence(entries, '株式会社')).toEqual([]);
    expect(shape(cached(entries, '株式会社', 32))).toEqual([]);
  });

  test('matches the uncached scan on a randomized mixed corpus (deterministic seed)', () => {
    // Deterministic LCG: no wall clock, no Math.random — the corpus is stable.
    let seed = 0x2f6e2b1;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const pick = <T,>(items: T[]): T => items[Math.floor(next() * items.length) % items.length];

    const titlePool = [
      'Proactive Topic Recall',
      'proactive   topic recall',
      'Alpha Beta Gamma',
      '缓存索引重建',
      'exact evidence index cache',
      '\u337f',
      '',
    ];
    const cuePool = [
      '5cd9885f5',
      'proactive topic',
      'proactive topic', // duplicated in the pool → DF pressure
      'topic recall',
      '缓存索引重建',
      '缓存索引重',
      'topic',
      'synthetic-anchor-alpha',
      'synthetic_anchor_beta',
      'a-very-long-cue-that-will-not-cover-the-query-at-all',
      '',
    ];

    const entries: any[] = [];
    // Duplicate ids on purpose: legacy index files can carry them.
    for (let i = 0; i < 220; i++) {
      const cueCount = 1 + Math.floor(next() * 4);
      const cues: string[] = [];
      for (let c = 0; c < cueCount; c++) cues.push(pick(cuePool));
      const overrides: Record<string, any> = {
        id: `mem_${i % 37}`,
        primary_abstraction: pick(titlePool),
        cue_anchors: cues,
      };
      const roll = next();
      if (roll < 0.12) overrides.superseded_by = 'mem_replacement';
      else if (roll < 0.2) overrides.retracted = true;
      else if (roll < 0.32) overrides.type = 'episodic';
      else if (roll < 0.38) {
        overrides.type = 'episodic';
        overrides.pinned = true;
      } else if (roll < 0.44) {
        overrides.type = 'episodic';
        overrides.sticky_until = '2099-01-01T00:00:00.000Z';
      }
      entries.push(entry(overrides));
    }

    const queries = [
      'Proactive Topic Recall',
      'proactive   topic recall',
      'proactive topic',
      'topic recall design',
      '5cd9885f5',
      '缓存索引重建怎么改',
      '缓存索引重',
      'synthetic-anchor-alpha and more words here',
      'alpha beta gamma',
      '株式会社',
      'nothing matches this at all',
    ];
    for (const query of queries) {
      for (const limit of [1, 3, 10]) {
        expect(shape(cached(entries, query, 31, limit))).toEqual(
          shape(findExactRecallEvidence(entries, query, limit)),
        );
      }
    }
  });

  test('warm cache is under half the uncached scan cost on a synthetic subset', () => {
    const entries: any[] = [];
    for (let i = 0; i < 3000; i++) {
      entries.push(
        entry({
          id: `mem_syn_${i}`,
          primary_abstraction: `Synthetic memory ${i} about deployment pipelines and rollbacks`,
          cue_anchors: [
            `synthetic-anchor-${i}-alpha`,
            `synthetic_anchor_${i}_beta`,
            `cue${i}-gamma-delta`,
            `epsilon${i}-zeta`,
            `theta-${i}-iota-kappa`,
            `lambda${i}-mu`,
          ],
        }),
      );
    }
    entries.push(entry({ id: 'mem_target_cue', cue_anchors: ['proactive topic'] }));
    const query = 'Proactive Topic Recall 主题工具设计';

    const timeMs = (fn: () => void): number => {
      const start = process.hrtime.bigint();
      fn();
      return Number(process.hrtime.bigint() - start) / 1e6;
    };
    const median = (values: number[]): number => values.slice().sort((a, b) => a - b)[1];

    // Warm the per-anchor normalization cache so both paths measure scans, not
    // first-touch normalization. The cached path's build is measured separately
    // by the build-count tests above; a warm index is the steady state.
    findExactRecallEvidence(entries, query, 10);
    resetExactEvidenceCacheForTest();
    cached(entries, query, 24);

    const uncachedMs = median([
      timeMs(() => findExactRecallEvidence(entries, query, 10)),
      timeMs(() => findExactRecallEvidence(entries, query, 10)),
      timeMs(() => findExactRecallEvidence(entries, query, 10)),
    ]);
    const cachedMs = median([
      timeMs(() => cached(entries, query, 24)),
      timeMs(() => cached(entries, query, 24)),
      timeMs(() => cached(entries, query, 24)),
    ]);

    expect(exactEvidenceCacheStatsForTest().builds).toBe(1);
    expect(cachedMs).toBeLessThan(uncachedMs * 0.5);
  }, 30000);
});

describe('recall route wiring', () => {
  test('passes the live search version into the exact-evidence scan', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../src/routes/recall.ts'),
      'utf8',
    );
    const versionCallStart = source.indexOf('getSearchVersion()');
    expect(versionCallStart).toBeGreaterThan(-1);
    const callStart = source.indexOf('findExactRecallEvidence(');
    expect(callStart).toBeGreaterThan(versionCallStart);
    // The version must be read in the same scan block (not some unrelated
    // getter call elsewhere in the file) and handed to the scan.
    expect(callStart - versionCallStart).toBeLessThan(800);
    expect(source.slice(callStart, callStart + 400)).toContain('searchVersion');
  });
});
