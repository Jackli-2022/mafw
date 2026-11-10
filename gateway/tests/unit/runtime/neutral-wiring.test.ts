import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRuntimeFacade } from '../../../src/runtime/runtime-facade';

const GATEWAY = path.join(__dirname, '../../..');

function canonicalEvent(type: string, properties: Record<string, unknown> = {}) {
  return { payload: { type, properties }, sessionID: 's1' };
}

it('neutral:true passes the canonical stream through without translation', async () => {
  const raw: any = {
    name: 'fake',
    capabilities: {},
    session: {},
    global: {
      event: async () => ({
        stream: (async function* () {
          yield canonicalEvent('turn.completed', { turnID: 't1' });
        })(),
      }),
    },
  };
  const facade = await createRuntimeFacade(raw, {
    neutral: true,
    // If the facade tried to translate, this entry would rewrite the type.
    entry: { eventMappings: [{ from: 'turn.completed', to: 'session.created' }] },
    isCanonical: (t) => t === 'turn.completed',
  });
  const result: any = await facade.global.event();
  for await (const evt of result.stream) {
    expect(evt.payload.type).toBe('turn.completed');
    return;
  }
  throw new Error('no event yielded');
});

it('gateway composition root drives builtins through the neutral path', () => {
  const src = fs.readFileSync(path.join(GATEWAY, 'src', 'index.ts'), 'utf8');
  // D3 Task 5：内置 runtime 注册（runtime.loader 启动步骤）搬进 src/boot.ts。
  const bootSrc = fs.readFileSync(path.join(GATEWAY, 'src', 'boot.ts'), 'utf8');
  expect(src).toContain('resolveBuiltinDefinition');
  expect(src).toContain('createNeutralRuntime');
  expect(bootSrc).toContain('registerBuiltinDefinition');
  expect(src).not.toMatch(/\(rawRuntime as any\)\.registry/);
  expect(src).not.toContain('wirePiPermissionEvaluator');
  expect(src).not.toContain('wirePiCognition');
});
