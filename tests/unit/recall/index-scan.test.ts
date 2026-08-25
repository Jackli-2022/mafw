import {
  formatEntryForIndex,
  formatIndexForScan,
  parseScanResponse,
  resolveShortIds,
} from '../../../gateway/src/recall/index-scan';

describe('formatEntryForIndex', () => {
  test('formats entry with all fields', () => {
    const entry = {
      id: 'mem_1787034869182_mm45lj',
      type: 'semantic',
      primary_abstraction: 'serve sidecar health polling',
      cue_anchors: ['serve', 'sidecar', 'watchdog'],
      energy: 0.8,
      created_at: '2026-08-18T06:34:29.182Z',
    };
    const line = formatEntryForIndex(entry);
    expect(line).toContain('[id:mem_17870348');
    expect(line).toContain('(2026-08-18)');
    expect(line).toContain('semantic');
    expect(line).toContain('serve sidecar health polling');
    expect(line).toContain('serve, sidecar, watchdog');
  });

  test('handles missing fields gracefully', () => {
    const line = formatEntryForIndex({});
    expect(line).toContain('[id:?]');
    expect(line).toContain('(unknown)');
    expect(line).toContain('unknown');
  });

  test('preserves full abstraction for model relevance', () => {
    const long = 'a'.repeat(400);
    const entry = {
      id: 'mem_123',
      primary_abstraction: long,
      cue_anchors: [],
      energy: 0.5,
      created_at: '2026-01-01T00:00:00Z',
    };
    const line = formatEntryForIndex(entry);
    expect(line).toContain(long);
  });
});

describe('formatIndexForScan', () => {
  test('formats index entries sorted by date ascending (append-only)', () => {
    const index: any = {
      getIndex: () => ({
        entries: [
          { id: 'old', type: 'semantic', primary_abstraction: 'old entry', cue_anchors: [], energy: 0.5, created_at: '2026-01-01T00:00:00Z' },
          { id: 'new', type: 'semantic', primary_abstraction: 'new entry', cue_anchors: [], energy: 0.8, created_at: '2026-08-01T00:00:00Z' },
        ],
      }),
    };
    const text = formatIndexForScan(index);
    expect(text).toContain('# Memory Index');
    // Old entry should appear before new entry (append-only order)
    const oldIdx = text.indexOf('old entry');
    const newIdx = text.indexOf('new entry');
    expect(oldIdx).toBeLessThan(newIdx);
  });

  test('excludes superseded entries', () => {
    const index: any = {
      getIndex: () => ({
        entries: [
          { id: 'active', type: 'semantic', primary_abstraction: 'active', cue_anchors: [], energy: 0.8, created_at: '2026-08-01T00:00:00Z' },
          { id: 'old', type: 'semantic', primary_abstraction: 'superseded', cue_anchors: [], energy: 0.4, created_at: '2026-01-01T00:00:00Z', superseded_by: 'active' },
        ],
      }),
    };
    const text = formatIndexForScan(index);
    expect(text).toContain('# Memory Index');
    expect(text).not.toContain('superseded');
  });

  test('append-only: adding entries preserves the existing text as a prefix', () => {
    const base = [
      { id: 'e1', type: 'semantic', primary_abstraction: 'first', cue_anchors: [], created_at: '2026-01-01T00:00:00Z' },
      { id: 'e2', type: 'semantic', primary_abstraction: 'second', cue_anchors: [], created_at: '2026-02-01T00:00:00Z' },
    ];
    const before = formatIndexForScan({ getIndex: () => ({ entries: base }) } as any);
    const after = formatIndexForScan({
      getIndex: () => ({
        entries: [...base, { id: 'e3', type: 'semantic', primary_abstraction: 'third', cue_anchors: [], created_at: '2026-03-01T00:00:00Z' }],
      }),
    } as any);
    // The whole point of the cache-first design: after new writes, the
    // refreshed text shares the entire previous text as a prefix, so the
    // provider prompt cache keeps hitting after hourly refreshes.
    expect(after.startsWith(before)).toBe(true);
  });

  test('no volatile fields: same entries with different energy produce identical text', () => {
    const mk = (energy: number) => ({
      getIndex: () => ({
        entries: [{ id: 'e1', type: 'semantic', primary_abstraction: 'x', cue_anchors: [], energy, created_at: '2026-01-01T00:00:00Z' }],
      }),
    });
    expect(formatIndexForScan(mk(0.9) as any)).toBe(formatIndexForScan(mk(0.3) as any));
  });
});

describe('parseScanResponse', () => {
  test('parses valid JSON response', () => {
    const result = parseScanResponse('{"relevant_ids": ["mem_123", "mem_456"], "confidence": 0.8, "reasoning": "relevant"}');
    expect(result).toEqual({
      relevantIds: ['mem_123', 'mem_456'],
      confidence: 0.8,
      reasoning: 'relevant',
    });
  });

  test('strips markdown fences', () => {
    const result = parseScanResponse('```json\n{"relevant_ids": ["mem_123"], "confidence": 0.9}\n```');
    expect(result?.relevantIds).toEqual(['mem_123']);
  });

  test('returns null for invalid JSON', () => {
    expect(parseScanResponse('not json')).toBeNull();
    expect(parseScanResponse('')).toBeNull();
    expect(parseScanResponse(null as any)).toBeNull();
  });

  test('returns null when relevant_ids is not an array', () => {
    expect(parseScanResponse('{"confidence": 0.5}')).toBeNull();
  });

  test('filters non-string IDs', () => {
    const result = parseScanResponse('{"relevant_ids": ["mem_123", 42, null, "mem_456"], "confidence": 0.5}');
    expect(result?.relevantIds).toEqual(['mem_123', 'mem_456']);
  });
});

describe('resolveShortIds', () => {
  test('resolves short IDs to full IDs', () => {
    const index: any = {
      getIndex: () => ({
        entries: [
          { id: 'mem_1787034869182_mm45lj' },
          { id: 'mem_1787034869183_ab12cd' },
        ],
      }),
    };
    const resolved = resolveShortIds(['mem_17870348', 'mem_1787034869183'], index);
    expect(resolved).toEqual(['mem_1787034869182_mm45lj', 'mem_1787034869183_ab12cd']);
  });

  test('skips unmatched IDs', () => {
    const index: any = {
      getIndex: () => ({ entries: [{ id: 'mem_123' }] }),
    };
    const resolved = resolveShortIds(['mem_123', 'mem_999'], index);
    expect(resolved).toEqual(['mem_123']);
  });
});
