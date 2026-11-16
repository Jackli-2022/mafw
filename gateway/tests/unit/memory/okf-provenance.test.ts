import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { buildOKF } from '../../../src/memory/okf-writer';
import { parseOKF } from '../../../src/memory/okf-parser';
import { unionSourceTraceIds } from '../../../src/core/memory/provenance';

const unit = (overrides: Partial<HarmonicUnit> = {}): HarmonicUnit => ({
  id: 'mem_1_abc',
  type: 'semantic',
  primary_abstraction: 'provenance test',
  cue_anchors: ['provenance'],
  memory_value: 'body',
  energy: 0.8,
  created_at: '2026-11-10T00:00:00.000Z',
  updated_at: '2026-11-10T00:00:00.000Z',
  ...overrides,
});

describe('OKF source_trace_ids', () => {
  test('roundtrips exact trace ids through frontmatter', () => {
    const text = buildOKF(unit({ source_trace_ids: ['t1t_a', 't1t_b'] }));
    expect(text).toContain('source_trace_ids');
    const parsed = parseOKF(text);
    expect(parsed.unit.source_trace_ids).toEqual(['t1t_a', 't1t_b']);
  });

  test('omits the key for units without provenance', () => {
    const parsed = parseOKF(buildOKF(unit()));
    expect(parsed.unit).not.toHaveProperty('source_trace_ids');
  });
});

describe('OKF episode_id', () => {
  test('roundtrips the episode hint through frontmatter', () => {
    const parsed = parseOKF(
      buildOKF(unit({ source_trace_ids: ['t1t_a'], episode_id: 't1ep_a' })),
    );
    expect(parsed.unit.episode_id).toBe('t1ep_a');
  });

  test('omits the key when the unit is ungrounded', () => {
    const parsed = parseOKF(buildOKF(unit()));
    expect(parsed.unit).not.toHaveProperty('episode_id');
  });
});

describe('HarmonicUnitFileStore provenance', () => {
  test('writes ids to the index entry and reads them back', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-prov-'));
    try {
      const store = new HarmonicUnitFileStore(dir);
      await store.write(unit({ source_trace_ids: ['t1t_a'], episode_id: 't1ep_a' }));
      const entry = store.indexManager_().getIndex().entries.find((e) => e.id === 'mem_1_abc')!;
      expect((entry as any).source_trace_ids).toEqual(['t1t_a']);
      expect((entry as any).episode_id).toBe('t1ep_a');
      const read = await store.read('mem_1_abc');
      expect((read as any).source_trace_ids).toEqual(['t1t_a']);
      expect((read as any).episode_id).toBe('t1ep_a');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rewriting a unit updates its index entry instead of duplicating it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-prov-'));
    try {
      const store = new HarmonicUnitFileStore(dir);
      await store.write(unit({ episode_id: 't1ep_a' }));
      await store.write(unit({ episode_id: 't1ep_b' }));
      const entries = store.indexManager_()
        .getIndex()
        .entries.filter((entry) => entry.id === 'mem_1_abc');
      expect(entries).toHaveLength(1);
      expect((entries[0] as any).episode_id).toBe('t1ep_b');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rewriting a unit preserves fields owned by the existing index entry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-prov-'));
    try {
      const store = new HarmonicUnitFileStore(dir);
      await store.write(unit());
      const entry = store.indexManager_()
        .getIndex()
        .entries.find((item) => item.id === 'mem_1_abc')!;
      (entry as any).last_decay_at = '2026-11-01T00:00:00.000Z';
      (entry as any).custom_field = 'keep';
      await store.write(unit({ episode_id: 't1ep_a' }));
      const updated = store.indexManager_()
        .getIndex()
        .entries.find((item) => item.id === 'mem_1_abc')!;
      expect((updated as any).last_decay_at).toBe('2026-11-01T00:00:00.000Z');
      expect((updated as any).custom_field).toBe('keep');
      expect((updated as any).episode_id).toBe('t1ep_a');
      expect(store.indexManager_().getIndex().entries.filter((item) => item.id === 'mem_1_abc'))
        .toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('unionSourceTraceIds', () => {
  test('unions, dedupes and caps at 20 with incoming ids first', () => {
    const old = Array.from({ length: 15 }, (_, i) => `old_${i}`);
    const incoming = Array.from({ length: 10 }, (_, i) => `new_${i}`);
    const union = unionSourceTraceIds(incoming, old);
    expect(union).toHaveLength(20);
    expect(union.slice(0, 10)).toEqual(incoming);
    expect(new Set(union).size).toBe(20);
  });

  test('keeps undefined when both sides are empty', () => {
    expect(unionSourceTraceIds(undefined, [])).toBeUndefined();
  });
});
