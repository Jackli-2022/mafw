import { RetrievalEventBuffer, recordRetrievalFromScored } from '../../../../src/core/memory/retrieval-events';

const DAY = 24 * 60 * 60 * 1000;

describe('RetrievalEventBuffer', () => {
  it('records and drains events, clearing the buffer', () => {
    const b = new RetrievalEventBuffer();
    b.record({ id: 'm1', prob: 0.9, kind: 'recall', ts: 1000 });
    b.record({ id: 'm2', prob: 0.4, kind: 'search', ts: 2000 });
    const drained = b.drain();
    expect(drained).toHaveLength(2);
    expect(drained[0].id).toBe('m1');
    expect(b.drain()).toHaveLength(0);
  });

  it('is bounded — oldest events dropped beyond maxEvents', () => {
    const b = new RetrievalEventBuffer(100);
    for (let i = 0; i < 150; i++) b.record({ id: `m${i}`, prob: 1, kind: 'recall', ts: i });
    const drained = b.drain();
    expect(drained).toHaveLength(100);
    expect(drained[0].id).toBe('m50'); // oldest kept is the 51st record
  });

  it('needFor counts hits within 7 days, prunes older ones, and survives drain', () => {
    const b = new RetrievalEventBuffer();
    const now = Date.now();
    b.record({ id: 'm1', prob: 1, kind: 'recall', ts: now - DAY });
    b.record({ id: 'm1', prob: 1, kind: 'recall', ts: now - 2 * DAY });
    b.record({ id: 'm2', prob: 1, kind: 'recall', ts: now - 9 * DAY });
    b.drain();
    expect(b.needFor('m1')).toBe(2);
    expect(b.needFor('m2')).toBe(0);
    expect(b.needFor('unknown')).toBe(0);
  });

  it('record never throws on bad input (fail-open)', () => {
    const b = new RetrievalEventBuffer();
    expect(() => b.record(null as any)).not.toThrow();
    expect(() => b.record(undefined as any)).not.toThrow();
    expect(() => b.record({ id: '', prob: NaN, kind: 'recall', ts: NaN })).not.toThrow();
    expect(b.drain()).toHaveLength(0);
  });

  it('clear resets both events and need index', () => {
    const b = new RetrievalEventBuffer();
    b.record({ id: 'm1', prob: 1, kind: 'recall', ts: Date.now() });
    b.clear();
    expect(b.drain()).toHaveLength(0);
    expect(b.needFor('m1')).toBe(0);
  });

  it('stats() reports pending events and need-tracked ids', () => {
    const b = new RetrievalEventBuffer();
    b.record({ id: 'm1', prob: 1, kind: 'recall', ts: Date.now() });
    b.record({ id: 'm1', prob: 1, kind: 'recall', ts: Date.now() });
    b.record({ id: 'm2', prob: 1, kind: 'search', ts: Date.now() });
    expect(b.stats()).toEqual({ pending: 3, needTracked: 2 });
    b.drain();
    expect(b.stats()).toEqual({ pending: 0, needTracked: 2 }); // need survives drain
  });
});

describe('recordRetrievalFromScored', () => {
  it('maps scored entries into the given buffer with per-entry probabilities', () => {
    const b = new RetrievalEventBuffer();
    recordRetrievalFromScored(
      [{ entry: { id: 'a' } }, { entry: { id: 'b' } }] as any,
      'recall',
      (s: any) => (s.entry.id === 'a' ? 0.9 : undefined),
      b,
    );
    const drained = b.drain();
    expect(drained.map((e) => e.id)).toEqual(['a', 'b']);
    expect(drained[0].prob).toBe(0.9);
    expect(drained[1].prob).toBe(1); // missing prob → full weight
    expect(drained[0].kind).toBe('recall');
  });

  it('never throws on null scored list (fail-open)', () => {
    const b = new RetrievalEventBuffer();
    expect(() => recordRetrievalFromScored(null as any, 'search', undefined, b)).not.toThrow();
    expect(() =>
      recordRetrievalFromScored([{ entry: null }] as any, 'search', undefined, b),
    ).not.toThrow();
  });
});
