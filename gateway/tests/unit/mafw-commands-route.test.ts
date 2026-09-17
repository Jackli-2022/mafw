import { MafwCommandRegistry } from '../../src/commands/registry';
import { handleMafwCommandRun, handleMafwCommandList } from '../../src/routes/mafw-commands';

function makeRegistry(): MafwCommandRegistry {
  const r = new MafwCommandRegistry();
  r.register({ name: 'echo', description: 'd', category: 'custom', kind: 'custom' },
    async (ctx) => ({ ok: true, text: `echo:${ctx.args}@${ctx.projectDir}` }));
  r.register({ name: 'fail', description: 'd', category: 'custom', kind: 'custom' },
    async () => ({ ok: false, error: 'bad args' }));
  r.register({ name: 'boom', description: 'd', category: 'custom', kind: 'custom' },
    async () => { throw new Error('kaboom'); });
  return r;
}

describe('mafw-commands route', () => {
  test('run dispatches by name with args and projectDir', async () => {
    const r = await handleMafwCommandRun({ registry: makeRegistry(), resolveProjectDir: () => '/proj' },
      { command: 'echo', args: 'hi' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, text: 'echo:hi@/proj' });
  });

  test('ok:false result maps to 400', async () => {
    const r = await handleMafwCommandRun({ registry: makeRegistry(), resolveProjectDir: () => '/p' },
      { command: 'fail' });
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
  });

  test('unknown command → 400 Unknown command', async () => {
    const r = await handleMafwCommandRun({ registry: makeRegistry(), resolveProjectDir: () => '/p' },
      { command: 'nope' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Unknown command: nope/);
  });

  test('handler throw → 500 with message', async () => {
    const r = await handleMafwCommandRun({ registry: makeRegistry(), resolveProjectDir: () => '/p' },
      { command: 'boom' });
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('kaboom');
  });

  test('list returns metadata (no handler leak)', () => {
    const r = handleMafwCommandList({ registry: makeRegistry(), resolveProjectDir: () => '/p' });
    expect(r.status).toBe(200);
    expect(r.body.commands.map((c: any) => c.name).sort()).toEqual(['boom', 'echo', 'fail']);
    expect(r.body.commands[0].handler).toBeUndefined();
  });
});
