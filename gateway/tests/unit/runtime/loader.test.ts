import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../../src/runtime/loader';

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../src/config', () => ({
  config: { raw: {} },
}));

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-loader-test-'));
}

function writePlugin(dir: string, filename: string, content: string): void {
  fs.writeFileSync(path.join(dir, filename), content);
}

const validPlugin = `module.exports = {
  name: "test-runtime",
  capabilities: { eventStream: true },
  async createRuntime(ctx) { return { name: "test-runtime", capabilities: {} }; },
};`;

const validPluginMinimal = `module.exports = {
  name: "minimal-runtime",
  async createRuntime(ctx) { return { name: "minimal-runtime", capabilities: {} }; },
};`;

const validPluginInternal = `module.exports = {
  name: "internal-runtime",
  external: false,
  async createRuntime(ctx) { return { name: "internal-runtime", capabilities: {} }; },
};`;

const noNamePlugin = `module.exports = { async createRuntime() {} };`;
const noCreateRuntimePlugin = `module.exports = { name: "no-create" };`;
const syntaxErrorPlugin = `this is not valid javascript!!!`;

describe('RuntimePluginLoader', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates dir with README and example on init when dir missing', async () => {
    const freshDir = path.join(dir, 'plugins-new');
    expect(fs.existsSync(freshDir)).toBe(false);
    const loader = new RuntimePluginLoader(freshDir);
    await loader.init();
    expect(fs.existsSync(freshDir)).toBe(true);
    expect(fs.existsSync(path.join(freshDir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(freshDir, 'example.js.disabled'))).toBe(true);
  });

  it('loads a valid plugin and returns it via get()', async () => {
    writePlugin(dir, 'good.js', validPlugin);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();

    const result = loader.get('test-runtime');
    expect(result).toBeDefined();
    expect(result!.capabilities.eventStream).toBe(true);
    expect(result!.capabilities.sessionApi).toBe(true);
    expect(result!.capabilities.promptWhileBusy).toBe(true);
    expect(result!.external).toBe(true);
    expect(typeof result!.createRuntime).toBe('function');
  });

  it('merges plugin capabilities over Tier-0 baseline', async () => {
    writePlugin(dir, 'minimal.js', validPluginMinimal);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();

    const result = loader.get('minimal-runtime');
    expect(result).toBeDefined();
    expect(result!.capabilities.sessionApi).toBe(true);
    expect(result!.capabilities.promptWhileBusy).toBe(true);
    expect(result!.capabilities.eventStream).toBe(false);
    expect(result!.capabilities.nativeApprovals).toBe(false);
    expect(result!.capabilities.providerConfigApi).toBe(false);
    expect(result!.capabilities.perLlmCallTransform).toBe(false);
  });

  it('defaults external to true, respects explicit false', async () => {
    writePlugin(dir, 'internal.js', validPluginInternal);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();

    const result = loader.get('internal-runtime');
    expect(result).toBeDefined();
    expect(result!.external).toBe(false);
  });

  it('marks plugin without name as error', async () => {
    writePlugin(dir, 'bad.js', noNamePlugin);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();

    expect(loader.get('test-runtime')).toBeUndefined();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('error');
    expect(state[0].error).toBe('missing name');
  });

  it('marks plugin without createRuntime as error', async () => {
    writePlugin(dir, 'nocreate.js', noCreateRuntimePlugin);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();

    expect(loader.get('no-create')).toBeUndefined();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('error');
    expect(state[0].error).toBe('missing createRuntime(ctx)');
  });

  it('marks syntax-error plugin as error', async () => {
    writePlugin(dir, 'broken.js', syntaxErrorPlugin);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();

    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('error');
    expect(state[0].error).toBeDefined();
  });

  it('detects duplicate plugin names and skips second', async () => {
    writePlugin(dir, 'a.js', validPlugin);
    writePlugin(dir, 'b.js', validPlugin);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();

    const state = loader.getState();
    const ok = state.filter(s => s.status === 'ok');
    const errors = state.filter(s => s.status === 'error');
    expect(ok).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe('duplicate name');
  });

  it('ignores non-.js files', async () => {
    writePlugin(dir, 'readme.txt', 'not a plugin');
    writePlugin(dir, 'good.js', validPlugin);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();

    expect(loader.get('test-runtime')).toBeDefined();
    expect(loader.getState()).toHaveLength(1);
  });

  it('removes stale entries on re-scan when file deleted', async () => {
    writePlugin(dir, 'good.js', validPlugin);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    expect(loader.get('test-runtime')).toBeDefined();

    fs.unlinkSync(path.join(dir, 'good.js'));
    await loader.scan();
    expect(loader.get('test-runtime')).toBeUndefined();
    expect(loader.getState()).toHaveLength(0);
  });

  it('handles empty directory gracefully', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    expect(loader.getState()).toHaveLength(0);
  });

  it('returns undefined for unknown runtime name', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    expect(loader.get('nonexistent')).toBeUndefined();
  });

  it('handles multiple valid plugins loaded together', async () => {
    writePlugin(dir, 'a.js', validPlugin);
    writePlugin(dir, 'b.js', validPluginMinimal);
    writePlugin(dir, 'c.js', validPluginInternal);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();

    expect(loader.get('test-runtime')).toBeDefined();
    expect(loader.get('minimal-runtime')).toBeDefined();
    expect(loader.get('internal-runtime')).toBeDefined();
    expect(loader.getState()).toHaveLength(3);
    expect(loader.getState().every(s => s.status === 'ok')).toBe(true);
  });

  it('fail-open: valid plugins load alongside broken ones', async () => {
    writePlugin(dir, 'broken.js', syntaxErrorPlugin);
    writePlugin(dir, 'good.js', validPlugin);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();

    expect(loader.get('test-runtime')).toBeDefined();
    const state = loader.getState();
    expect(state).toHaveLength(2);
    expect(state.filter(s => s.status === 'ok')).toHaveLength(1);
    expect(state.filter(s => s.status === 'error')).toHaveLength(1);
  });
});
