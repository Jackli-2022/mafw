import { Watermark } from '../../../src/concurrency/watermark';

describe('Watermark', () => {
  it('mark returns current counter value', () => {
    const wm = new Watermark();
    expect(wm.mark('key')).toBe(0);
  });

  it('hasActivitySince returns false when no bumps happened', () => {
    const wm = new Watermark();
    const mark = wm.mark('key');
    expect(wm.hasActivitySince('key', mark)).toBe(false);
  });

  it('hasActivitySince returns true after bump', () => {
    const wm = new Watermark();
    const mark = wm.mark('key');
    wm.bump('key');
    expect(wm.hasActivitySince('key', mark)).toBe(true);
  });

  it('multiple bumps are cumulative', () => {
    const wm = new Watermark();
    const mark = wm.mark('key');
    wm.bump('key');
    wm.bump('key');
    wm.bump('key');
    expect(wm.hasActivitySince('key', mark)).toBe(true);

    // Mark after bumps reflects the new baseline
    const mark2 = wm.mark('key');
    expect(mark2).toBe(3);
    expect(wm.hasActivitySince('key', mark2)).toBe(false);

    // One more bump makes it stale again
    wm.bump('key');
    expect(wm.hasActivitySince('key', mark2)).toBe(true);
  });

  it('different keys have independent counters', () => {
    const wm = new Watermark();
    const markA = wm.mark('a');
    const markB = wm.mark('b');

    wm.bump('a');
    expect(wm.hasActivitySince('a', markA)).toBe(true);
    expect(wm.hasActivitySince('b', markB)).toBe(false);
  });

  it('mark after bumps reflects the new baseline', () => {
    const wm = new Watermark();
    wm.bump('key');
    wm.bump('key');

    const mark = wm.mark('key');
    expect(mark).toBe(2);
    expect(wm.hasActivitySince('key', mark)).toBe(false);

    wm.bump('key');
    expect(wm.hasActivitySince('key', mark)).toBe(true);
  });

  it('delete removes a key\'s counter (mark resets to 0)', () => {
    const wm = new Watermark();
    wm.bump('key');
    wm.bump('key');
    expect(wm.mark('key')).toBe(2);

    wm.delete('key');
    expect(wm.mark('key')).toBe(0);
    expect(wm.hasActivitySince('key', 0)).toBe(false);
  });

  it('clear removes all counters', () => {
    const wm = new Watermark();
    wm.bump('a');
    wm.bump('b');
    wm.bump('b');

    wm.clear();
    expect(wm.mark('a')).toBe(0);
    expect(wm.mark('b')).toBe(0);
  });
});
