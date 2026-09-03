import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginLoader } from '../../src/usage/plugin-loader';

const CLEANUP: string[] = [];
const LOADERS: PluginLoader[] = [];
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usage-disabled-'));
  CLEANUP.push(d);
  return d;
}
afterAll(() => {
  for (const l of LOADERS) l.stop();
  for (const d of CLEANUP) fs.rmSync(d, { recursive: true, force: true });
});

describe('PluginLoader disabled semantics', () => {
  it('keeps disabled plugins in state but out of adapters', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'a.js'), `module.exports = { name: 'a', fetch: async () => null };`);
    fs.writeFileSync(path.join(dir, 'b.js'), `module.exports = { name: 'b', fetch: async () => null };`);
    const loader = new PluginLoader(dir, [], { disabledPlugins: ['a'] });
    LOADERS.push(loader);
    await loader.init();
    const state = loader.getState();
    expect(state.find(s => s.name === 'a')?.disabled).toBe(true);
    expect(state.find(s => s.name === 'b')?.disabled).toBe(false);
    expect(loader.getAdapters().map(x => x.name)).toEqual(['b']);
  });

  it('isBuiltinName reflects declared builtin names', async () => {
    const loader = new PluginLoader(tmpDir(), ['deepseek']);
    LOADERS.push(loader);
    await loader.init();
    expect(loader.isBuiltinName('deepseek')).toBe(true);
    expect(loader.isBuiltinName('nope')).toBe(false);
  });
});
