import { TtlMap } from '../../../gateway/src/recall/ttl-map';

describe('TtlMap', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns value within TTL and undefined after expiry', () => {
    const map = new TtlMap<string, number>(1000);
    map.set('a', 1);
    expect(map.get('a')).toBe(1);
    expect(map.has('a')).toBe(true);

    jest.advanceTimersByTime(1001);
    expect(map.get('a')).toBeUndefined();
    expect(map.has('a')).toBe(false);
  });

  test('expired entry is lazily removed (size shrinks on access)', () => {
    const map = new TtlMap<string, number>(1000);
    map.set('a', 1);
    jest.advanceTimersByTime(1001);
    expect(map.size()).toBe(1);
    map.get('a');
    expect(map.size()).toBe(0);
  });

  test('per-key TTL overrides the default', () => {
    const map = new TtlMap<string, number>(1000);
    map.set('a', 1, 5000);
    jest.advanceTimersByTime(3000);
    expect(map.get('a')).toBe(1);
  });

  test('sweep removes all expired entries and returns the count', () => {
    const map = new TtlMap<string, number>(1000);
    map.set('a', 1);
    map.set('b', 2);
    jest.advanceTimersByTime(1500);
    map.set('c', 3); // fresh
    expect(map.sweep()).toBe(2);
    expect(map.size()).toBe(1);
    expect(map.get('c')).toBe(3);
  });

  test('delete removes an entry', () => {
    const map = new TtlMap<string, number>(1000);
    map.set('a', 1);
    expect(map.delete('a')).toBe(true);
    expect(map.has('a')).toBe(false);
    expect(map.delete('a')).toBe(false);
  });

  test('holds objects/sets (non-primitive values)', () => {
    const map = new TtlMap<string, Set<string>>(1000);
    map.set('s', new Set(['x']));
    const set = map.get('s');
    expect(set?.has('x')).toBe(true);
  });

  test('default TTL of 24h expires after a day', () => {
    const map = new TtlMap<string, number>();
    map.set('a', 1);
    jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(map.get('a')).toBeUndefined();
  });

  test('getAndTouch refreshes the TTL', () => {
    const map = new TtlMap<string, number>(1000);
    map.set('a', 1);
    jest.advanceTimersByTime(900);
    expect(map.getAndTouch('a')).toBe(1);
    jest.advanceTimersByTime(900);
    expect(map.get('a')).toBe(1); // survived thanks to the touch
    jest.advanceTimersByTime(200);
    expect(map.get('a')).toBeUndefined();
  });

  test('onEvict fires on delete, sweep and clear', () => {
    const evicted: string[] = [];
    const map = new TtlMap<string, number>(1000, { onEvict: (k, v) => evicted.push(`${k}=${v}`) });
    map.set('a', 1);
    map.set('b', 2);
    map.delete('a');
    jest.advanceTimersByTime(1500);
    map.sweep(); // b expired
    map.set('c', 3);
    map.clear(); // c evicted
    expect(evicted.sort()).toEqual(['a=1', 'b=2', 'c=3']);
  });

  test('onEvict fires when an entry expires on access (resource release)', () => {
    const evicted: string[] = [];
    const map = new TtlMap<string, number>(1000, { onEvict: (k) => evicted.push(String(k)) });
    map.set('a', 1);
    jest.advanceTimersByTime(1500);
    map.get('a'); // expired → removed → onEvict
    expect(evicted).toEqual(['a']);
  });
});
