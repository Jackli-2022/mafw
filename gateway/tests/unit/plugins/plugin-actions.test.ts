import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../../src/plugins/package-host';
import { createPluginPackageContext } from '../../../src/plugins/package-context';
import {
  PluginActionError,
  PluginActionRegistry,
  type PluginActionInvokeOptions,
} from '../../../src/plugins/plugin-actions';
import { createRegistrationBag } from '../../../src/plugins/registration-bag';
import type { ActivatedAction, PluginActionDeclaration } from '../../../src/plugins/package-types';

function action(name: string, declaration: PluginActionDeclaration): ActivatedAction {
  return { name, declaration, descriptor: { name } };
}

function registry(): PluginActionRegistry {
  return new PluginActionRegistry();
}

async function settle(): Promise<void> {
  // Let a handler's promise chain run one macrotask before we mutate the world.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('PluginActionRegistry invocation contract', () => {
  it('rejects invalid input before the handler runs', async () => {
    const handler = jest.fn(() => ({ ok: true }));
    const bag = createRegistrationBag();
    const reg = registry();
    reg.register('demo', [action('save', {
      handler,
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
        additionalProperties: false,
      },
    })], bag);

    await expect(reg.invoke('demo', 'save', { id: 42 })).rejects.toMatchObject({
      code: 'invalid-input',
      status: 400,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('validates the handler output against the declared output schema', async () => {
    const handler = jest.fn(() => ({ ok: 'yes' }));
    const bag = createRegistrationBag();
    const reg = registry();
    reg.register('demo', [action('save', {
      handler,
      outputSchema: {
        type: 'object',
        required: ['ok'],
        properties: { ok: { type: 'boolean' } },
      },
    })], bag);

    const failure = await reg.invoke('demo', 'save', {}).catch((err) => err);
    expect(failure).toBeInstanceOf(PluginActionError);
    expect(failure).toMatchObject({ code: 'invalid-output', status: 502 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns the handler output unchanged on success', async () => {
    const output = { title: 'Main', nested: { rows: [1, 2, 3] } };
    const bag = createRegistrationBag();
    const reg = registry();
    reg.register('demo', [action('load', { handler: () => output })], bag);

    await expect(reg.invoke('demo', 'load', undefined)).resolves.toBe(output);
  });

  it('aborts a handler that exceeds its declared timeout', async () => {
    let observed: AbortSignal | undefined;
    const bag = createRegistrationBag();
    const reg = registry();
    reg.register('demo', [action('slow', {
      timeoutMs: 25,
      handler: (_input, call) => new Promise((_resolve, reject) => {
        observed = call.signal;
        call.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    })], bag);

    await expect(reg.invoke('demo', 'slow', {})).rejects.toMatchObject({
      code: 'timeout',
      status: 408,
    });
    expect(observed?.aborted).toBe(true);
  });

  it('aborts in-flight calls when the owning registration bag is disposed', async () => {
    let observed: AbortSignal | undefined;
    const bag = createRegistrationBag();
    const reg = registry();
    reg.register('demo', [action('wait', {
      handler: (_input, call) => new Promise((_resolve, reject) => {
        observed = call.signal;
        call.signal.addEventListener('abort', () => reject(new Error('gone')));
      }),
    })], bag);

    const call = reg.invoke('demo', 'wait', {});
    await settle();
    await bag.dispose();

    await expect(call).rejects.toMatchObject({ code: 'unloaded', status: 409 });
    expect(observed?.aborted).toBe(true);
    // A late call after unload never reaches the handler again.
    await expect(reg.invoke('demo', 'wait', {})).rejects.toMatchObject({
      code: 'unknown-package',
      status: 404,
    });
  });

  it('aborts when the caller signal aborts', async () => {
    let observed: AbortSignal | undefined;
    const bag = createRegistrationBag();
    const reg = registry();
    reg.register('demo', [action('wait', {
      handler: (_input, call) => new Promise((_resolve, reject) => {
        observed = call.signal;
        call.signal.addEventListener('abort', () => reject(new Error('caller gone')));
      }),
    })], bag);

    const controller = new AbortController();
    const options: PluginActionInvokeOptions = { signal: controller.signal };
    const call = reg.invoke('demo', 'wait', {}, options);
    await settle();
    controller.abort();

    await expect(call).rejects.toMatchObject({ code: 'aborted', status: 409 });
    expect(observed?.aborted).toBe(true);
  });

  it('reports unknown actions and unknown packages with a 404-like error', async () => {
    const bag = createRegistrationBag();
    const reg = registry();
    reg.register('demo', [action('load', { handler: () => null })], bag);

    await expect(reg.invoke('demo', 'missing', {})).rejects.toMatchObject({
      code: 'unknown-action',
      status: 404,
    });
    await expect(reg.invoke('other', 'load', {})).rejects.toMatchObject({
      code: 'unknown-package',
      status: 404,
    });
  });

  it('enforces the action payload byte cap on input and output', async () => {
    const inputHandler = jest.fn(() => null);
    const reg = registry();
    reg.register('demo', [action('save', { handler: inputHandler })], createRegistrationBag());

    await expect(reg.invoke('demo', 'save', { blob: 'x'.repeat(300 * 1024) })).rejects.toMatchObject({
      code: 'payload-too-large',
      status: 400,
    });
    expect(inputHandler).not.toHaveBeenCalled();

    reg.register('demo', [action('save', {
      handler: () => ({ blob: 'x'.repeat(300 * 1024) }),
    })], createRegistrationBag());
    await expect(reg.invoke('demo', 'save', {})).rejects.toMatchObject({
      code: 'payload-too-large',
      status: 400,
    });
  });

  it('rejects non-JSON handler output instead of forwarding it', async () => {
    const reg = registry();
    reg.register('demo', [action('bad', { handler: () => () => undefined })], createRegistrationBag());

    await expect(reg.invoke('demo', 'bad', {})).rejects.toMatchObject({
      code: 'invalid-output',
      status: 502,
    });
  });

  it('wraps handler failures in a neutral plugin error', async () => {
    const reg = registry();
    reg.register('demo', [action('boom', {
      handler: () => { throw new Error('internal detail'); },
    })], createRegistrationBag());

    const failure = await reg.invoke('demo', 'boom', {}).catch((err) => err);
    expect(failure).toMatchObject({ code: 'handler-error', status: 502 });
    expect(String(failure.message)).not.toContain('internal detail');
  });

  it('drops stale invocations when the package was re-registered as a new revision', async () => {
    let release: (value: unknown) => void = () => undefined;
    const reg = registry();
    reg.register('demo', [action('load', {
      handler: () => new Promise((resolve) => { release = resolve; }),
    })], createRegistrationBag());

    const call = reg.invoke('demo', 'load', {});
    await settle();
    reg.register('demo', [action('load', { handler: () => 'new' })], createRegistrationBag());
    release('old');

    await expect(call).rejects.toMatchObject({ code: 'stale-revision', status: 409 });
    await expect(reg.invoke('demo', 'load', {})).resolves.toBe('new');
  });

  it('rejects calls that name a superseded revision', async () => {
    const reg = registry();
    reg.register('demo', [action('load', { handler: () => 'ok' })], createRegistrationBag(), undefined, {
      revision: 'boot:2',
    });

    await expect(reg.invoke('demo', 'load', {}, { revision: 'boot:1' })).rejects.toMatchObject({
      code: 'stale-revision',
      status: 409,
    });
    await expect(reg.invoke('demo', 'load', {}, { revision: 'boot:2' })).resolves.toBe('ok');
  });

  it('skips declarations whose schema cannot be compiled and records a diagnostic', async () => {
    const reg = registry();
    const diagnostics = reg.register('demo', [
      action('bad', { handler: () => null, inputSchema: { type: 'object', properties: 'nope' } as any }),
      action('good', { handler: () => 'ok' }),
    ], createRegistrationBag());

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('invalid-schema');
    await expect(reg.invoke('demo', 'bad', {})).rejects.toMatchObject({ code: 'unknown-action' });
    await expect(reg.invoke('demo', 'good', {})).resolves.toBe('ok');
    expect(reg.getDiagnostics()).toHaveLength(1);
  });
});

describe('PluginHost action registration follows commits only', () => {
  let dir: string;
  let host: PluginHost | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-actions-'));
    delete (globalThis as any).__mafwActionShape;
  });

  afterEach(() => {
    host?.stop();
    host = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('invokes committed actions and never exposes a pending candidate action', async () => {
    const file = path.join(dir, 'rt.js');
    const body = `module.exports = { name: 'rt', async activate() {
  const shape = globalThis.__mafwActionShape || 1;
  return {
    runtime: { name: 'rt', async createRuntime() { return { name: 'rt', capabilities: {} }; } },
    actions: shape === 1
      ? { v1: { handler: () => 'one' } }
      : { v2: { handler: () => 'two' } },
  };
} };`;
    fs.writeFileSync(file, body);
    host = new PluginHost(
      dir,
      (name) => createPluginPackageContext(name, { projectDir: '/p', gatewayPort: 3000 }),
      { activeRuntime: () => 'rt' },
    );
    await host.init();

    await expect(host.invokeAction('rt', 'v1', {})).resolves.toBe('one');

    (globalThis as any).__mafwActionShape = 2;
    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();

    // The new revision is only staged: the old action set stays live.
    expect(host.getPending('rt')).not.toBeNull();
    await expect(host.invokeAction('rt', 'v1', {})).resolves.toBe('one');
    await expect(host.invokeAction('rt', 'v2', {})).rejects.toMatchObject({ code: 'unknown-action' });

    await host.applyPending('rt');
    await expect(host.invokeAction('rt', 'v2', {})).resolves.toBe('two');
    await expect(host.invokeAction('rt', 'v1', {})).rejects.toMatchObject({ code: 'unknown-action' });
  });
});
