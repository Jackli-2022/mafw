import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../../src/runtime/loader';
import { minimalCapabilities } from '../../../src/runtime/contract';

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../src/config', () => ({ config: { raw: {} } }));

describe('RuntimePluginLoader registerBuiltin', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-builtin-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('registerBuiltin makes get() return the builtin factory', async () => {
    const loader = new RuntimePluginLoader(dir);
    const caps = { ...minimalCapabilities(), eventStream: true };
    loader.registerBuiltin('my-builtin', async () => ({ name: 'my-builtin' } as any), caps, true);
    await loader.init();

    const plugin = loader.get('my-builtin');
    expect(plugin).toBeDefined();
    expect(plugin!.capabilities.eventStream).toBe(true);
    expect(plugin!.external).toBe(true);
    expect(typeof plugin!.createRuntime).toBe('function');
  });

  it('file plugins take precedence over builtins of the same name', async () => {
    const loader = new RuntimePluginLoader(dir);
    loader.registerBuiltin('dup', async () => ({ name: 'dup-builtin' } as any), minimalCapabilities(), true);
    fs.writeFileSync(path.join(dir, 'dup.js'), `module.exports = { name: 'dup', async createRuntime() { return { name: 'dup-file' }; } };`);
    await loader.init();

    const plugin = loader.get('dup');
    const rt = await plugin!.createRuntime({} as any);
    expect(rt.name).toBe('dup-file');
  });

  it('getState() reports builtins as ok with source builtin', async () => {
    const loader = new RuntimePluginLoader(dir);
    loader.registerBuiltin('b1', async () => ({ name: 'b1' } as any), minimalCapabilities(), true);
    await loader.init();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].name).toBe('b1');
    expect(state[0].status).toBe('ok');
  });
});