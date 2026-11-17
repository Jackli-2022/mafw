/**
 * `mafw plugin check` — pure command surface with injected deps, so the human
 * report, the `--json` single line, `--strict` and the paste-ready install
 * command are all testable without a gateway or a real package.
 */
import { runPluginStandardCommand } from '../../../src/cli/plugin-standard-command';

describe('mafw plugin check', () => {
  it('prints ok, the inventory and a paste-ready install command', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['check', '/abs/hello-plugin'], {
      check: async () => ({
        ok: true,
        kind: 'trusted',
        permissions: ['actions', 'events'],
        declared: { actions: ['now'], events: ['plugin:hello:tick'], tools: [], observers: [] },
        registered: { actions: ['now'], events: ['plugin:hello:tick'], tools: [], observers: [], http: 0 },
      }),
      print: (t) => out.push(t),
    });
    const text = out.join('\n');
    expect(code).toBe(0);
    expect(text).toContain('ok');
    expect(text).toContain('declared:');
    expect(text).toContain('registered:');
    expect(text).toContain('--trust trusted');
    expect(text).toContain('--permission actions');
    expect(text).toContain('--permission events');
  });

  it('prints one parseable JSON line with --json', async () => {
    const out: string[] = [];
    await runPluginStandardCommand(['check', '/abs/p', '--json'], {
      check: async () => ({ ok: false, error: 'boom' }),
      print: (t) => out.push(t),
    });
    const lines = out.join('\n').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it('fails with next steps when the bound is violated', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['check', '/abs/p'], {
      check: async () => ({
        ok: false,
        error: 'action "pong" is not declared in plugin.json contributes.gateway.actions',
        declared: { actions: ['ping'] },
        registered: { actions: ['ping', 'pong'], http: 0 },
      }),
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('next:');
  });

  it('--strict fails on warnings alone', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['check', '/abs/p', '--strict'], {
      check: async () => ({ ok: true, warnings: ['legacy-contributes: bad'] }),
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('legacy-contributes');
  });

  it('--strict does not fail on a declared-but-unregistered plane', async () => {
    const code = await runPluginStandardCommand(['check', '/abs/p', '--strict'], {
      check: async () => ({
        ok: true,
        declared: { actions: ['ping'], observers: ['ghost'] },
        registered: { actions: ['ping'], http: 0 },
      }),
      print: () => {},
    });
    expect(code).toBe(0);
  });

  it('rejects a relative path before calling the host', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['check', './p'], {
      check: async () => { throw new Error('should not be called'); },
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('absolute');
  });
});
