import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MediaPluginLoader } from '../../src/media/media-plugin-loader';

const ENTRY = (name: string) => ({
  name,
  prompt: (async () => 'ok') as any,
  modalities: ['image'],
  source: '/pkg.js',
});

describe('MediaPluginLoader package + builtin engines', () => {
  let dir: string;
  let loader: MediaPluginLoader;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-mediapkg-')); });
  afterEach(() => { loader?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('registerBuiltinEngine 出现在 getEngines，带 builtin 标记', async () => {
    loader = new MediaPluginLoader(dir);
    await loader.init();
    loader.registerBuiltinEngine('pi', ['image', 'video', 'audio']);
    const pi = loader.getEngines().get('pi');
    expect(pi).toBeDefined();
    expect(pi!.builtin).toBe(true);
    expect(loader.getBuiltinEngineNames()).toEqual(['pi']);
  });

  it('legacy 文件覆盖同名内置引擎', async () => {
    fs.writeFileSync(path.join(dir, 'pi.js'), `
module.exports = { name: 'pi', modalities: ['image'], engine: 'pi', fixPayload: (p) => p };
`);
    loader = new MediaPluginLoader(dir);
    await loader.init();
    loader.registerBuiltinEngine('pi', ['image', 'video', 'audio']);
    await loader.reload();
    const pi = loader.getEngines().get('pi');
    expect(pi!.builtin).toBeUndefined();
    expect(pi!.modalities).toEqual(['image']);
  });

  it('包条目覆盖同名内置与 legacy', async () => {
    fs.writeFileSync(path.join(dir, 'pi.js'), `
module.exports = { name: 'pi', modalities: ['image'], engine: 'pi', fixPayload: (p) => p };
`);
    loader = new MediaPluginLoader(dir);
    await loader.init();
    loader.registerBuiltinEngine('pi', ['image', 'video', 'audio']);
    loader.setPackageEntries([ENTRY('pi') as any]);
    const pi = loader.getEngines().get('pi');
    expect((pi as any)!.source).toBe('/pkg.js');
  });

  it('scan() 不清包条目与内置；空数组清空包条目', async () => {
    loader = new MediaPluginLoader(dir);
    await loader.init();
    loader.registerBuiltinEngine('pi', ['image', 'video', 'audio']);
    loader.setPackageEntries([ENTRY('acme') as any]);
    await loader.scan();
    expect(loader.getEngines().has('acme')).toBe(true);
    expect(loader.getEngines().has('pi')).toBe(true);
    loader.setPackageEntries([]);
    expect(loader.getEngines().has('acme')).toBe(false);
  });
});
