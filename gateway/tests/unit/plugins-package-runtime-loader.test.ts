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
    loader.registerBuiltin('pkg-rt', async () => ({ name: 'from-builtin' }) as any, {} as any, true);
    loader.setPackageEntries([{ name: 'pkg-rt', createRuntime: async () => ({ name: 'from-package' }) as any, capabilities: {}, external: true, source: '/x.js' }]);
    const rt = await loader.get('pkg-rt')!.createRuntime({} as any);
    expect(rt.name).toBe('from-package');
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
});
