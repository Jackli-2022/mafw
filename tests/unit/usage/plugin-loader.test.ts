import { PluginLoader } from '../../../gateway/src/usage/plugin-loader';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('PluginLoader', () => {
  let tmpDir: string;
  let loader: PluginLoader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-test-'));
    loader = new PluginLoader(tmpDir, ['builtin1']);
  });

  afterEach(() => {
    loader.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('scan loads valid plugin', async () => {
    fs.writeFileSync(path.join(tmpDir, 'good.js'), `
      module.exports = {
        name: 'test-provider',
        plan: 'Test',
        async fetch(ctx) {
          return { name: 'test-provider', plan: 'Test', windows: [] };
        },
      };
    `);
    await loader.init();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('ok');
    expect(state[0].name).toBe('test-provider');
  });

  test('scan skip .disabled files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'example.js.disabled'), 'module.exports = {};');
    await loader.init();
    expect(loader.getState()).toHaveLength(0);
  });

  test('scan fail-open on syntax error', async () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.js'), 'syntax error {{{');
    await loader.init();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('error');
    expect(state[0].error).toBeTruthy();
  });

  test('scan fail-open on missing name', async () => {
    fs.writeFileSync(path.join(tmpDir, 'no-name.js'), 'module.exports = { fetch: async () => null };');
    await loader.init();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('error');
    expect(state[0].error).toContain('name');
  });

  test('plugin overrides builtin', async () => {
    fs.writeFileSync(path.join(tmpDir, 'override.js'), `
      module.exports = { name: 'builtin1', plan: 'Override', async fetch() { return null; } };
    `);
    await loader.init();
    const state = loader.getState();
    expect(state[0].overridden).toBe(true);
  });

  test('duplicate plugin name marked as error', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), `
      module.exports = { name: 'dup', plan: 'A', async fetch() { return null; } };
    `);
    fs.writeFileSync(path.join(tmpDir, 'b.js'), `
      module.exports = { name: 'dup', plan: 'B', async fetch() { return null; } };
    `);
    await loader.init();
    const state = loader.getState();
    expect(state).toHaveLength(2);
    const a = state.find((s: any) => s.file === 'a.js');
    const b = state.find((s: any) => s.file === 'b.js');
    expect(a?.status).toBe('ok');
    expect(b?.status).toBe('error');
    expect(b?.error).toContain('duplicate');
  });

  test('hot reload picks up new file', async () => {
    await loader.init();
    expect(loader.getState()).toHaveLength(0);
    fs.writeFileSync(path.join(tmpDir, 'new.js'), `
      module.exports = { name: 'new', plan: 'New', async fetch() { return null; } };
    `);
    await new Promise(r => setTimeout(r, 500));
    expect(loader.getState()).toHaveLength(1);
    expect(loader.getState()[0].name).toBe('new');
  });

  test('hot reload removes deleted file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'temp.js'), `
      module.exports = { name: 'temp', plan: 'Temp', async fetch() { return null; } };
    `);
    await loader.init();
    expect(loader.getState()).toHaveLength(1);
    fs.unlinkSync(path.join(tmpDir, 'temp.js'));
    await new Promise(r => setTimeout(r, 500));
    expect(loader.getState()).toHaveLength(0);
  });

  describe('builtin plugins dir', () => {
    let builtinDir: string;
    let userDir: string;
    let dual: PluginLoader;

    beforeEach(() => {
      builtinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-builtin-'));
      userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-user-'));
      dual = new PluginLoader(userDir, [], { builtinPluginsDir: builtinDir });
    });

    afterEach(() => {
      dual.stop();
      fs.rmSync(builtinDir, { recursive: true, force: true });
      fs.rmSync(userDir, { recursive: true, force: true });
    });

    test('loads builtin plugins from bundled dir', async () => {
      fs.writeFileSync(path.join(builtinDir, 'b1.js'), `
        module.exports = { name: 'b1', type: 'token-plan', plan: 'B1', async fetch() { return null; } };
      `);
      await dual.init();
      const state = dual.getState();
      expect(state).toHaveLength(1);
      expect(state[0].status).toBe('ok');
      expect(state[0].builtin).toBe(true);
      expect(state[0].overridden).toBe(false);
    });

    test('user file overrides builtin with same name', async () => {
      fs.writeFileSync(path.join(builtinDir, 'b1.js'), `
        module.exports = { name: 'b1', type: 'token-plan', plan: 'B1', async fetch() { return null; } };
      `);
      fs.writeFileSync(path.join(userDir, 'my-b1.js'), `
        module.exports = { name: 'b1', type: 'api', plan: 'Custom', async fetch() { return null; } };
      `);
      await dual.init();
      const state = dual.getState();
      expect(state).toHaveLength(1);
      const s = state[0];
      expect(s.status).toBe('ok');
      expect(s.builtin).toBe(false);
      expect(s.overridden).toBe(true);
      expect(s.adapter?.name).toBe('b1');
      expect(s.adapter?.type).toBe('api');
    });

    test('disabledPlugins skips loading', async () => {
      fs.writeFileSync(path.join(builtinDir, 'b1.js'), `
        module.exports = { name: 'b1', type: 'token-plan', plan: 'B1', async fetch() { return null; } };
      `);
      dual = new PluginLoader(userDir, [], { builtinPluginsDir: builtinDir, disabledPlugins: ['b1'] });
      await dual.init();
      expect(dual.getState()).toHaveLength(0);
    });

    test('duplicate user names marked error even with builtins', async () => {
      fs.writeFileSync(path.join(builtinDir, 'b1.js'), `
        module.exports = { name: 'b1', type: 'token-plan', plan: 'B1', async fetch() { return null; } };
      `);
      fs.writeFileSync(path.join(userDir, 'u1.js'), `
        module.exports = { name: 'u1', plan: 'U1', async fetch() { return null; } };
      `);
      fs.writeFileSync(path.join(userDir, 'u2.js'), `
        module.exports = { name: 'u1', plan: 'U2', async fetch() { return null; } };
      `);
      await dual.init();
      const state = dual.getState();
      expect(state).toHaveLength(3);
      const u1 = state.find((s: any) => s.file === 'u1.js');
      const u2 = state.find((s: any) => s.file === 'u2.js');
      expect(u1?.status).toBe('ok');
      expect(u2?.status).toBe('error');
    });
  });
});
