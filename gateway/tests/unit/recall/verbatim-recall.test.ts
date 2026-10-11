import {
  t1VectorKey, parseT1Key, groupT1HitsToTurns, excerptFromRows, renderT1Lines, T1Hit,
} from '../../../src/recall/verbatim-recall';

const row = (s: string, t: number, src: string, c: string) => ({ session_id: s, turn_id: t, source: src, content: c });

describe('t1VectorKey / parseT1Key', () => {
  test('roundtrip: parse recovers session and turn', () => {
    const key = t1VectorKey('ses_abc123', 42, 'hello world');
    expect(key.startsWith('ses_abc123:42:')).toBe(true);
    expect(parseT1Key(key)).toEqual({ sessionId: 'ses_abc123', turnId: 42 });
  });
  test('same content → same key (idempotent); different content → different key', () => {
    expect(t1VectorKey('s', 1, 'x')).toBe(t1VectorKey('s', 1, 'x'));
    expect(t1VectorKey('s', 1, 'x')).not.toBe(t1VectorKey('s', 1, 'y'));
  });
  test('garbage key → null', () => {
    expect(parseT1Key('no-colons')).toBeNull();
    expect(parseT1Key('a:b')).toBeNull();
    expect(parseT1Key('a:x:1')).toBeNull();
  });
});

describe('groupT1HitsToTurns', () => {
  test('dedupes rows of the same turn keeping max cosine, sorts desc, caps', () => {
    const k = (s: string, t: number, c: string) => t1VectorKey(s, t, c);
    const hits = [
      { id: k('s1', 1, 'a'), cosine: 0.9 },
      { id: k('s1', 1, 'b'), cosine: 0.5 },   // same turn → suppressed
      { id: k('s1', 2, 'c'), cosine: 0.7 },
      { id: k('s2', 1, 'd'), cosine: 0.8 },
      { id: 'garbage', cosine: 0.99 },          // unparseable → dropped
    ];
    const out = groupT1HitsToTurns(hits, 2);
    expect(out).toEqual([
      { sessionId: 's1', turnId: 1, cosine: 0.9 },
      { sessionId: 's2', turnId: 1, cosine: 0.8 },
    ]);
  });
  test('empty → empty', () => {
    expect(groupT1HitsToTurns([])).toEqual([]);
  });
});

describe('excerptFromRows', () => {
  test('finds the row whose content hash matches the key', () => {
    const rows = [row('s', 1, 'user_input', 'first'), row('s', 1, 'tool_result', 'the matched one')];
    const key = t1VectorKey('s', 1, 'the matched one');
    expect(excerptFromRows(rows, key, 100)).toBe('the matched one');
  });
  test('falls back to first row, truncates to maxChars', () => {
    const rows = [row('s', 1, 'user_input', 'x'.repeat(500))];
    expect(excerptFromRows(rows, 'unmatched:key:0000', 10)).toBe('x'.repeat(10));
  });
  test('no rows → empty string', () => {
    expect(excerptFromRows([], 'k', 10)).toBe('');
  });
});

describe('renderT1Lines', () => {
  const hit = (s: string, t: number, ex: string): T1Hit => ({ sessionId: s, turnId: t, cosine: 0.8, excerpt: ex });
  test('renders pointer lines with tail-6 session id and budget cap', () => {
    const lines = renderT1Lines([hit('ses_PROVIDER123456', 7, 'hello verbatim')], { k: 3, maxChars: 600 });
    expect(lines).toContain('[t1|123456:7]');
    expect(lines).toContain('hello verbatim');
  });
  test('respects total maxChars budget — drops lines that overflow', () => {
    const hits = [hit('s1', 1, 'a'.repeat(300)), hit('s2', 2, 'b'.repeat(300)), hit('s3', 3, 'c'.repeat(300))];
    const lines = renderT1Lines(hits, { k: 3, maxChars: 500 });
    expect(lines.length).toBeLessThanOrEqual(500);
    expect(lines).toContain('a'.repeat(200));
  });
  test('empty hits → empty string', () => {
    expect(renderT1Lines([], { k: 3, maxChars: 600 })).toBe('');
  });
});
