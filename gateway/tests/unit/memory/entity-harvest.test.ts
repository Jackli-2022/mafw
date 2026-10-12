import { extractEntities } from '../../../src/memory/entity-harvest';

describe('V2 ①c mechanical entity harvest', () => {
  it('finds camelCase, PascalCase, ALL_CAPS, quoted strings', () => {
    const out = extractEntities('HarmonicIndexManager uses BM25 with "worker origin" via resolveWorkerOrigin');
    expect(out).toContain('HarmonicIndexManager');
    expect(out).toContain('BM25');
    expect(out).toContain('worker origin');
    expect(out).toContain('resolveWorkerOrigin');
  });

  it('dedupes, preserves order, caps at max', () => {
    const out = extractEntities('FooBar FooBar AlphaBeta GammaDelta EpsilonZeta', { max: 3 });
    expect(out).toEqual(['FooBar', 'AlphaBeta', 'GammaDelta']);
  });

  it('ALL_CAPS with trailing digits extracted; bare 2-char caps filtered', () => {
    const out = extractEntities('BM25 index and AB test and TDD flow');
    expect(out).toContain('BM25');
    expect(out).toContain('TDD');
    expect(out).not.toContain('AB');
  });

  it('CJK runs of length >= 2 extracted (contiguous run = one entity)', () => {
    const out = extractEntities('海马体 负责 模式分离 operation');
    expect(out).toContain('海马体');
    expect(out).toContain('模式分离');
  });
});
