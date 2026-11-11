/**
 * E4-1 TimerService: named long-lived timers with a single ledger.
 * Spec: docs/superpowers/specs/2026-11-11-gateway-e4-resource-ledger-design.md §4.1
 */
import { TimerService } from '../../../src/core/timer-service';

describe('TimerService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('every fires repeatedly until cleared', () => {
    const svc = new TimerService();
    const fn = jest.fn();
    svc.every('tick', 1000, fn);

    jest.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);

    svc.disposeAll();
    jest.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('after fires once and leaves the ledger', () => {
    const svc = new TimerService();
    const fn = jest.fn();
    svc.after('once', 500, fn);

    expect(svc.stats()).toEqual({ active: 1, byName: { once: 1 } });

    jest.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(svc.stats()).toEqual({ active: 0, byName: {} });

    jest.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('live duplicate names throw', () => {
    const svc = new TimerService();
    svc.every('same', 1000, () => {});

    expect(() => svc.every('same', 1000, () => {})).toThrow(/same/);
    expect(() => svc.after('same', 1000, () => {})).toThrow(/same/);
    expect(svc.stats().active).toBe(1);
  });

  test('a name can be reused after clear', () => {
    const svc = new TimerService();
    const first = jest.fn();
    const second = jest.fn();
    const handle = svc.every('same', 1000, first);
    svc.clear(handle);
    svc.every('same', 1000, second);

    jest.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('clear is idempotent', () => {
    const svc = new TimerService();
    const handle = svc.every('x', 1000, () => {});

    expect(() => {
      svc.clear(handle);
      svc.clear(handle);
    }).not.toThrow();
    expect(svc.stats().active).toBe(0);
  });

  test('a stale handle cannot clear a re-registered timer', () => {
    const svc = new TimerService();
    const stale = svc.every('x', 1000, () => {});
    svc.clear(stale);

    const live = jest.fn();
    svc.every('x', 1000, live);
    svc.clear(stale); // stale handle must be a no-op

    jest.advanceTimersByTime(1000);
    expect(live).toHaveBeenCalledTimes(1);
    expect(svc.stats().active).toBe(1);
  });

  test('clearByPrefix clears only matching names and returns the count', () => {
    const svc = new TimerService();
    svc.every('sse:ping:1', 1000, () => {});
    svc.every('sse:ping:2', 1000, () => {});
    svc.every('ws:ping', 1000, () => {});

    expect(svc.clearByPrefix('sse:ping:')).toBe(2);
    expect(svc.stats()).toEqual({ active: 1, byName: { 'ws:ping': 1 } });
    expect(svc.clearByPrefix('nope:')).toBe(0);
  });

  test('disposeAll clears everything and is idempotent', () => {
    const svc = new TimerService();
    const a = jest.fn();
    svc.every('a', 1000, a);
    svc.after('b', 1000, () => {});

    svc.disposeAll();
    svc.disposeAll();

    jest.advanceTimersByTime(5000);
    expect(a).not.toHaveBeenCalled();
    expect(svc.stats()).toEqual({ active: 0, byName: {} });
  });

  test('stats reports active timers by name', () => {
    const svc = new TimerService();
    expect(svc.stats()).toEqual({ active: 0, byName: {} });

    svc.every('a', 1000, () => {});
    svc.every('b', 1000, () => {});
    expect(svc.stats()).toEqual({ active: 2, byName: { a: 1, b: 1 } });
  });

  test('unrefs timers by default so they never hold the process open', () => {
    const fake: any = { unref: jest.fn(), ref: jest.fn(), hasRef: () => false };
    const setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockReturnValue(fake as unknown as NodeJS.Timeout);

    const svc = new TimerService();
    svc.every('tick', 1000, () => {});

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(fake.unref).toHaveBeenCalledTimes(1);
    expect(fake.hasRef()).toBe(false);
  });

  test('opts.unref=false keeps the timer refed', () => {
    const fake: any = { unref: jest.fn(), ref: jest.fn(), hasRef: () => true };
    jest.spyOn(global, 'setTimeout').mockReturnValue(fake as unknown as NodeJS.Timeout);

    const svc = new TimerService();
    svc.after('keepalive', 1000, () => {}, { unref: false });

    expect(fake.unref).not.toHaveBeenCalled();
    expect(fake.hasRef()).toBe(true);
  });

  test('exposes the name on the handle', () => {
    const svc = new TimerService();
    expect(svc.every('named', 1000, () => {}).name).toBe('named');
    expect(svc.after('once', 1000, () => {}).name).toBe('once');
  });
});
