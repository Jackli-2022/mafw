import { buildMafwCommandRegistry, handleMafwCommandRun, handleMafwCommandList } from '../../src/routes/mafw-commands';
import { registerCustomCommands, type CustomCommandExecDeps } from '../../src/commands/custom-exec';
import type { MafwBuiltinDeps } from '../../src/commands/builtin-handlers';

function makeBuiltinDeps(): MafwBuiltinDeps {
  return {
    ensureManagerSession: async () => 'mgr-1',
    createSession: async () => null,
    promptAsync: async () => {},
    listMessages: async () => [],
    btwAsk: async () => '',
    rotateManagerSession: async () => ({ sessionId: 'x' }),
    mergeMemory: async () => ({}),
    readStatus: () => '',
    llmAvailable: () => true,
  };
}

function makeExecDeps(overrides: Partial<CustomCommandExecDeps> = {}): CustomCommandExecDeps {
  return {
    promptAsync: async () => {},
    ensureManagerSession: async () => 'mgr-1',
    llmAvailable: () => true,
    exec: async () => '',
    readFile: async () => '',
    ...overrides,
  };
}

describe('custom command execution via registry', () => {
  test('template rendered and prompted into given session', async () => {
    const registry = buildMafwCommandRegistry(makeBuiltinDeps());
    const sent: Array<{ sid: string; text: string }> = [];
    registerCustomCommands(registry, [
      { name: 'review', description: '评审', argumentHint: '<文件>', template: '评审 $1，diff：!`git diff --stat`', sourceFile: '/f/review.md' },
    ], makeExecDeps({
      promptAsync: async (sid, text) => { sent.push({ sid, text }); },
      exec: async (cmd) => `OUT(${cmd})`,
      readFile: async () => { throw new Error('ENOENT'); },
    }));
    const r = await handleMafwCommandRun({ registry, resolveProjectDir: () => '/p' },
      { command: 'review', args: 'a.ts', sessionID: 'sess-9' });
    expect(r.status).toBe(200);
    expect(sent).toEqual([{ sid: 'sess-9', text: '评审 a.ts，diff：OUT(git diff --stat)' }]);
  });

  test('no sessionID → manager session fallback; no llm → ok:false', async () => {
    const registry = buildMafwCommandRegistry(makeBuiltinDeps());
    const sent: string[] = [];
    registerCustomCommands(registry, [
      { name: 't', description: 'd', template: 'hello', sourceFile: '/f/t.md' },
    ], makeExecDeps({ promptAsync: async (sid) => { sent.push(sid); } }));
    await handleMafwCommandRun({ registry, resolveProjectDir: () => '/p' }, { command: 't' });
    expect(sent).toEqual(['mgr-1']);
    const reg2 = buildMafwCommandRegistry(makeBuiltinDeps());
    registerCustomCommands(reg2, [{ name: 't', description: 'd', template: 'x', sourceFile: '/f' }], makeExecDeps({
      ensureManagerSession: async () => '',
      llmAvailable: () => false,
    }));
    const r = await handleMafwCommandRun({ registry: reg2, resolveProjectDir: () => '/p' }, { command: 't' });
    expect(r.status).toBe(400);
  });

  test('custom command appears in list with kind=custom and source', async () => {
    const registry = buildMafwCommandRegistry(makeBuiltinDeps());
    registerCustomCommands(registry, [
      { name: 'deploy', description: '部署', template: 'x', sourceFile: '/home/u/.mafw/commands/deploy.md' },
    ], makeExecDeps());
    const list = handleMafwCommandList({ registry, resolveProjectDir: () => '/p' }).body.commands;
    const d = list.find((c: any) => c.name === 'deploy');
    expect(d).toMatchObject({ kind: 'custom', category: 'custom', source: '/home/u/.mafw/commands/deploy.md' });
    expect(list.filter((c: any) => c.kind === 'builtin')).toHaveLength(6);
  });

  test('re-register replaces old custom commands (hot reload semantics)', async () => {
    const registry = buildMafwCommandRegistry(makeBuiltinDeps());
    registerCustomCommands(registry, [
      { name: 'old', description: '旧', template: 'a', sourceFile: '/f/old.md' },
      { name: 'keep', description: '留', template: 'b', sourceFile: '/f/keep.md' },
    ], makeExecDeps());
    registerCustomCommands(registry, [
      { name: 'keep', description: '留v2', template: 'b2', sourceFile: '/f/keep.md' },
    ], makeExecDeps());
    const names = handleMafwCommandList({ registry, resolveProjectDir: () => '/p' }).body.commands
      .filter((c: any) => c.kind === 'custom').map((c: any) => c.name).sort();
    expect(names).toEqual(['keep']);
    expect(handleMafwCommandList({ registry, resolveProjectDir: () => '/p' }).body.commands
      .find((c: any) => c.name === 'keep').description).toBe('留v2');
  });
});
