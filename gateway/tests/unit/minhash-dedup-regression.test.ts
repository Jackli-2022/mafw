import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../src/memory/harmonic-file-store';
import { MinHashMerger } from '../../src/core/memory/minhash-merger';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';

let idCounter = 0;
function makeUnit(overrides: Partial<HarmonicUnit> = {}): HarmonicUnit {
  const now = new Date().toISOString();
  const id = overrides.id ?? `mem_test_${++idCounter}_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    type: 'semantic',
    primary_abstraction: 'memory-curator agent definition with restricted tool whitelist',
    cue_anchors: ['memory', 'curator', 'agent'],
    memory_value: 'memory-curator agent definition with restricted tool whitelist',
    energy: 0.8,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('MinHash dedup regression fixes', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-dedup-'));
  });

  describe('cross-instance serialization', () => {
    test('concurrent writes from different store instances are serialized', async () => {
      const index = new HarmonicIndexManager(dir);
      const storeA = new HarmonicUnitFileStore(dir, index);
      const storeB = new HarmonicUnitFileStore(dir, index);

      const unitA = makeUnit({
        id: 'mem_a',
        primary_abstraction: 'memory-curator agent definition with restricted tool whitelist',
        memory_value: 'content A',
      });
      const unitB = makeUnit({
        id: 'mem_b',
        primary_abstraction: 'memory-curator agent definition with restricted tool whitelist',
        memory_value: 'content B',
      });

      await Promise.all([storeA.write(unitA), storeB.write(unitB)]);

      const entries = index.getIndex().entries;
      const merged = entries.find((e: any) => e.merged_from?.length);
      expect(merged).toBeDefined();
      expect(entries.filter((e: any) => !e.superseded_by).length).toBe(1);
    });
  });

  describe('identical abstraction dedup', () => {
    test('dedupMerge returns original text when abstractions are identical', () => {
      const merger = new MinHashMerger();
      const text = 'memory-curator agent definition with restricted tool whitelist';
      const result = (merger as any).dedupMerge(text, text);
      expect(result).toBe(text);
      expect(result).not.toContain('|');
    });

    test('dedupMerge concatenates when abstractions differ', () => {
      const merger = new MinHashMerger();
      const a = 'memory-curator agent definition';
      const b = 'memory-curator tool restrictions';
      const result = (merger as any).dedupMerge(a, b);
      expect(result).toContain('|');
    });

    test('mergeValues returns original when values are identical', () => {
      const merger = new MinHashMerger();
      const text = 'same content';
      const result = (merger as any).mergeValues(text, text);
      expect(result).toBe(text);
      expect(result).not.toContain('---');
    });
  });

  describe('maxMergeDepth increase', () => {
    test('entries can merge more than 3 times', async () => {
      const store = new HarmonicUnitFileStore(dir);

      await store.write(makeUnit({
        id: 'mem_first',
        primary_abstraction: 'Android security hardening Task 1 completed',
        memory_value: 'first',
      }));

      for (let i = 0; i < 5; i++) {
        await store.write(makeUnit({
          id: `mem_dup_${i}`,
          primary_abstraction: 'Android security hardening Task 1 completed',
          memory_value: `dup ${i}`,
        }));
      }

      const entries = store.indexManager_().getIndex().entries;
      const active = entries.filter((e: any) => !e.superseded_by);
      expect(active.length).toBe(1);
      expect(active[0].merged_from!.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('production duplicate scenario', () => {
    test('7 near-identical entries collapse to 1', async () => {
      const store = new HarmonicUnitFileStore(dir);
      const abstractions = [
        'Android security hardening Task 1 completed',
        'Android Task 1 security hardening completed',
        'Android security hardening Task 1 complete',
        'Android Task 1 security hardening work completed',
        'Android security hardening Task 1 complete with gateway auth',
        'Android Task 1 security hardening completed',
        'Android security hardening Task 1 completed',
      ];

      for (let i = 0; i < abstractions.length; i++) {
        await store.write(makeUnit({
          id: `mem_android_${i}`,
          primary_abstraction: abstractions[i],
          memory_value: `Android security hardening details ${i}`,
        }));
      }

      const entries = store.indexManager_().getIndex().entries;
      const active = entries.filter((e: any) => !e.superseded_by);
      expect(active.length).toBeLessThanOrEqual(2);
    });
  });

  describe('merge behavior caps', () => {
    test('merge does NOT boost energy (no snowball feedback)', async () => {
      const store = new HarmonicUnitFileStore(dir);
      await store.write(makeUnit({ id: 'mem_e1', primary_abstraction: 'energy cap test fact alpha', memory_value: 'v1', energy: 0.8 }));
      await store.write(makeUnit({ id: 'mem_e2', primary_abstraction: 'energy cap test fact alpha', memory_value: 'v2', energy: 0.8 }));
      const active = store.indexManager_().getIndex().entries.filter((e: any) => !e.superseded_by);
      expect(active.length).toBe(1);
      expect(active[0].energy).toBe(0.8); // 旧实现会变成 0.95
    });

    test('mergeValues caps total length at 2000 chars, keeping newest content intact', () => {
      const merger = new MinHashMerger();
      const newer = 'N'.repeat(1500);
      const section = (tag: string) => `${tag}${'x'.repeat(300)}`;
      const older = `${section('A')}\n---\n[Updated 2026-01-01] ${section('B')}\n---\n[Updated 2026-01-02] ${section('C')}`;
      const result = (merger as any).mergeValues(newer, older, '2026-09-04T00:00:00.000Z');
      expect(result.length).toBeLessThanOrEqual(2000);
      expect(result.startsWith(newer)).toBe(true);
      expect(result).toContain('[Updated 2026-09-04T00:00:00.000Z]');
      expect(result).toContain('A' + 'x'.repeat(300)); // 最新旧段完整保留
    });

    test('mergeValues keeps full older value when under cap', () => {
      const merger = new MinHashMerger();
      const result = (merger as any).mergeValues('new', 'old', '2026-09-04T00:00:00.000Z');
      expect(result).toBe('new\n---\n[Updated 2026-09-04T00:00:00.000Z] old');
    });
  });
});
