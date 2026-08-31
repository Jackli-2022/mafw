import { MinHashMerger } from '../../src/core/memory/minhash-merger';

describe('MinHashMerger', () => {
  let merger: MinHashMerger;

  beforeEach(() => {
    merger = new MinHashMerger();
  });

  describe('normalizeForDedup', () => {
    test('lowercases and strips punctuation', () => {
      expect(MinHashMerger.normalizeForDedup('Hello, World!')).toBe('hello world');
    });

    test('collapses whitespace', () => {
      expect(MinHashMerger.normalizeForDedup('foo   bar   baz')).toBe('foo bar baz');
    });

    test('preserves CJK characters', () => {
      expect(MinHashMerger.normalizeForDedup('用户偏好中文回复')).toBe('用户偏好中文回复');
    });

    test('strips special characters but keeps alphanumeric', () => {
      expect(MinHashMerger.normalizeForDedup('test-case_v2.0')).toBe('testcasev20');
    });

    test('empty string returns empty', () => {
      expect(MinHashMerger.normalizeForDedup('')).toBe('');
    });
  });

  describe('generateSignature', () => {
    test('produces 8-element signature', () => {
      const sig = merger.generateSignature('memory-curator agent definition');
      expect(sig).toHaveLength(8);
    });

    test('identical normalized texts produce identical signatures', () => {
      const sig1 = merger.generateSignature('Memory-Curator Agent Definition');
      const sig2 = merger.generateSignature('memory-curator agent definition');
      expect(sig1).toEqual(sig2);
    });

    test('different texts produce different signatures', () => {
      const sig1 = merger.generateSignature('memory-curator agent definition');
      const sig2 = merger.generateSignature('completely unrelated topic about cooking');
      expect(sig1).not.toEqual(sig2);
    });
  });

  describe('similarity', () => {
    test('identical signatures return 1.0', () => {
      const sig = merger.generateSignature('test text');
      expect(merger.similarity(sig, sig)).toBe(1.0);
    });

    test('completely different signatures return low similarity', () => {
      const sig1 = merger.generateSignature('aaaa bbbb cccc');
      const sig2 = merger.generateSignature('xxxx yyyy zzzz');
      expect(merger.similarity(sig1, sig2)).toBeLessThan(0.5);
    });
  });

  describe('merge - exact duplicate detection', () => {
    function makeMockIndex(entries: Array<{ id: string; pa: string; superseded?: boolean; merged?: number }>) {
      return {
        getIndex: () => ({
          version: 2,
          updated_at: new Date().toISOString(),
          entries: entries.map(e => ({
            id: e.id,
            type: 'semantic' as const,
            primary_abstraction: e.pa,
            cue_anchors: [],
            tier: 'semantic',
            energy: 0.8,
            filePath: `memory/semantic/${e.id}.md`,
            created_at: new Date().toISOString(),
            superseded_by: e.superseded ? 'some_id' : undefined,
            merged_from: e.merged ? Array(e.merged).fill('x') : undefined,
          })),
        }),
        save: () => {},
      };
    }

    test('catches exact normalized duplicates with different casing', async () => {
      const index = makeMockIndex([{
        id: 'old_1',
        pa: 'Memory-Curator Agent Definition With Restricted Tool Whitelist',
      }]);
      const store = {
        read: async (id: string) => ({
          id,
          type: 'semantic' as const,
          primary_abstraction: 'Memory-Curator Agent Definition With Restricted Tool Whitelist',
          cue_anchors: [],
          memory_value: 'some content',
          energy: 0.8,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        deleteSync: () => true,
        markSuperseded: () => true,
      };

      const unit = {
        id: 'new_1',
        type: 'semantic' as const,
        primary_abstraction: 'memory-curator agent definition with restricted tool whitelist',
        cue_anchors: [],
        memory_value: 'some content',
        energy: 0.8,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = await merger.merge(unit as any, index as any, store);
      expect(result.merged_from).toContain('old_1');
    });

    test('catches duplicates with different punctuation', async () => {
      const index = makeMockIndex([{
        id: 'old_2',
        pa: 'memory-curator agent: definition with restricted tool whitelist!',
      }]);
      const store = {
        read: async (id: string) => ({
          id,
          type: 'semantic' as const,
          primary_abstraction: 'memory-curator agent: definition with restricted tool whitelist!',
          cue_anchors: [],
          memory_value: 'content',
          energy: 0.8,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        deleteSync: () => true,
        markSuperseded: () => true,
      };

      const unit = {
        id: 'new_2',
        type: 'semantic' as const,
        primary_abstraction: 'memory-curator agent definition with restricted tool whitelist',
        cue_anchors: [],
        memory_value: 'content',
        energy: 0.8,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = await merger.merge(unit as any, index as any, store);
      expect(result.merged_from).toContain('old_2');
    });

    test('does NOT merge when normalized text is empty', async () => {
      const index = makeMockIndex([{ id: 'old_3', pa: '!!@@##' }]);
      const store = {
        read: async (id: string) => ({
          id, type: 'semantic' as const, primary_abstraction: '!!@@##',
          cue_anchors: [], memory_value: 'x', energy: 0.8,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }),
        deleteSync: () => true,
        markSuperseded: () => true,
      };

      const unit = {
        id: 'new_3', type: 'semantic' as const,
        primary_abstraction: '$$%%^^',
        cue_anchors: [], memory_value: 'y', energy: 0.8,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };

      const result = await merger.merge(unit as any, index as any, store);
      expect(result.merged_from).toBeUndefined();
    });

    test('skips already superseded entries', async () => {
      const index = makeMockIndex([{
        id: 'old_4',
        pa: 'memory-curator agent definition with restricted tool whitelist',
        superseded: true,
      }]);
      const store = {
        read: async () => null,
        deleteSync: () => true,
        markSuperseded: () => true,
      };

      const unit = {
        id: 'new_4', type: 'semantic' as const,
        primary_abstraction: 'memory-curator agent definition with restricted tool whitelist',
        cue_anchors: [], memory_value: 'content', energy: 0.8,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };

      const result = await merger.merge(unit as any, index as any, store);
      expect(result.merged_from).toBeUndefined();
    });

    test('skips deeply merged entries (depth >= 3)', async () => {
      const index = makeMockIndex([{
        id: 'old_5',
        pa: 'memory-curator agent definition with restricted tool whitelist',
        merged: 3,
      }]);
      const store = {
        read: async () => null,
        deleteSync: () => true,
        markSuperseded: () => true,
      };

      const unit = {
        id: 'new_5', type: 'semantic' as const,
        primary_abstraction: 'memory-curator agent definition with restricted tool whitelist',
        cue_anchors: [], memory_value: 'content', energy: 0.8,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };

      const result = await merger.merge(unit as any, index as any, store);
      expect(result.merged_from).toBeUndefined();
    });

    test('skips self-merge', async () => {
      const index = makeMockIndex([{
        id: 'self',
        pa: 'memory-curator agent definition with restricted tool whitelist',
      }]);
      const store = {
        read: async () => null,
        deleteSync: () => true,
        markSuperseded: () => true,
      };

      const unit = {
        id: 'self', type: 'semantic' as const,
        primary_abstraction: 'memory-curator agent definition with restricted tool whitelist',
        cue_anchors: [], memory_value: 'content', energy: 0.8,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };

      const result = await merger.merge(unit as any, index as any, store);
      expect(result.merged_from).toBeUndefined();
    });

    test('unit with merged_from bypasses merge entirely', async () => {
      const index = makeMockIndex([{
        id: 'old_6',
        pa: 'exact same text',
      }]);
      const store = {
        read: async () => null,
        deleteSync: () => true,
        markSuperseded: () => true,
      };

      const unit = {
        id: 'new_6', type: 'semantic' as const,
        primary_abstraction: 'exact same text',
        cue_anchors: [], memory_value: 'content', energy: 0.8,
        merged_from: ['some_prev_id'],
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };

      const result = await merger.merge(unit as any, index as any, store);
      expect(result.merged_from).toEqual(['some_prev_id']);
    });

    test('near-variant texts caught by MinHash with 8 seeds', async () => {
      const text1 = 'memory-curator agent definition with restricted tool whitelist and security guardrails';
      const text2 = 'memory-curator agent definition with restricted tool whitelist and security guardrails enabled';

      const sig1 = merger.generateSignature(text1);
      const sig2 = merger.generateSignature(text2);
      const sim = merger.similarity(sig1, sig2);
      expect(sim).toBeGreaterThan(0.625);
    });

    test('dissimilar texts not caught by MinHash', async () => {
      const text1 = 'memory-curator agent definition with restricted tool whitelist';
      const text2 = 'opencode serve sidecar health monitoring watchdog recovery';

      const sig1 = merger.generateSignature(text1);
      const sig2 = merger.generateSignature(text2);
      const sim = merger.similarity(sig1, sig2);
      expect(sim).toBeLessThanOrEqual(0.625);
    });
  });
});
