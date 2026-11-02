import { describe, expect, test } from 'bun:test';
import { createExperienceStore } from './experience-store';

function response(actions: Record<string, any>, version = '2026.11.0') {
  return { experienceVersion: version, actions };
}

describe('experience store', () => {
  test('loading is distinct from unsupported', async () => {
    let release: (value: any) => void = () => {};
    const store = createExperienceStore(() => new Promise((resolve) => { release = resolve; }));
    const pending = store.load('s1');
    expect(store.state().status).toBe('loading');
    expect(store.isEnabled('prompt.steer')).toBe(false);
    release(response({ 'prompt.steer': { enabled: true } }));
    await pending;
    expect(store.state().status).toBe('ready');
    expect(store.isEnabled('prompt.steer')).toBe(true);
  });

  test('whenReady waits for an in-flight load instead of treating it as unavailable', async () => {
    let release: (value: any) => void = () => {};
    const store = createExperienceStore(() => new Promise((resolve) => { release = resolve; }));
    const load = store.load('s1');
    const ready = store.whenReady();
    release(response({ 'session.background': { enabled: true } }));
    await ready;
    await load;
    expect(store.state().status).toBe('ready');
    expect(store.isEnabled('session.background')).toBe(true);
  });

  test('old gateway 404 becomes unavailable compatibility state', async () => {
    const store = createExperienceStore(async () => { throw Object.assign(new Error('not found'), { status: 404 }); });
    await store.load('s1');
    expect(store.state().status).toBe('unavailable');
    expect(store.isEnabled('mcp.manage')).toBe(false);
  });

  test('runtime switch invalidation prevents a stale response from winning', async () => {
    let firstRelease: (value: any) => void = () => {};
    const calls: Array<(value: any) => void> = [];
    const store = createExperienceStore(() => new Promise((resolve) => {
      calls.push(resolve);
    }));
    const first = store.load('s1');
    store.invalidate();
    const second = store.load('s1');
    calls[1](response({ 'prompt.steer': { enabled: true } }));
    await second;
    firstRelease = calls[0];
    firstRelease(response({ 'prompt.steer': { enabled: false } }));
    await first;
    expect(store.isEnabled('prompt.steer')).toBe(true);
  });
});
