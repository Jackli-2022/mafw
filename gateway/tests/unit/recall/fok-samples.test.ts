/**
 * FOK hit-proxy labeling: injected pointers that the agent later redeems via
 * mafw_get_memory are "hit" evidence for the injection's top1prob — a
 * continuous, label-free labeling loop for the A4 isotonic calibration.
 */
import { joinFokSamples, appendFokEvent, fokSampleStats, FokEvent } from '../../../src/recall/fok-samples';

const MIN = 60_000;

const inj = (ts: number, top1prob: number, ids: string[]): string =>
  JSON.stringify({ e: 'inj', ts, top1prob, zone: 'inject', ids });
const rdm = (ts: number, id: string): string => JSON.stringify({ e: 'rdm', ts, id });

describe('joinFokSamples', () => {

  it('redemption of an injected id within TTL → hit', () => {
    const lines = [
      inj(1000, 0.94, ['a', 'b']),
      rdm(1000 + 3 * MIN, 'a'),
    ];
    expect(joinFokSamples(lines)).toEqual([{ top1prob: 0.94, hit: true }]);
  });

  it('redemption after the TTL window → miss', () => {
    const lines = [
      inj(1000, 0.9, ['a']),
      rdm(1000 + 11 * MIN, 'a'),
    ];
    expect(joinFokSamples(lines)).toEqual([{ top1prob: 0.9, hit: false }]);
  });

  it('no redemption → miss', () => {
    expect(joinFokSamples([inj(1000, 0.5, ['a'])])).toEqual([{ top1prob: 0.5, hit: false }]);
  });

  it('redemption of an id that was never injected does not count', () => {
    const lines = [
      inj(1000, 0.9, ['a']),
      rdm(1000 + MIN, 'other'),
    ];
    expect(joinFokSamples(lines)).toEqual([{ top1prob: 0.9, hit: false }]);
  });

  it('multiple injections: each joins against redemptions in its own window', () => {
    const lines = [
      inj(1000, 0.2, ['x']),
      inj(1000 + 5 * MIN, 0.8, ['y']),
      rdm(1000 + 6 * MIN, 'y'), // inside inj2's window, after inj1's
    ];
    expect(joinFokSamples(lines)).toEqual([
      { top1prob: 0.2, hit: false },
      { top1prob: 0.8, hit: true },
    ]);
  });

  it('skips injections without top1prob (live-path BM25-ratio samples) and malformed lines', () => {
    const lines = [
      JSON.stringify({ e: 'inj', ts: 1000, ids: ['a'] }), // no top1prob
      'not json',
      JSON.stringify({ e: 'other' }),
    ];
    expect(joinFokSamples(lines)).toEqual([]);
  });

  it('custom TTL is respected', () => {
    const lines = [inj(1000, 0.9, ['a']), rdm(1000 + 2 * MIN, 'a')];
    expect(joinFokSamples(lines, { ttlMs: MIN })).toEqual([{ top1prob: 0.9, hit: false }]);
    expect(joinFokSamples(lines, { ttlMs: 5 * MIN })).toEqual([{ top1prob: 0.9, hit: true }]);
  });

  it('inj topic flows through join; legacy lines without topic leave it undefined', () => {
    const lines = [
      JSON.stringify({ e: 'inj', ts: 1000, top1prob: 0.9, zone: 'inject', ids: ['a'], topic: 'gateway' }),
      rdm(1000 + MIN, 'a'),
      JSON.stringify({ e: 'inj', ts: 1000, top1prob: 0.5, zone: 'inject', ids: ['b'] }),
    ];
    const out = joinFokSamples(lines);
    expect(out.find((s) => s.top1prob === 0.9)?.topic).toBe('gateway');
    expect(out.find((s) => s.top1prob === 0.5)?.topic).toBeUndefined();
  });
});

describe('fokSampleStats', () => {
  it('empty log → zeros with null hitRate', () => {
    expect(fokSampleStats([])).toEqual({ injections: 0, redemptions: 0, samples: 0, hitRate: null });
  });

  it('counts events and derives hitRate from the join', () => {
    const lines = [
      inj(1000, 0.9, ['a']),
      inj(2000, 0.2, ['b']),
      rdm(1000 + MIN, 'a'), // hit for inj1
    ];
    expect(fokSampleStats(lines)).toEqual({ injections: 2, redemptions: 1, samples: 2, hitRate: 0.5 });
  });

  it('injections without top1prob count as injections but not calibration samples', () => {
    const lines = [
      JSON.stringify({ e: 'inj', ts: 1000, ids: ['a'] }), // no top1prob
      inj(2000, 0.5, ['b']),
    ];
    expect(fokSampleStats(lines)).toEqual({ injections: 2, redemptions: 0, samples: 1, hitRate: 0 });
  });
});

describe('appendFokEvent', () => {
  it('appends one JSON line and never throws on a bad path', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fok-samples-'));
    const file = path.join(dir, 'fok-samples.jsonl');
    appendFokEvent({ e: 'rdm', ts: 1, id: 'm1' } as FokEvent, file);
    appendFokEvent({ e: 'rdm', ts: 2, id: 'm2' } as FokEvent, file);
    const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('m1');
    expect(() => appendFokEvent({ e: 'rdm', ts: 3, id: 'x' } as FokEvent, path.join(dir, 'nope', 'deep', 'x.jsonl'))).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
