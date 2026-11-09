import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../src/runtime/loader';

describe('RuntimePluginLoader package entries', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rtpkg-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('setPackageEntries 后 get() 可解析，capabilities 合并 minimal 基线', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    const factory = async () => ({ name: 'pkg-rt', capabilities: {} }) as any;
    loader.setPackageEntries([{ name: 'pkg-rt', createRuntime: factory, capabilities: { eventStream: true }, external: true, source: '/x.js' }]);
    const got = loader.get('pkg-rt');
    expect(got).toBeDefined();
    expect(got!.external).toBe(true);
    expect(got!.capabilities.eventStream).toBe(true);
    expect(got!.capabilities.sessionApi).toBe(true); // minimal 基线
  });

  it('legacy 文件插件优先于同名包条目', async () => {
    fs.writeFileSync(path.join(dir, 'pkg-rt.js'), `
module.exports = { name: 'pkg-rt', capabilities: {}, async createRuntime() { return { name: 'from-file' }; } };
`);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.setPackageEntries([{ name: 'pkg-rt', createRuntime: async () => ({ name: 'from-package' }) as any, capabilities: {}, external: true, source: '/x.js' }]);
    const rt = await loader.get('pkg-rt')!.createRuntime({} as any);
    expect(rt.name).toBe('from-file');
  });

  it('包条目优先于同名内置', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.registerBuiltinDefinition('pkg-rt', async () => ({ name: 'from-builtin' }) as any, { external: true, capabilities: {} as any });
    loader.setPackageEntries([{ name: 'pkg-rt', createRuntime: async () => ({ name: 'from-package' }) as any, capabilities: {}, external: true, source: '/x.js' }]);
    const rt = await loader.get('pkg-rt')!.createRuntime({} as any);
    expect(rt.name).toBe('from-package');
    expect(loader.has('pkg-rt')).toBe(true);
  });

  it('scan() 不清包条目；getState 含 package: 条目', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.setPackageEntries([{ name: 'pkg-rt', createRuntime: async () => ({}) as any, capabilities: {}, external: true, source: '/x.js' }]);
    await loader.scan();
    expect(loader.get('pkg-rt')).toBeDefined();
    const st = loader.getState();
    expect(st.some((s) => s.file === 'package:pkg-rt')).toBe(true);
  });

  it('空数组清空包条目', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.setPackageEntries([{ name: 'pkg-rt', createRuntime: async () => ({}) as any, capabilities: {}, external: true, source: '/x.js' }]);
    loader.setPackageEntries([]);
    expect(loader.get('pkg-rt')).toBeUndefined();
  });

  it('包条目不会被同名内置定义在激活路径上遮蔽', async () => {
    let built = 0;
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.registerBuiltinDefinition('pkg-rt', async () => { built += 1; return ({}) as any; }, {
      external: false,
      capabilities: {} as any,
    });
    loader.setPackageEntries([{ name: 'pkg-rt', createRuntime: async () => ({ name: 'from-package' }) as any, capabilities: {}, external: true, source: '/x.js' }]);

    expect(await loader.resolveBuiltinDefinition('pkg-rt', {})).toBeUndefined();
    expect(built).toBe(0);
    expect(loader.get('pkg-rt')).toBeDefined();
  });
});
