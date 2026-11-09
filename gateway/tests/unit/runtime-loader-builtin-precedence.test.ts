import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../src/runtime/loader';
import { fullCapabilities } from '../../src/runtime/contract';

describe('opencode as registered builtin definition', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rtblt-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('registerBuiltinDefinition(opencode) 后 getBuiltinNames 含 opencode', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.registerBuiltinDefinition('opencode', async () => ({}) as any, {
      external: false,
      capabilities: fullCapabilities(),
    });
    expect(loader.getBuiltinNames()).toContain('opencode');
    expect(loader.get('opencode')).toBeUndefined();
    expect(loader.getState().find((s) => s.name === 'opencode')?.status).toBe('ok');
  });

  it('用户 legacy 文件 opencode.js 覆盖内置', async () => {
    fs.writeFileSync(path.join(dir, 'opencode.js'), `
module.exports = { name: 'opencode', capabilities: {}, async createRuntime() { return { name: 'user-opencode', session: { messages: async () => ({ data: [] }) } }; } };
`);
    let built = 0;
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.registerBuiltinDefinition('opencode', async () => { built += 1; return ({}) as any; }, {
      external: false,
      capabilities: fullCapabilities(),
    });
    await loader.scan();
    const resolved = await loader.resolveBuiltinDefinition('opencode', {});
    expect(resolved).toBeDefined();
    expect(built).toBe(0);
  });
});
