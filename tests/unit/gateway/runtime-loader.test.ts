import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RuntimePluginLoader } from '../../../gateway/src/runtime/loader';

describe('RuntimePluginLoader', () => {
  let dir: string;
  let loader: RuntimePluginLoader;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-plugins-'));
    loader = new RuntimePluginLoader(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates plugins dir with README and disabled example on init', async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    await loader.init();
    expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'example.js.disabled'))).toBe(true);
  });

  it('loads a valid plugin, merging capabilities over minimal defaults', async () => {
    fs.writeFileSync(path.join(dir, 'my.js'), `module.exports = {
      name: 'my-runtime',
      capabilities: { eventStream: true },
      async createRuntime(ctx) { return { name: 'my-runtime' }; },
    };`);
    await loader.init();
    const p = loader.get('my-runtime');
    expect(p).toBeDefined();
    expect(p!.capabilities).toEqual({
      sessionApi: true, promptWhileBusy: true, eventStream: true,
      nativeApprovals: false, providerConfigApi: false, perLlmCallTransform: false,
    });
    expect(p!.external).toBe(true);
    expect(loader.getState()).toEqual([
      expect.objectContaining({ file: 'my.js', name: 'my-runtime', status: 'ok' }),
    ]);
  });

  it('rejects plugins without name or createRuntime, keeping good ones (fail-open per file)', async () => {
    fs.writeFileSync(path.join(dir, 'bad1.js'), `module.exports = { async createRuntime() { return {}; } };`);
    fs.writeFileSync(path.join(dir, 'bad2.js'), `module.exports = { name: 'x' };`);
    fs.writeFileSync(path.join(dir, 'good.js'), `module.exports = { name: 'good', async createRuntime() { return {}; } };`);
    await loader.init();
    expect(loader.get('good')).toBeDefined();
    const state = loader.getState();
    expect(state.find(s => s.file === 'bad1.js')).toEqual(
      expect.objectContaining({ status: 'error', error: 'missing name' }));
    expect(state.find(s => s.file === 'bad2.js')).toEqual(
      expect.objectContaining({ status: 'error', error: 'missing createRuntime(ctx)' }));
  });

  it('survives a plugin that throws at require time', async () => {
    fs.writeFileSync(path.join(dir, 'boom.js'), `throw new Error('nope');`);
    await loader.init();
    expect(loader.getState()[0]).toEqual(
      expect.objectContaining({ file: 'boom.js', status: 'error', error: 'nope' }));
  });

  it('duplicate names: first file wins, second recorded as error', async () => {
    fs.writeFileSync(path.join(dir, 'a.js'), `module.exports = { name: 'dup', async createRuntime() { return {}; } };`);
    fs.writeFileSync(path.join(dir, 'b.js'), `module.exports = { name: 'dup', async createRuntime() { return {}; } };`);
    await loader.init();
    expect(loader.get('dup')).toBeDefined();
    expect(loader.getState().find(s => s.file === 'b.js')).toEqual(
      expect.objectContaining({ status: 'error', error: 'duplicate name' }));
  });
});
