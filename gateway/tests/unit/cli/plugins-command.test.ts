import { runPluginsCommand } from '../../../src/cli/plugins-command';

function makeDeps(response: any = { status: 200, body: {} }, humanToken: string | null = null) {
  const calls: any[] = [];
  const out: string[] = [];
  return {
    calls,
    out,
    deps: {
      request: async (path: string, method: string, body?: unknown, token?: string) => {
        calls.push({ path, method, body, token });
        return response;
      },
      readHumanToken: () => humanToken,
      print: (text: string) => out.push(text),
    },
  };
}

describe('mafw plugins CLI', () => {
  it('prints a JSON list', async () => {
    const { deps, out } = makeDeps({ status: 200, body: { packages: [{ name: 'acme' }] } });
    const code = await runPluginsCommand(['list', '--json'], deps);
    expect(code).toBe(0);
    expect(JSON.parse(out.join('\n')).packages[0].name).toBe('acme');
  });

  it('resume fails without a human token', async () => {
    const { deps, out } = makeDeps();
    const code = await runPluginsCommand(['resume'], deps);
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('human token');
  });

  it('sends the human token for resume', async () => {
    const { deps, calls } = makeDeps({ status: 200, body: { safeMode: false } }, 'human-secret');
    const code = await runPluginsCommand(['resume'], deps);
    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({ path: '/api/plugins/resume', method: 'POST', token: 'human-secret' });
  });

  it('doctor --json prints the report array', async () => {
    const { deps, out } = makeDeps({ status: 200, body: [{ name: 'acme', ok: true }] });
    await runPluginsCommand(['doctor', '--json'], deps);
    expect(JSON.parse(out.join('\n'))[0]).toMatchObject({ name: 'acme', ok: true });
  });

  it('install sends the v2 consent and requires a human token', async () => {
    const { deps, calls } = makeDeps({ status: 200, body: { name: 'acme' } }, 'human-secret');
    const code = await runPluginsCommand([
      'install', 'C:/tmp/acme', '--trust', 'trusted', '--permission', 'actions', '--permission', 'events',
    ], deps);
    expect(code).toBe(0);
    expect(calls[0].body).toEqual({
      path: 'C:/tmp/acme', overwrite: false,
      accept: { trust: 'trusted', permissions: ['actions', 'events'] },
    });
    expect(calls[0].token).toBe('human-secret');
  });

  it('kill and quarantine do not require a human token', async () => {
    const { deps, calls } = makeDeps({ status: 200, body: { ok: true } });
    expect(await runPluginsCommand(['kill'], deps)).toBe(0);
    expect(await runPluginsCommand(['quarantine', 'acme', '--reason', 'integrity'], deps)).toBe(0);
    expect(calls.map((call) => call.path)).toEqual([
      '/api/plugins/kill',
      '/api/plugins/acme/quarantine',
    ]);
  });

  it('prints API errors and returns 1', async () => {
    const { deps, out } = makeDeps({ status: 400, body: { error: 'bad', code: 'permission_consent_required' } });
    const code = await runPluginsCommand(['list'], deps);
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('permission_consent_required');
  });
});
