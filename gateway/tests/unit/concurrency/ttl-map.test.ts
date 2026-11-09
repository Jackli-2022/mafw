import { TtlMap } from '../../../src/concurrency/ttl-map';

describe('TtlMap', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('set then get before TTL returns value', () => {
    const map = new TtlMap<string>(1000);
    map.set('key', 'value');
    expect(map.get('key')).toBe('value');
  });

  it('set then get after TTL returns undefined', () => {
    const map = new TtlMap<string>(100);
    map.set('key', 'value');
    jest.advanceTimersByTime(200);
    expect(map.get('key')).toBeUndefined();
  });

  it('sweep removes expired entries and returns count', () => {
    const map = new TtlMap<string>(100);
    map.set('a', '1');
    map.set('b', '2');
    jest.advanceTimersByTime(200);
    map.set('c', '3'); // not expired

    const removed = map.sweep();
    expect(removed).toBe(2);
    expect(map.get('c')).toBe('3');
    expect(map.size()).toBe(1);
  });

  it('sweep does not remove unexpired entries', () => {
    const map = new TtlMap<string>(10000);
    map.set('a', '1');
    map.set('b', '2');

    const removed = map.sweep();
    expect(removed).toBe(0);
    expect(map.size()).toBe(2);
  });

  it('onEvict is called for expired entries', () => {
    const evicted: Array<[string, string]> = [];
    const map = new TtlMap<string>(100, { onEvict: (k, v) => evicted.push([String(k), v]) });
    map.set('key', 'value');
    jest.advanceTimersByTime(200);

    map.get('key'); // lazy expire triggers onEvict
    expect(evicted).toEqual([['key', 'value']]);
  });

  it('delete removes entry immediately and calls onEvict', () => {
    const evicted: Array<[string, string]> = [];
    const map = new TtlMap<string>(10000, { onEvict: (k, v) => evicted.push([String(k), v]) });
    map.set('key', 'value');

    expect(map.delete('key')).toBe(true);
    expect(map.get('key')).toBeUndefined();
    expect(evicted).toEqual([['key', 'value']]);
  });

  it('getAndTouch refreshes TTL', () => {
    const map = new TtlMap<string>(100);
    map.set('key', 'value');

    // Advance 80ms, then touch (refreshes to another 100ms)
    jest.advanceTimersByTime(80);
    expect(map.getAndTouch('key')).toBe('value');

    // Advance 80ms more (total 160ms from set, but only 80ms from touch)
    jest.advanceTimersByTime(80);
    expect(map.get('key')).toBe('value'); // still alive

    // Advance past the refreshed TTL
    jest.advanceTimersByTime(50);
    expect(map.get('key')).toBeUndefined();
  });

  it('per-entry TTL overrides default', () => {
    const map = new TtlMap<string>(10000);
    map.set('short', 'a', 50);
    map.set('long', 'b', 5000);

    jest.advanceTimersByTime(100);
    expect(map.get('short')).toBeUndefined();
    expect(map.get('long')).toBe('b');
  });

  it('clear invokes onEvict for all entries', () => {
    const evicted: string[] = [];
    const map = new TtlMap<string>(10000, { onEvict: (k) => evicted.push(String(k)) });
    map.set('a', '1');
    map.set('b', '2');

    map.clear();
    expect(evicted).toEqual(['a', 'b']);
    expect(map.size()).toBe(0);
  });
});
