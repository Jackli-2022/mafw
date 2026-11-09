import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defineRuntime } from '@mafw/runtime-contract';
import { RuntimePluginLoader } from '../../../src/runtime/loader';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-builtin-def-'));
}

function definition(name: string) {
  return defineRuntime({
    api: 1, name, displayName: name, preset: 'core',
    transport: {
      createSession: async () => ({ sessionID: 's1' }),
      sendTurn: async (input) => ({ turnID: input.turnID }),
      interruptTurn: async () => {},
      onEvent: () => () => {},
    },
  });
}

it('resolves a lazily registered builtin definition', async () => {
  const loader = new RuntimePluginLoader(tempDir());
  await loader.init();
  loader.registerBuiltinDefinition('fake', async () => definition('fake'), {
    external: false,
    capabilities: definition('fake').capabilities,
  });
  const resolved = await loader.resolveBuiltinDefinition('fake', {});
  expect(resolved?.name).toBe('fake');
});

it('builds a fresh definition on every activation (no disposed reuse)', async () => {
  let calls = 0;
  const loader = new RuntimePluginLoader(tempDir());
  await loader.init();
  loader.registerBuiltinDefinition('fake', async () => { calls += 1; return definition('fake'); }, {
    external: false,
    capabilities: definition('fake').capabilities,
  });
  const first = await loader.resolveBuiltinDefinition('fake', {});
  const second = await loader.resolveBuiltinDefinition('fake', {});
  expect(calls).toBe(2);
  expect(first).not.toBe(second);
});

it('returns undefined for an unknown builtin', async () => {
  const loader = new RuntimePluginLoader(tempDir());
  await loader.init();
  expect(await loader.resolveBuiltinDefinition('nope', {})).toBeUndefined();
});
