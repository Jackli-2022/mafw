import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginLoader } from '../../../src/usage/plugin-loader';

jest.mock('../../../src/usage/plugin-context', () => ({
  makeAdapter: jest.fn((mod: any) => ({
    name: mod.name,
    fetch: jest.fn(),
  })),
}));

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-loader-test-'));
}

function writePlugin(dir: string, filename: string, content: string): void {
  fs.writeFileSync(path.join(dir, filename), content);
}

const validPlugin = `module.exports = { name: "test-provider", plan: "Test", async fetch() { return null; } };`;
const noNamePlugin = `module.exports = { async fetch() { return null; } };`;
const noFetchPlugin = `module.exports = { name: "no-fetch" };`;
const syntaxErrorPlugin = `this is not valid javascript!!!`;

describe('PluginLoader', () => {
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
    const loader = new PluginLoader(freshDir, []);
    await loader.init();
    loader.stop();
    expect(fs.existsSync(freshDir)).toBe(true);
    expect(fs.existsSync(path.join(freshDir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(freshDir, 'example.js.disabled'))).toBe(true);
  });

  it('loads a valid plugin and returns its adapter', async () => {
    writePlugin(dir, 'good.js', validPlugin);
    const loader = new PluginLoader(dir, []);
    await loader.init();
    loader.stop();

    const adapters = loader.getAdapters();
    expect(adapters).toHaveLength(1);
    expect(adapters[0].name).toBe('test-provider');

    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('ok');
    expect(state[0].overridden).toBe(false);
  });

  it('marks plugin without name as error', async () => {
    writePlugin(dir, 'bad.js', noNamePlugin);
    const loader = new PluginLoader(dir, []);
    await loader.init();
    loader.stop();

    expect(loader.getAdapters()).toHaveLength(0);
    const state = loader.getState();
    expect(state[0].status).toBe('error');
    expect(state[0].error).toBe('missing name');
  });

  it('marks plugin without fetch as error', async () => {
    writePlugin(dir, 'nofetch.js', noFetchPlugin);
    const loader = new PluginLoader(dir, []);
    await loader.init();
    loader.stop();

    expect(loader.getAdapters()).toHaveLength(0);
    const state = loader.getState();
    expect(state[0].status).toBe('error');
    expect(state[0].error).toBe('missing fetch()');
  });

  it('marks syntax-error plugin as error', async () => {
    writePlugin(dir, 'broken.js', syntaxErrorPlugin);
    const loader = new PluginLoader(dir, []);
    await loader.init();
    loader.stop();

    expect(loader.getAdapters()).toHaveLength(0);
    const state = loader.getState();
    expect(state[0].status).toBe('error');
    expect(state[0].error).toBeDefined();
  });

  it('detects duplicate plugin names and skips second', async () => {
    writePlugin(dir, 'a.js', validPlugin);
    writePlugin(dir, 'b.js', validPlugin);
    const loader = new PluginLoader(dir, []);
    await loader.init();
    loader.stop();

    const adapters = loader.getAdapters();
    expect(adapters).toHaveLength(1);

    const state = loader.getState();
    const errors = state.filter(s => s.status === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe('duplicate name');
  });

  it('flags overridden builtin names', async () => {
    writePlugin(dir, 'override.js', validPlugin);
    const loader = new PluginLoader(dir, ['test-provider']);
    await loader.init();
    loader.stop();

    const state = loader.getState();
    expect(state[0].status).toBe('ok');
    expect(state[0].overridden).toBe(true);
  });

  it('ignores non-.js files', async () => {
    writePlugin(dir, 'readme.txt', 'not a plugin');
    writePlugin(dir, 'good.js', validPlugin);
    const loader = new PluginLoader(dir, []);
    await loader.init();
    loader.stop();

    expect(loader.getAdapters()).toHaveLength(1);
    expect(loader.getState()).toHaveLength(1);
  });

  it('removes stale entries on reload when file deleted', async () => {
    writePlugin(dir, 'good.js', validPlugin);
    const loader = new PluginLoader(dir, []);
    await loader.init();
    loader.stop();
    expect(loader.getAdapters()).toHaveLength(1);

    fs.unlinkSync(path.join(dir, 'good.js'));
    await loader.reload();
    expect(loader.getAdapters()).toHaveLength(0);
    expect(loader.getState()).toHaveLength(0);
  });

  it('handles empty directory gracefully', async () => {
    const loader = new PluginLoader(dir, []);
    await loader.init();
    loader.stop();

    expect(loader.getAdapters()).toHaveLength(0);
    expect(loader.getState()).toHaveLength(0);
  });
});
