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

it('removes neutral registrations when the plugin file disappears', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'gone.js');
  fs.writeFileSync(file, `module.exports = { name: 'gone', api: 1, eventApi: 1, preset: 'core', transport: {
    createSession: async () => ({ sessionID: 's1' }),
    sendTurn: async (input) => ({ turnID: input.turnID }),
    interruptTurn: async () => {},
    onEvent: () => () => {},
  } };`);
  const loader = new RuntimePluginLoader(dir);
  await loader.init();
  expect(loader.getNeutralDefinitions().map((d) => d.name)).toContain('gone');
  fs.rmSync(file);
  await loader.scan();
  expect(loader.getNeutralDefinitions().map((d) => d.name)).not.toContain('gone');
});

it('uses the file stem when an async factory has no static name', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'no-name.js'), `module.exports = {
    createRuntimeDefinition: async () => ({
      api: 1, eventApi: 1, name: 'no-name', displayName: 'No Name', preset: 'core',
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
  const resolved = await loader.getNeutral('no-name', {});
  expect(resolved?.name).toBe('no-name');
});
