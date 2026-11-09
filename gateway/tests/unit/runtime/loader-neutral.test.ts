import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RuntimePluginLoader } from '../../../src/runtime/loader';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-neutral-loader-'));
}

function transport() {
  return {
    createSession: async () => ({ sessionID: 's1' }),
    sendTurn: async (input: any) => ({ turnID: input.turnID }),
    interruptTurn: async () => {},
    onEvent: () => () => {},
  };
}

it('loads a static neutral definition and exposes it on the bus', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'neutral.js'), `module.exports = ${JSON.stringify({
    name: 'fake-neutral', api: 1, eventApi: 1, preset: 'core',
  })}; module.exports.transport = {
    createSession: async () => ({ sessionID: 's1' }),
    sendTurn: async (input) => ({ turnID: input.turnID }),
    interruptTurn: async () => {},
    onEvent: () => () => {},
  };`);
  const loader = new RuntimePluginLoader(dir);
  await loader.init();
  expect(loader.getNeutralDefinitions().map((d) => d.name)).toContain('fake-neutral');
  const resolved = await loader.getNeutral('fake-neutral', {});
  expect(resolved?.name).toBe('fake-neutral');
});

it('loads an async createRuntimeDefinition factory lazily', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'factory.js'), `module.exports = {
    name: 'fake-factory',
    createRuntimeDefinition: async () => ({
      api: 1, eventApi: 1, name: 'fake-factory', displayName: 'Fake', preset: 'core',
      transport: {
        createSession: async () => ({ sessionID: 's1' }),
        sendTurn: async (input) => ({ turnID: input.turnID }),
        interruptTurn: async () => {},
        onEvent: () => () => {},
      },
      capabilities: {},
    }),
  };`);
  const loader = new RuntimePluginLoader(dir);
  await loader.init();
  const resolved = await loader.getNeutral('fake-factory', {});
  expect(resolved?.name).toBe('fake-factory');
});
