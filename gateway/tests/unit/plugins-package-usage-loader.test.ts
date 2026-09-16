import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginLoader } from '../../src/usage/plugin-loader';

const MOD = (name: string) => ({
  name, type: 'api', plan: 'P',
  async fetch() { return null; },
});

describe('usage PluginLoader package entries', () => {
  let dir: string;
  let loader: PluginLoader;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usgpkg-')); });
  afterEach(() => { loader?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('包适配器并入 getAdapters()', async () => {
    loader = new PluginLoader(dir, []);
    await loader.init();
    expect(loader.getAdapters()).toHaveLength(0);
    loader.setPackageEntries([{ mod: MOD('pkg-a') as any, source: '/x.js' }]);
    const adapters = loader.getAdapters();
    expect(adapters.map((a) => a.name)).toEqual(['pkg-a']);
  });

  it('同名时包覆盖 legacy 文件', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), `
module.exports = { name: 'acme', type: 'api', plan: 'legacy', async fetch() { return null; } };
`);
    loader = new PluginLoader(dir, []);
    await loader.init();
    loader.setPackageEntries([{ mod: { ...MOD('acme'), plan: 'package' } as any, source: '/pkg.js' }]);
    const adapters = loader.getAdapters().filter((a) => a.name === 'acme');
    expect(adapters).toHaveLength(1);
    expect(loader.getState().filter((s) => s.name === 'acme' && s.file === '/pkg.js')).toHaveLength(1);
  });

  it('disabledPlugins 对包条目同样生效', async () => {
    loader = new PluginLoader(dir, [], { disabledPlugins: ['pkg-a'] });
    await loader.init();
    loader.setPackageEntries([{ mod: MOD('pkg-a') as any, source: '/x.js' }]);
    expect(loader.getAdapters()).toHaveLength(0);
    expect(loader.getState().find((s) => s.name === 'pkg-a')?.disabled).toBe(true);
  });

  it('空数组清空；reload 不清包条目', async () => {
    loader = new PluginLoader(dir, []);
    await loader.init();
    loader.setPackageEntries([{ mod: MOD('pkg-a') as any, source: '/x.js' }]);
    await loader.reload();
    expect(loader.getAdapters().map((a) => a.name)).toEqual(['pkg-a']);
    loader.setPackageEntries([]);
    expect(loader.getAdapters()).toHaveLength(0);
  });
});
