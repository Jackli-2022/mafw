import { StepInjectState, defaultStepInjectOptions } from '../../../gateway/src/recall/step-inject';

describe('StepInjectState queue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const makeState = () =>
    new StepInjectState({
      ...defaultStepInjectOptions(),
      queueCap: 3,
      intervalMs: 15 * 60 * 1000,
    });

  const inj = (memIds: string[]): any => ({ block: memIds.join(','), memIds, at: Date.now() });

  test('FIFO consumption', () => {
    const state = makeState();
    state.enqueue('s1', inj(['a']));
    state.enqueue('s1', inj(['b']));
    expect(state.consume('s1')?.memIds).toEqual(['a']);
    expect(state.consume('s1')?.memIds).toEqual(['b']);
    expect(state.consume('s1')).toBeNull();
  });

  test('queue cap drops the oldest entry', () => {
    const state = makeState();
    state.enqueue('s1', inj(['a']));
    state.enqueue('s1', inj(['b']));
    state.enqueue('s1', inj(['c']));
    state.enqueue('s1', inj(['d']));
    const first = state.consume('s1');
    expect(first?.memIds).toEqual(['b']); // 'a' was dropped
  });

  test('frequency gate discards the whole queue at once', () => {
    const state = makeState();
    state.enqueue('s1', inj(['a']));
    state.enqueue('s1', inj(['b']));
    state.markInjected('s1', ['x'], 'fp-x'); // sets lastInjectedAt = now

    jest.advanceTimersByTime(14 * 60 * 1000);
    expect(state.consume('s1')).toBeNull(); // still inside the gate → queue dropped

    jest.advanceTimersByTime(2 * 60 * 1000);
    expect(state.consume('s1')).toBeNull(); // nothing left — dropped in one shot
  });

  test('consumes normally once the frequency gate has passed', () => {
    const state = makeState();
    state.enqueue('s1', inj(['a']));
    state.markInjected('s1', ['x'], 'fp-x');

    jest.advanceTimersByTime(16 * 60 * 1000);
    expect(state.consume('s1')?.memIds).toEqual(['a']);
  });

  test('markInjected registers pushed memories; rollbackPushed unregisters them', () => {
    const state = makeState();
    state.markInjected('s1', ['a', 'b'], 'fp');
    expect(state.pushedMemoriesFor('s1').has('a')).toBe(true);
    expect(state.pushedMemoriesFor('s1').has('b')).toBe(true);

    state.rollbackPushed('s1', ['b']);
    expect(state.pushedMemoriesFor('s1').has('b')).toBe(false);
    expect(state.pushedMemoriesFor('s1').has('a')).toBe(true);

    state.rollbackPushed('s1', ['a']);
    expect(state.pushedMemoriesFor('s1').size).toBe(0);
  });

  test('rollback of an unknown ID is a no-op', () => {
    const state = makeState();
    state.rollbackPushed('s1', ['ghost']);
    expect(state.pushedMemoriesFor('s1').size).toBe(0);
  });

  test('sessions are isolated', () => {
    const state = makeState();
    state.enqueue('s1', inj(['a']));
    expect(state.consume('s2')).toBeNull();
    expect(state.consume('s1')?.memIds).toEqual(['a']);
  });
});
