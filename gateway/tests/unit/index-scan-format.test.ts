import { formatEntryForIndex, hashText } from '../../src/recall/index-scan';

const base = {
  id: 'mem_1788000000000_abc123',
  created_at: '2026-08-01T00:00:00Z',
  type: 'semantic',
  primary_abstraction: '长'.repeat(150),
  cue_anchors: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
};

describe('formatEntryForIndex truncation opts (Step 4 index slimming)', () => {
  test('default (no opts) keeps current behavior: full abstraction + 5 anchors', () => {
    const line = formatEntryForIndex(base as any);
    expect(line).toContain('长'.repeat(150));
    expect(line).toContain('a1, a2, a3, a4, a5');
    expect(line).not.toContain('a6');
  });

  test('absCap truncates long abstractions with an ellipsis', () => {
    const line = formatEntryForIndex(base as any, { absCap: 60 });
    expect(line).toContain('长'.repeat(60) + '…');
    expect(line).not.toContain('长'.repeat(61));
  });

  test('absCap leaves short abstractions untouched (no ellipsis)', () => {
    const line = formatEntryForIndex({ ...base, primary_abstraction: '短摘要' } as any, { absCap: 60 });
    expect(line).toContain('| 短摘要 |');
    expect(line).not.toContain('…');
  });

  test('anchorCap slices the anchor list', () => {
    const line = formatEntryForIndex(base as any, { anchorCap: 2 });
    expect(line).toContain('a1, a2');
    expect(line).not.toContain('a3');
  });

  test('combined caps compose', () => {
    const line = formatEntryForIndex(base as any, { absCap: 40, anchorCap: 1 });
    expect(line).toContain('长'.repeat(40) + '…');
    expect(line).toContain('anchors: a1');
    expect(line.length).toBeLessThan(120);
  });
});

describe('hashText', () => {
  test('stable, 8-hex, input-sensitive', () => {
    expect(hashText('index text')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashText('index text')).toBe(hashText('index text'));
    expect(hashText('index text')).not.toBe(hashText('index texu'));
  });
});
