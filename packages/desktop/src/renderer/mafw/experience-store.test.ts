import { describe, expect, test } from 'bun:test';
import { EXPERIENCE_VERSION } from '@mafw/sdk';
import { CLIENT_EXPERIENCE_VERSION, createExperienceStore } from './experience-store';

function response(actions: Record<string, any>, version = '2026.11.1') {
  return { experienceVersion: version, actions };
}

const supported = (extra: Record<string, any> = {}) => ({ supported: true, enabled: true, ...extra });

describe('experience store', () => {
  test('client experience version tracks the SDK contract', () => {
    expect(CLIENT_EXPERIENCE_VERSION).toBe(EXPERIENCE_VERSION);
  });

  test('loading is not unsupported', async () => {
    let release: (value: any) => void = () => {};
    const store = createExperienceStore(() => new Promise((resolve) => { release = resolve; }));
    const pending = store.load('s1');
    expect(store.status()).toBe('loading');
    expect(store.supported('branch.fork')).toBe(false);
    expect(store.enabled('branch.fork')).toBe(false);
    release(response({ 'branch.fork': supported() }));
    await pending;
    expect(store.status()).toBe('ready');
    expect(store.supported('branch.fork')).toBe(true);
    expect(store.enabled('branch.fork')).toBe(true);
  });

  test('supported and enabled are separate: busy stays supported but disabled', async () => {
    const store = createExperienceStore(async () =>
      response({ 'checkpoint.restore': { supported: true, enabled: false, reason: 'busy', semantics: { sessionBacked: true } } }),
    );
    await store.load('s1');
    expect(store.supported('checkpoint.restore')).toBe(true);
    expect(store.enabled('checkpoint.restore')).toBe(false);
    expect(store.semantics('checkpoint.restore')).toEqual({ sessionBacked: true });
  });

  test('unsupported action reports supported=false even if enabled sneaks in', async () => {
    const store = createExperienceStore(async () =>
      response({ 'branch.fork': { supported: false, enabled: true } }),
    );
    await store.load('s1');
    expect(store.supported('branch.fork')).toBe(false);
    expect(store.enabled('branch.fork')).toBe(false);
  });

  test('whenReady waits for an in-flight load instead of treating it as unavailable', async () => {
    let release: (value: any) => void = () => {};
    const store = createExperienceStore(() => new Promise((resolve) => { release = resolve; }));
    const load = store.load('s1');
    const ready = store.whenReady();
    release(response({ 'session.background': supported() }));
    await ready;
    await load;
    expect(store.status()).toBe('ready');
    expect(store.enabled('session.background')).toBe(true);
  });

  test('whenReady times out without rejecting when no load was issued', async () => {
    const store = createExperienceStore(async () => response({}));
    await expect(store.whenReady(10)).resolves.toBeUndefined();
  });

  test('a hung load cannot block whenReady past its budget', async () => {
    const store = createExperienceStore(() => new Promise(() => {}));
    void store.load('s1');
    const started = Date.now();
    await store.whenReady(20);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('old gateway 404 becomes unavailable compatibility state', async () => {
    const store = createExperienceStore(async () => { throw Object.assign(new Error('not found'), { status: 404 }); });
    await store.load('s1');
    expect(store.status()).toBe('unavailable');
    expect(store.enabled('mcp.manage')).toBe(false);
    expect(store.supported('mcp.manage')).toBe(false);
  });

  test('newer gateway min client version becomes incompatible, not ready', async () => {
    const store = createExperienceStore(async () => ({
      experienceVersion: '2027.01.0',
      minClientVersion: '2027.01.0',
      actions: { 'branch.fork': supported() },
    }));
    await store.load('s1');
    expect(store.status()).toBe('incompatible');
    expect(store.supported('branch.fork')).toBe(false);
    expect(store.state().error).toBeTruthy();
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
    calls[1](response({ 'prompt.steer': supported() }));
    await second;
    firstRelease = calls[0];
    firstRelease(response({ 'prompt.steer': { supported: true, enabled: false } }));
    await first;
    expect(store.enabled('prompt.steer')).toBe(true);
  });

  test('invalidate resets the scope so an old session response cannot leak', async () => {
    const store = createExperienceStore(async (sessionID) =>
      response(sessionID === 'a' ? { 'branch.fork': supported() } : {}),
    );
    await store.load('a', { directory: '/repo' });
    expect(store.supported('branch.fork')).toBe(true);
    expect(store.state().directory).toBe('/repo');
    store.invalidate()
    expect(store.status()).toBe('idle');
    expect(store.supported('branch.fork')).toBe(false);
  });

  test('load forwards the directory scope to the loader', async () => {
    const seen: Array<{ sessionID?: string; directory?: string }> = [];
    const store = createExperienceStore(async (sessionID, opts) => {
      seen.push({ sessionID, directory: opts?.directory });
      return response({});
    });
    await store.load('s1', { directory: '/repo' });
    expect(seen).toEqual([{ sessionID: 's1', directory: '/repo' }]);
  });
});
