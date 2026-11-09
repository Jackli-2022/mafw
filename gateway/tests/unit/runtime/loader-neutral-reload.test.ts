import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../../src/runtime/loader';

function neutralModule(displayName: string): string {
  return `module.exports = {
    name: 'reloadable',
    api: 1,
    eventApi: 1,
    preset: 'core',
    displayName: ${JSON.stringify(displayName)},
    capabilities: {},
    transport: {
      createSession: async () => ({ sessionID: 's1' }),
      sendTurn: async (input) => ({ turnID: input.turnID }),
      interruptTurn: async () => {},
      onEvent: () => () => {},
    },
  };`;
}

describe('file-neutral definitions', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-neutral-reload-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('re-evaluates the module on every activation', async () => {
    const file = path.join(dir, 'reloadable.js');
    fs.writeFileSync(file, neutralModule('one'));
    const loader = new RuntimePluginLoader(dir);
    await loader.init();

    const first = await loader.resolveBuiltinDefinition('reloadable', {});
    expect(first?.displayName).toBe('one');

    fs.writeFileSync(file, neutralModule('two'));
    const second = await loader.resolveBuiltinDefinition('reloadable', {});
    expect(second?.displayName).toBe('two');
    expect(second).not.toBe(first);
    expect(second!.transport).not.toBe(first!.transport);
  });

  it('file-neutral wins over a same-name builtin definition', async () => {
    fs.writeFileSync(path.join(dir, 'reloadable.js'), neutralModule('file'));
    let built = 0;
    const loader = new RuntimePluginLoader(dir);
    loader.registerBuiltinDefinition('reloadable', async () => { built += 1; return {} as any; }, {
      external: false,
      capabilities: {} as any,
    });
    await loader.init();

    const resolved = await loader.resolveBuiltinDefinition('reloadable', {});
    expect(resolved?.displayName).toBe('file');
    expect(built).toBe(0);
  });
});
