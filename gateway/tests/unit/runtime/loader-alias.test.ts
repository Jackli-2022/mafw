// Filename-stem alias registration: the plugin hub addresses runtime plugins
// by filename stem (hub.ts baseName), while activation validates by
// module.exports.name. When the two differ, hub "激活" 404s with
// "Runtime plugin '<stem>' not found". The loader must resolve BOTH names.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../../src/runtime/loader';

const FACTORY_A = async () => ({ name: 'a' } as any);

function writePlugin(dir: string, filename: string, moduleName: string): void {
  fs.writeFileSync(
    path.join(dir, filename),
    `module.exports = { name: ${JSON.stringify(moduleName)}, capabilities: {}, external: true, async createRuntime() { return { name: ${JSON.stringify(moduleName)} }; } };`,
  );
}

function makeLoader(dir: string): RuntimePluginLoader {
  const loader = new RuntimePluginLoader(dir);
  loader.registerBuiltin(
    'pi',
    FACTORY_A,
    { sessionApi: true } as any,
    true,
  );
  return loader;
}

describe('RuntimePluginLoader filename-stem alias', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-loader-alias-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('resolves both the module name and the filename stem to the same factory', async () => {
    writePlugin(dir, 'foo.js', 'bar');
    const loader = makeLoader(dir);
    await loader.init();
    const byModule = loader.get('bar');
    const byStem = loader.get('foo');
    expect(byModule).toBeDefined();
    expect(byStem).toBeDefined();
    expect(byStem!.createRuntime).toBe(byModule!.createRuntime);
  });

  test('a later real module name overwrites an earlier stem alias', async () => {
    // scan order (sorted): a.js registers real name "x" + alias "a";
    // b.js declares the real name "a" — the real registration must win.
    writePlugin(dir, 'a.js', 'x');
    writePlugin(dir, 'b.js', 'a');
    const loader = makeLoader(dir);
    await loader.init();
    expect(loader.get('a')!.createRuntime).not.toBe(FACTORY_A);
    const viaAlias = loader.get('a');
    const viaB = loader.get('b'); // stem of b.js (same as its module name)
    expect(viaAlias!.createRuntime).toBe(viaB!.createRuntime);
  });

  test('stem alias never shadows a builtin with the same stem', async () => {
    writePlugin(dir, 'pi.js', 'xyz');
    const loader = makeLoader(dir);
    await loader.init();
    expect(loader.get('pi')!.createRuntime).toBe(FACTORY_A); // builtin wins
    expect(loader.get('xyz')).toBeDefined();
  });

  test('removing the file removes the alias on rescan (no leaked keys)', async () => {
    writePlugin(dir, 'foo.js', 'bar');
    const loader = makeLoader(dir);
    await loader.init();
    expect(loader.get('foo')).toBeDefined();
    fs.unlinkSync(path.join(dir, 'foo.js'));
    await loader.scan();
    expect(loader.get('foo')).toBeUndefined();
    expect(loader.get('bar')).toBeUndefined();
  });
});
