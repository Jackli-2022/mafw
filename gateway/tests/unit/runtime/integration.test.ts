/**
 * Integration test: config → loader → runtime selection → capability gates.
 *
 * Tests the full runtime contract seam flow without starting the gateway:
 * 1. Plugin loader scans a temp dir with a valid plugin
 * 2. Plugin's createRuntime is called with a real context
 * 3. Returned AgentRuntime has correct capabilities
 * 4. Capability gate logic (capGuard) correctly blocks/allows
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader, createRuntimePluginContext } from '../../../src/runtime/loader';
import { AgentRuntime, RuntimeCapabilities, fullCapabilities, minimalCapabilities } from '../../../src/runtime/contract';
import { createOpencodeRuntime } from '../../../src/runtime/opencode-runtime';

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../src/config', () => ({
  config: { raw: { runtime: { pluginConfig: {} } } },
}));

jest.mock('../../../src/opencode-adapter', () => ({
  createOpencodeAdapter: jest.fn(async () => ({
    session: {
      create: jest.fn(),
      promptAsync: jest.fn(),
      prompt: jest.fn(),
      messages: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      abort: jest.fn(),
      list: jest.fn(),
      todo: jest.fn(),
      children: jest.fn(),
      summarize: jest.fn(),
    },
    global: { event: jest.fn() },
    provider: { list: jest.fn() },
    app: { agents: jest.fn() },
    config: { get: jest.fn(), update: jest.fn() },
  })),
}));

// Simulate capGuard logic from index.ts (extracted for testability)
function capGuard(caps: RuntimeCapabilities, cap: keyof RuntimeCapabilities): boolean {
  return !caps[cap];
}

describe('Runtime contract integration', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-integration-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('full flow: load plugin → createRuntime → capability gates', async () => {
    // 1. Write a Tier-1 plugin (sessionApi + eventStream, no providerConfigApi)
    fs.writeFileSync(path.join(dir, 'my-runtime.js'), `module.exports = {
      name: "my-runtime",
      capabilities: { eventStream: true },
      async createRuntime(ctx) {
        return {
          name: "my-runtime",
          capabilities: { sessionApi: true, promptWhileBusy: true, eventStream: true, nativeApprovals: false, providerConfigApi: false, perLlmCallTransform: false },
          session: {
            async create() { return { id: "test-session" }; },
            async promptAsync() {},
            async prompt() { return { parts: [] }; },
            async messages() { return { data: [] }; },
            async get() { return {}; },
            async delete() {},
            async abort() {},
            async list() { return []; },
            async todo() { return []; },
            async children() { return []; },
            async summarize() {},
          },
          global: { async event() { return { stream: [] }; } },
          provider: { async list() { return { all: [], connected: [], default: {} }; } },
          app: { async agents() { return []; } },
          config: { async get() { return {}; }, async update(c) { return c; } },
        };
      },
    };`);

    // 2. Load plugin
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    const plugin = loader.get('my-runtime');
    expect(plugin).toBeDefined();

    // 3. Create runtime via plugin
    const ctx = createRuntimePluginContext();
    const rt = await plugin!.createRuntime(ctx);
    expect(rt.name).toBe('my-runtime');
    expect(rt.capabilities.eventStream).toBe(true);
    expect(rt.capabilities.providerConfigApi).toBe(false);

    // 4. Capability gates
    expect(capGuard(rt.capabilities, 'eventStream')).toBe(false);       // allowed
    expect(capGuard(rt.capabilities, 'providerConfigApi')).toBe(true);  // blocked
    expect(capGuard(rt.capabilities, 'nativeApprovals')).toBe(true);    // blocked
    expect(capGuard(rt.capabilities, 'sessionApi')).toBe(false);        // allowed

    // 5. Runtime is functional
    const session = await rt.session.create({});
    expect(session.id).toBe('test-session');
  });

  it('opencode runtime declares full capabilities (Tier 2)', async () => {
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:1' });
    expect(rt.name).toBe('opencode');
    expect(rt.capabilities).toEqual(fullCapabilities());

    // All gates open
    for (const cap of Object.keys(rt.capabilities) as (keyof RuntimeCapabilities)[]) {
      expect(capGuard(rt.capabilities, cap)).toBe(false);
    }
  });

  it('fallback: unknown plugin name → loader returns undefined', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    expect(loader.get('nonexistent')).toBeUndefined();
  });

  it('capability gate blocks all Tier-1+ features for Tier-0 runtime', async () => {
    const tier0Caps = minimalCapabilities();
    expect(capGuard(tier0Caps, 'sessionApi')).toBe(false);
    expect(capGuard(tier0Caps, 'promptWhileBusy')).toBe(false);
    expect(capGuard(tier0Caps, 'eventStream')).toBe(true);
    expect(capGuard(tier0Caps, 'nativeApprovals')).toBe(true);
    expect(capGuard(tier0Caps, 'providerConfigApi')).toBe(true);
    expect(capGuard(tier0Caps, 'perLlmCallTransform')).toBe(true);
  });
});
