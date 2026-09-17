import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TtsPluginLoader } from '../../src/tts/tts-plugin-loader';

function writePlugin(dir: string, file: string, content: string): void {
  fs.writeFileSync(path.join(dir, file), content);
}

const VALID_PLUGIN = `
module.exports = {
  name: 'fake-tts',
  capabilities: { streaming: 'none', voiceCloning: false, styleControl: false, languages: ['zh'], sampleRate: 22050 },
  voices() { return [{ id: 'a', label: 'A', lang: 'zh' }]; },
  async synthesize() { return Buffer.from('RIFF-fake'); },
};
`;

describe('TtsPluginLoader', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsplug-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('loads valid plugin as TtsEngine', async () => {
    writePlugin(dir, 'fake.js', VALID_PLUGIN);
    const loader = new TtsPluginLoader(dir);
    await loader.init();
    loader.stop();
    const engines = loader.getEngines();
    expect(engines).toHaveLength(1);
    expect(engines[0].name).toBe('fake-tts');
    expect(engines[0].capabilities.sampleRate).toBe(22050);
    expect(engines[0].voices()[0].id).toBe('a');
  });

  test('invalid plugin (missing synthesize) → error state, no throw', async () => {
    writePlugin(dir, 'bad.js', `module.exports = { name: 'bad' };`);
    const loader = new TtsPluginLoader(dir);
    await loader.init();
    loader.stop();
    expect(loader.getEngines()).toHaveLength(0);
    expect(loader.getState()[0].status).toBe('error');
  });

  test('plugin throwing on require → error state, loader survives', async () => {
    writePlugin(dir, 'boom.js', `throw new Error('boom');`);
    const loader = new TtsPluginLoader(dir);
    await loader.init();
    loader.stop();
    expect(loader.getState()[0].status).toBe('error');
    expect(loader.getState()[0].error).toMatch(/boom/);
  });

  test('plugin ctx provides fetch/log/pluginConfig', async () => {
    writePlugin(dir, 'ctx.js', `
      module.exports = {
        name: 'ctx-probe',
        capabilities: { streaming: 'none', voiceCloning: false, styleControl: false, languages: [], sampleRate: 24000 },
        voices() { return []; },
        async synthesize(text, opts, ctx) {
          if (typeof ctx.fetch !== 'function') throw new Error('no fetch');
          if (typeof ctx.pluginConfig !== 'function') throw new Error('no pluginConfig');
          return Buffer.from('ok');
        },
      };
    `);
    const loader = new TtsPluginLoader(dir);
    await loader.init();
    loader.stop();
    const e = loader.getEngines()[0];
    const out = await e.synthesize('hi', {});
    expect(out.toString()).toBe('ok');
  });

  test('onChanged fires after scan picks up new engines', async () => {
    let notified = 0;
    const loader = new TtsPluginLoader(dir, { onChanged: () => { notified++; } });
    await loader.init();
    loader.stop();
    writePlugin(dir, 'late.js', VALID_PLUGIN.replace('fake-tts', 'late-tts'));
    await loader.reload();
    loader.stop();
    expect(notified).toBeGreaterThan(0);
    expect(loader.getEngines().some(e => e.name === 'late-tts')).toBe(true);
  });
});
