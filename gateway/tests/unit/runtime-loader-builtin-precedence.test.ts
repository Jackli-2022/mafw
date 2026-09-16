import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../src/runtime/loader';
import { fullCapabilities } from '../../src/runtime/contract';

describe('opencode as registered builtin', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rtblt-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('registerBuiltin(opencode) 后 getBuiltinNames 含 opencode', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.registerBuiltin('opencode', async () => ({ name: 'opencode' }) as any, fullCapabilities(), false);
    expect(loader.getBuiltinNames()).toContain('opencode');
    expect(loader.get('opencode')!.external).toBe(false);
  });

  it('用户 legacy 文件 opencode.js 覆盖内置', async () => {
    fs.writeFileSync(path.join(dir, 'opencode.js'), `
module.exports = { name: 'opencode', capabilities: {}, async createRuntime() { return { name: 'user-opencode' }; } };
`);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.registerBuiltin('opencode', async () => ({ name: 'builtin-opencode' }) as any, fullCapabilities(), false);
    await loader.scan();
    const rt = await loader.get('opencode')!.createRuntime({} as any);
    expect(rt.name).toBe('user-opencode');
  });
});
