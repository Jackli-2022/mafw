import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../../src/plugins/package-host';
import { createPluginPackageContext } from '../../../src/plugins/package-context';
import { PluginEventRegistry, type PluginEventDiagnostic } from '../../../src/plugins/plugin-events';
import { createRegistrationBag } from '../../../src/plugins/registration-bag';
import type { ActivatedEvent, PluginEventDeclaration } from '../../../src/plugins/package-types';

const CANONICAL = new Set(['turn.completed', 'part.updated', 'permission.asked']);

interface BroadcastEvent {
  type: string;
  properties?: Record<string, unknown>;
  sessionID?: string;
  [key: string]: unknown;
}

function event(declaration: PluginEventDeclaration, descriptor: Record<string, unknown> = {}): ActivatedEvent {
  return {
    declaration,
    descriptor: { type: declaration.type, ...descriptor },
  };
}

function codes(diagnostics: PluginEventDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

describe('PluginEventRegistry registration and emit', () => {
  it('broadcasts a registered event once with the neutral envelope', () => {
    const broadcast = jest.fn();
    const registry = new PluginEventRegistry({ canonicalTypes: CANONICAL, broadcast });
    const bag = createRegistrationBag();
    registry.register('demo', [event({ type: 'plugin:demo:changed' })], bag);

    const result = registry.emit('demo', 'plugin:demo:changed', { id: 'a' }, 'sess-1');

    expect(result).toMatchObject({ ok: true });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({
      type: 'plugin:demo:changed',
      properties: { id: 'a' },
      sessionID: 'sess-1',
    });
  });

  it('drops a payload that violates the registered schema and records a diagnostic', () => {
    const broadcast = jest.fn();
    const registry = new PluginEventRegistry({ canonicalTypes: CANONICAL, broadcast });
    registry.register('demo', [event({
      type: 'plugin:demo:changed',
      schema: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
        additionalProperties: false,
      },
    })], createRegistrationBag());

    const result = registry.emit('demo', 'plugin:demo:changed', { id: 42 });

    expect(result).toMatchObject({ ok: false, error: 'schema-invalid' });
    expect(broadcast).not.toHaveBeenCalled();
    expect(codes(registry.getDiagnostics())).toContain('schema-invalid');
  });

  it('rejects canonical event names even when a package claims one', () => {
    const broadcast = jest.fn();
    const registry = new PluginEventRegistry({ canonicalTypes: CANONICAL, broadcast });

    const diagnostics = registry.register('demo', [
      event({ type: 'turn.completed' }),
      event({ type: 'plugin:demo:changed' }),
    ], createRegistrationBag());

    expect(codes(diagnostics)).toContain('declaration-invalid');
    expect(registry.emit('demo', 'turn.completed', {})).toMatchObject({
      ok: false,
      error: 'canonical-event',
    });
    expect(registry.emit('demo', 'plugin:demo:changed', {})).toMatchObject({ ok: true });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0].type).toBe('plugin:demo:changed');
  });

  it('rejects another package namespace', () => {
    const broadcast = jest.fn();
    const registry = new PluginEventRegistry({ canonicalTypes: CANONICAL, broadcast });

    const diagnostics = registry.register('demo', [event({ type: 'plugin:other:changed' })], createRegistrationBag());

    expect(codes(diagnostics)).toContain('declaration-invalid');
    expect(registry.emit('demo', 'plugin:other:changed', {})).toMatchObject({
      ok: false,
      error: 'foreign-namespace',
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('drops unregistered events and non-plugin namespaces without broadcasting', () => {
    const broadcast = jest.fn();
    const registry = new PluginEventRegistry({ canonicalTypes: CANONICAL, broadcast });
    registry.register('demo', [event({ type: 'plugin:demo:changed' })], createRegistrationBag());

    expect(registry.emit('demo', 'plugin:demo:other', {})).toMatchObject({
      ok: false,
      error: 'unregistered-event',
    });
    expect(registry.emit('demo', 'runtime_switched', {})).toMatchObject({
      ok: false,
      error: 'invalid-namespace',
    });
    expect(registry.emit('unknown', 'plugin:unknown:changed', {})).toMatchObject({
      ok: false,
      error: 'unloaded',
    });
    expect(broadcast).not.toHaveBeenCalled();
    expect(codes(registry.getDiagnostics())).toEqual(
      expect.arrayContaining(['unregistered-event', 'invalid-namespace', 'unloaded']),
    );
  });

  it('requires a session envelope for session-scoped events', () => {
    const broadcast = jest.fn();
    const registry = new PluginEventRegistry({ canonicalTypes: CANONICAL, broadcast });
    registry.register('demo', [event({ type: 'plugin:demo:changed', scope: 'session' })], createRegistrationBag());

    expect(registry.emit('demo', 'plugin:demo:changed', { id: 'a' })).toMatchObject({
      ok: false,
      error: 'missing-session',
    });
    expect(broadcast).not.toHaveBeenCalled();

    // properties.sessionID is the neutral envelope alternative to the argument.
    expect(registry.emit('demo', 'plugin:demo:changed', { id: 'a', sessionID: 'sess-p' })).toMatchObject({ ok: true });
    expect(broadcast).toHaveBeenCalledWith({
      type: 'plugin:demo:changed',
      properties: { id: 'a', sessionID: 'sess-p' },
      sessionID: 'sess-p',
    });
  });

  it('stops emitting once the owning bag is disposed', async () => {
    const broadcast = jest.fn();
    const registry = new PluginEventRegistry({ canonicalTypes: CANONICAL, broadcast });
    const bag = createRegistrationBag();
    registry.register('demo', [event({ type: 'plugin:demo:changed' })], bag);

    expect(registry.emit('demo', 'plugin:demo:changed', {})).toMatchObject({ ok: true });
    await bag.dispose();
    expect(registry.emit('demo', 'plugin:demo:changed', {})).toMatchObject({
      ok: false,
      error: 'unloaded',
    });
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('ignores late emits from a superseded activation', () => {
    const broadcast = jest.fn();
    const registry = new PluginEventRegistry({ canonicalTypes: CANONICAL, broadcast });
    const first = {};
    const second = {};
    registry.register('demo', [event({ type: 'plugin:demo:changed' })], createRegistrationBag(), {
      token: first,
      revision: 'boot:1',
    });
    registry.register('demo', [event({ type: 'plugin:demo:changed' })], createRegistrationBag(), {
      token: second,
      revision: 'boot:2',
    });

    const stale = registry.emitFrom('demo', first, { type: 'plugin:demo:changed', properties: { id: 'old' } });
    const fresh = registry.emitFrom('demo', second, { type: 'plugin:demo:changed', properties: { id: 'new' } });

    expect(stale).toMatchObject({ ok: false, error: 'stale-emitter' });
    expect(fresh).toMatchObject({ ok: true });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0].properties).toEqual({ id: 'new' });
    expect(codes(registry.getDiagnostics())).toContain('stale-emitter');
  });

  it('rejects malformed payloads without invoking the broadcaster', () => {
    const broadcast = jest.fn();
    const registry = new PluginEventRegistry({ canonicalTypes: CANONICAL, broadcast });
    registry.register('demo', [event({ type: 'plugin:demo:changed' })], createRegistrationBag());

    expect(registry.emit('demo', 'plugin:demo:changed', 'nope' as any)).toMatchObject({
      ok: false,
      error: 'invalid-properties',
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('drops payloads that exceed the event payload byte cap', () => {
    const broadcast = jest.fn();
    const registry = new PluginEventRegistry({ canonicalTypes: CANONICAL, broadcast });
    registry.register('demo', [event({ type: 'plugin:demo:changed' })], createRegistrationBag());

    expect(registry.emit('demo', 'plugin:demo:changed', { blob: 'x'.repeat(300 * 1024) })).toMatchObject({
      ok: false,
      error: 'payload-too-large',
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('drops a declaration whose schema cannot be compiled', () => {
    const broadcast = jest.fn();
    const registry = new PluginEventRegistry({ canonicalTypes: CANONICAL, broadcast });

    const diagnostics = registry.register('demo', [
      event({ type: 'plugin:demo:broken', schema: { type: 'object', properties: 'nope' } as any }),
    ], createRegistrationBag());

    expect(codes(diagnostics)).toContain('declaration-invalid');
    expect(registry.emit('demo', 'plugin:demo:broken', {})).toMatchObject({
      ok: false,
      error: 'unregistered-event',
    });
    expect(broadcast).not.toHaveBeenCalled();
  });
});

function mkHost(dir: string, broadcast: jest.Mock): PluginHost {
  return new PluginHost(
    dir,
    (name) => createPluginPackageContext(name, { projectDir: '/p', gatewayPort: 3000 }),
    { broadcast: (payload) => broadcast(payload) as unknown as void },
  );
}

describe('PluginHost event wiring', () => {
  let dir: string;
  let host: PluginHost | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-events-'));
    delete (globalThis as any).__mafwPackageCtx;
  });

  afterEach(() => {
    host?.stop();
    host = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('wraps ctx.emit so only this package registered events reach the broadcast', async () => {
    fs.writeFileSync(path.join(dir, 'demo.js'), `
module.exports = { name: 'demo', async activate(ctx) {
  globalThis.__mafwPackageCtx = ctx;
  return { events: [{ type: 'plugin:demo:changed', schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } }] };
} };
`);
    const broadcast = jest.fn();
    host = mkHost(dir, broadcast);
    await host.init();

    const ctx = (globalThis as any).__mafwPackageCtx;
    broadcast.mockClear();
    ctx.emit({ type: 'plugin:demo:changed', properties: { id: 'a' } });
    ctx.emit({ type: 'turn.completed', properties: {} });
    ctx.emit({ type: 'plugin:other:changed', properties: {} });
    ctx.emit({ type: 'plugin:demo:changed', properties: { id: 42 } });

    const delivered = broadcast.mock.calls.map((call) => call[0] as BroadcastEvent);
    expect(delivered).toEqual([
      { type: 'plugin:demo:changed', properties: { id: 'a' } },
    ]);
    expect(host.getEventRegistry().getDiagnostics().length).toBeGreaterThanOrEqual(3);
  });

  it('stops ctx.emit after the package is removed and publishes plugins.changed once per commit', async () => {
    const file = path.join(dir, 'demo.js');
    fs.writeFileSync(file, `
module.exports = { name: 'demo', async activate(ctx) {
  globalThis.__mafwPackageCtx = ctx;
  return { events: [{ type: 'plugin:demo:changed' }] };
} };
`);
    const broadcast = jest.fn();
    host = mkHost(dir, broadcast);
    await host.init();

    const changes = (): BroadcastEvent[] =>
      broadcast.mock.calls.map((call) => call[0] as BroadcastEvent).filter((payload) => payload.type === 'plugins.changed');
    expect(changes()).toHaveLength(1);
    expect(changes()[0].properties?.revision).toBe(host.getClientSnapshot().revision);

    // An unchanged rescan must not republish the gateway event.
    await host.reload();
    expect(changes()).toHaveLength(1);

    // A real commit republishes exactly once with the new revision.
    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();
    expect(changes()).toHaveLength(2);
    expect(changes()[1].properties?.revision).toBe(host.getClientSnapshot().revision);

    const ctx = (globalThis as any).__mafwPackageCtx;
    broadcast.mockClear();
    fs.rmSync(file);
    await host.reload();
    ctx.emit({ type: 'plugin:demo:changed', properties: {} });
    const delivered = broadcast.mock.calls.map((call) => call[0] as BroadcastEvent);
    expect(delivered.filter((payload) => payload.type === 'plugin:demo:changed')).toEqual([]);
    expect(delivered.filter((payload) => payload.type === 'plugins.changed')).toHaveLength(1);
  });

  it('publishes a state-only plugins.changed for a failed candidate or a staged pending revision', async () => {
    const file = path.join(dir, 'rt.js');
    fs.writeFileSync(file, `
module.exports = { name: 'rt', async activate() {
  const g = globalThis;
  if (g.__mafwEventFail) throw new Error('boom');
  return { runtime: { name: 'rt', async createRuntime() { return { name: 'rt', capabilities: {} }; } } };
} };
`);
    const broadcast = jest.fn();
    host = new PluginHost(
      dir,
      (name) => createPluginPackageContext(name, { projectDir: '/p', gatewayPort: 3000 }),
      { activeRuntime: () => 'rt', broadcast: (payload) => broadcast(payload) as unknown as void },
    );
    await host.init();

    const changes = (): BroadcastEvent[] =>
      broadcast.mock.calls
        .map((call) => call[0] as BroadcastEvent)
        .filter((payload) => payload.type === 'plugins.changed');
    const before = changes().length;
    const committedRevision = host.getClientSnapshot().revision;

    // Failed candidate keeps the active revision: the client is told the Hub
    // state changed, but the active snapshot (and revision) did not move.
    (globalThis as any).__mafwEventFail = true;
    fs.appendFileSync(file, '\n// broken\n');
    await host.reload();
    expect(changes()).toHaveLength(before + 1);
    expect(changes()[before]).toMatchObject({
      properties: { revision: committedRevision, stateChanged: true },
    });

    // Staged pending revision: pending is Hub-visible but not committed, so it
    // gets the same state-only notification, not a revision bump.
    delete (globalThis as any).__mafwEventFail;
    fs.appendFileSync(file, '\n// staged\n');
    await host.reload();
    expect(host.getPending('rt')).not.toBeNull();
    expect(changes()).toHaveLength(before + 2);
    expect(changes()[before + 1]).toMatchObject({
      properties: { revision: committedRevision, stateChanged: true },
    });

    // Applying commits: exactly one normal event with the new revision.
    await host.applyPending('rt');
    expect(changes()).toHaveLength(before + 3);
    expect(changes()[before + 2].properties?.stateChanged).toBeUndefined();
    expect(changes()[before + 2].properties?.revision).toBe(host.getClientSnapshot().revision);
  });
});
