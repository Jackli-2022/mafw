import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { defineRuntime } from '@mafw/runtime-contract';
import { RuntimePluginLoader } from '../../../src/runtime/loader';
import { minimalCapabilities } from '../../../src/runtime/contract';

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../src/config', () => ({ config: { raw: {} } }));

function definition(name: string) {
  return defineRuntime({
    api: 1,
    name,
    displayName: name,
    preset: 'core',
    transport: {
      createSession: async () => ({ sessionID: 's1' }),
      sendTurn: async (input) => ({ turnID: input.turnID }),
      interruptTurn: async () => {},
      onEvent: () => () => {},
    },
  });
}

describe('RuntimePluginLoader registerBuiltinDefinition', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-builtin-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('resolves a builtin definition and exposes it in hub state', async () => {
    const loader = new RuntimePluginLoader(dir);
    loader.registerBuiltinDefinition('my-builtin', async () => definition('my-builtin'), {
      external: true,
      capabilities: { ...minimalCapabilities(), eventStream: true },
    });

    const resolved = await loader.resolveBuiltinDefinition('my-builtin', {});
    expect(resolved?.name).toBe('my-builtin');
    expect(loader.getBuiltinNames()).toContain('my-builtin');
    expect(loader.get('my-builtin')).toBeUndefined();

    const state = loader.getState().find((s) => s.name === 'my-builtin');
    expect(state?.status).toBe('ok');
    expect(state?.capabilities?.eventStream).toBe(true);
  });

  it('file plugins take precedence over a same-name builtin definition', async () => {
    fs.writeFileSync(path.join(dir, 'dup.js'), `module.exports = { name: 'dup', async createRuntime() { return { name: 'dup-file', session: { messages: async () => ({ data: [] }) } }; } };`);
    let built = 0;
    const loader = new RuntimePluginLoader(dir);
    loader.registerBuiltinDefinition('dup', async () => { built += 1; return definition('dup-builtin'); }, {
      external: false,
      capabilities: minimalCapabilities(),
    });
    await loader.init();

    const resolved = await loader.resolveBuiltinDefinition('dup', {});
    expect(resolved).toBeDefined();
    expect(built).toBe(0);
  });

  it('pi capabilities stay a single object', async () => {
    const { PI_CAPABILITIES } = await import('../../../../adapters/pi/src/runtime');
    const loader = new RuntimePluginLoader(dir);
    loader.registerBuiltinDefinition('pi', async () => definition('pi'), {
      external: false,
      capabilities: PI_CAPABILITIES,
    });

    const state = loader.getState().find((s) => s.name === 'pi');
    expect(state?.capabilities).toBe(PI_CAPABILITIES);
  });
});
