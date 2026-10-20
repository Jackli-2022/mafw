import * as http from 'http';
import { handleRuntimeGet } from '../../../src/routes/runtime-switch';

function fakeRes(): { res: http.ServerResponse; status: () => number; body: () => string } {
  const res = {} as unknown as http.ServerResponse;
  let status = 0;
  let payload = '';
  (res as any).writeHead = (s: number) => { status = s; return res; };
  (res as any).end = (b: string) => { payload = b ?? ''; return res; };
  return { res, status: () => status, body: () => payload };
}

describe('GET /api/runtime (unknownEvents exposure)', () => {
  it('includes unknownEvents snapshot in response', async () => {
    const { res, status, body } = fakeRes();
    await handleRuntimeGet({} as http.IncomingMessage, res, {
      runtimeName: () => 'my-runtime',
      runtimeCaps: () => ({}),
      envOverride: () => false,
      unknownEvents: () => ({ 'my-runtime': { 'weird.event': 3 } }),
    } as any);
    expect(status()).toBe(200);
    const parsed = JSON.parse(body());
    expect(parsed.unknownEvents).toEqual({ 'my-runtime': { 'weird.event': 3 } });
  });

  it('returns empty object when tracker absent', async () => {
    const { res, body } = fakeRes();
    await handleRuntimeGet({} as http.IncomingMessage, res, {
      runtimeName: () => 'opencode',
      runtimeCaps: () => ({}),
      envOverride: () => false,
    } as any);
    expect(JSON.parse(body()).unknownEvents).toEqual({});
  });

  it('exposes runtime validation notes when provided', async () => {
    const { res, body } = fakeRes();
    await handleRuntimeGet({} as http.IncomingMessage, res, {
      runtimeName: () => 'my-runtime',
      runtimeCaps: () => ({}),
      envOverride: () => false,
      validationNotes: () => ["my-rt: declares completionApi but completion.complete is missing — downgraded to false"],
    } as any);
    const parsed = JSON.parse(body());
    expect(parsed.validation).toHaveLength(1);
    expect(parsed.validation[0]).toMatch(/completionApi/);
  });

  it('validation defaults to empty array', async () => {
    const { res, body } = fakeRes();
    await handleRuntimeGet({} as http.IncomingMessage, res, {
      runtimeName: () => 'opencode',
      runtimeCaps: () => ({}),
      envOverride: () => false,
    } as any);
    expect(JSON.parse(body()).validation).toEqual([]);
  });

  it('exposes translationErrors snapshot (B2) when provided', async () => {
    const { res, body } = fakeRes();
    await handleRuntimeGet({} as http.IncomingMessage, res, {
      runtimeName: () => 'pi',
      runtimeCaps: () => ({}),
      envOverride: () => false,
      translationErrors: () => ({ pi: { transformEvent: 2, normalizeMessages: 0, lastError: 'boom', lastAt: 't' } }),
    } as any);
    const parsed = JSON.parse(body());
    expect(parsed.translationErrors.pi.transformEvent).toBe(2);
    expect(parsed.translationErrors.pi.lastError).toBe('boom');
  });

  it('translationErrors defaults to empty object', async () => {
    const { res, body } = fakeRes();
    await handleRuntimeGet({} as http.IncomingMessage, res, {
      runtimeName: () => 'opencode',
      runtimeCaps: () => ({}),
      envOverride: () => false,
    } as any);
    expect(JSON.parse(body()).translationErrors).toEqual({});
  });

  it('exposes translationDrops snapshot (B3: unmatched/suppressed per-type) when provided', async () => {
    const { res, body } = fakeRes();
    await handleRuntimeGet({} as http.IncomingMessage, res, {
      runtimeName: () => 'pi',
      runtimeCaps: () => ({}),
      envOverride: () => false,
      translationDrops: () => ({ pi: { unmatched: { 'turn.completed': 3 }, suppressed: { sync: 7 } } }),
    } as any);
    const parsed = JSON.parse(body());
    expect(parsed.translationDrops.pi.unmatched['turn.completed']).toBe(3);
    expect(parsed.translationDrops.pi.suppressed.sync).toBe(7);
  });

  it('translationDrops defaults to empty object', async () => {
    const { res, body } = fakeRes();
    await handleRuntimeGet({} as http.IncomingMessage, res, {
      runtimeName: () => 'opencode',
      runtimeCaps: () => ({}),
      envOverride: () => false,
    } as any);
    expect(JSON.parse(body()).translationDrops).toEqual({});
  });
});
