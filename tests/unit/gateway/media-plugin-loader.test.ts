import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MediaPluginLoader } from '../../../gateway/src/media/media-plugin-loader';

describe('MediaPluginLoader', () => {
  let tmpDir: string;
  let loader: MediaPluginLoader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-plugins-'));
    loader = new MediaPluginLoader(tmpDir);
  });

  afterEach(() => {
    loader.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates dir with README and example on init', async () => {
    const dir = path.join(os.tmpdir(), 'media-plugins-new-' + Date.now());
    const l = new MediaPluginLoader(dir);
    await l.init();
    expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'example.js.disabled'))).toBe(true);
    l.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads a valid form-A plugin (custom engine)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.js'), `
      module.exports = {
        name: "test-engine",
        modalities: ["image", "video"],
        async createPrompt(ctx) {
          return async (parts, opts) => "test result";
        },
      };
    `);
    await loader.init();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('ok');
    expect(state[0].name).toBe('test-engine');
    expect(state[0].modalities).toEqual(['image', 'video']);
    const engines = loader.getEngines();
    expect(engines.has('test-engine')).toBe(true);
    const prompt = engines.get('test-engine')!.prompt;
    const result = await prompt([{ type: 'text', text: 'hi' }], { providerID: 'x', modelID: 'y' });
    expect(result).toBe('test result');
  });

  it('loads a valid form-B plugin (pi engine with fixPayload)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'pi-custom.js'), `
      module.exports = {
        name: "pi-custom",
        modalities: ["video"],
        engine: "pi",
        fixPayload(payload) { return payload; },
      };
    `);
    await loader.init();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('ok');
    expect(state[0].name).toBe('pi-custom');
    expect(loader.getEngines().has('pi-custom')).toBe(true);
  });

  it('rejects plugin without name', async () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.js'), `
      module.exports = { modalities: ["image"], async createPrompt() { return async () => "x"; } };
    `);
    await loader.init();
    expect(loader.getState()[0].status).toBe('error');
    expect(loader.getState()[0].error).toMatch(/missing name/);
  });

  it('rejects plugin with invalid modalities', async () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.js'), `
      module.exports = { name: "bad", modalities: ["image", "bogus"], async createPrompt() { return async () => "x"; } };
    `);
    await loader.init();
    expect(loader.getState()[0].status).toBe('error');
    expect(loader.getState()[0].error).toMatch(/invalid modalities/);
  });

  it('rejects plugin with neither createPrompt nor engine:pi', async () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.js'), `
      module.exports = { name: "bad", modalities: ["image"] };
    `);
    await loader.init();
    expect(loader.getState()[0].status).toBe('error');
    expect(loader.getState()[0].error).toMatch(/missing createPrompt/);
  });

  it('rejects plugin with both createPrompt and engine:pi', async () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.js'), `
      module.exports = { name: "bad", modalities: ["image"], engine: "pi", async createPrompt() { return async () => "x"; } };
    `);
    await loader.init();
    expect(loader.getState()[0].status).toBe('error');
    expect(loader.getState()[0].error).toMatch(/mutually exclusive/);
  });

  it('rejects duplicate names', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), `
      module.exports = { name: "dup", modalities: ["image"], async createPrompt() { return async () => "x"; } };
    `);
    fs.writeFileSync(path.join(tmpDir, 'b.js'), `
      module.exports = { name: "dup", modalities: ["video"], async createPrompt() { return async () => "y"; } };
    `);
    await loader.init();
    const states = loader.getState();
    expect(states.filter(s => s.status === 'ok')).toHaveLength(1);
    expect(states.filter(s => s.status === 'error' && s.error?.includes('duplicate'))).toHaveLength(1);
  });

  it('hot reloads on file change', async () => {
    await loader.init();
    expect(loader.getState()).toHaveLength(0);
    fs.writeFileSync(path.join(tmpDir, 'new.js'), `
      module.exports = { name: "new", modalities: ["image"], async createPrompt() { return async () => "hot"; } };
    `);
    await new Promise(r => setTimeout(r, 500));
    expect(loader.getState()).toHaveLength(1);
    expect(loader.getState()[0].name).toBe('new');
  });

  it('handles directory deletion gracefully', async () => {
    await loader.init();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await new Promise(r => setTimeout(r, 500));
    expect(loader.getState()).toHaveLength(0);
  });

  it('removes engine when file is deleted', async () => {
    fs.writeFileSync(path.join(tmpDir, 'temp.js'), `
      module.exports = { name: "temp", modalities: ["image"], async createPrompt() { return async () => "x"; } };
    `);
    await loader.init();
    expect(loader.getEngines().has('temp')).toBe(true);
    fs.unlinkSync(path.join(tmpDir, 'temp.js'));
    await new Promise(r => setTimeout(r, 500));
    expect(loader.getEngines().has('temp')).toBe(false);
  });
});
