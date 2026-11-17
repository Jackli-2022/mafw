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

  // ── output safety: nothing package-derived is pasted or printed raw ──────

  it('never prints a paste-ready line when a permission token is unsafe', async () => {
    const out: string[] = [];
    const injected = 'net.fetch:x; Write-Host INJECTED';
    const code = await runPluginStandardCommand(['check', '/abs/p'], {
      check: async () => ({
        ok: true,
        kind: 'trusted',
        permissions: [injected],
        declared: { actions: ['ping'] },
        registered: { actions: ['ping'], http: 0 },
      }),
      print: (t) => out.push(t),
    });
    const text = out.join('\n');
    expect(code).toBe(0);                      // the package itself is still valid
    expect(text).not.toContain('install: mafw');
    expect(text).toContain('install: (omitted');
    expect(text).toContain(injected);          // named for review, never executed
    const warning = out.find((line) => line.startsWith('warning:'));
    expect(warning).toContain(injected);
  });

  it('flattens a newline in a token so it cannot forge a second install line', async () => {
    const out: string[] = [];
    await runPluginStandardCommand(['check', '/abs/p'], {
      check: async () => ({
        ok: true,
        kind: 'trusted',
        permissions: ['actions\ninstall: mafw plugins install "/evil" --trust trusted'],
      }),
      print: (t) => out.push(t),
    });
    const lines = out.join('\n').split('\n');
    const installLines = lines.filter((line) => line.startsWith('install:'));
    expect(installLines).toHaveLength(1);
    expect(installLines[0]).toContain('(omitted');
    // The newline survives as a visible marker instead of a line break.
    expect(installLines.some((line) => line.includes('/evil"'))).toBe(false);
    expect(out.join('\n')).toContain('␤');
  });

  it('prints each permission token exactly once in the install command', async () => {
    const out: string[] = [];
    await runPluginStandardCommand(['check', '/abs/p'], {
      check: async () => ({ ok: true, kind: 'trusted', permissions: ['actions', 'actions', 'events'] }),
      print: (t) => out.push(t),
    });
    const install = out.find((line) => line.startsWith('install:'));
    expect(install).toBeDefined();
    expect((install as string).match(/--permission actions/g)).toHaveLength(1);
    expect(install).toContain('--permission events');
  });

  it('normalizes Windows separators instead of omitting the command', async () => {
    const out: string[] = [];
    await runPluginStandardCommand(['check', 'C:\\work\\pkg'], {
      check: async () => ({ ok: true, kind: 'trusted', permissions: ['actions'] }),
      print: (t) => out.push(t),
    });
    const install = out.find((line) => line.startsWith('install:'));
    expect(install).toBe('install: mafw plugins install "C:/work/pkg" --trust trusted --permission actions');
  });

  // ── machine channel agrees with the exit code ────────────────────────────

  it('--json --strict reports the command verdict, not the raw check result', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['check', '/abs/p', '--json', '--strict'], {
      check: async () => ({ ok: true, warnings: ['legacy-contributes: bad'] }),
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    const lines = out.join('\n').trim().split('\n');
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]);
    expect(payload.ok).toBe(false);
    expect(payload.verdict).toBe('fail');
    expect(payload.strictFailed).toBe(true);
    expect(payload.warnings).toEqual(['legacy-contributes: bad']);
  });

  it('--json emits one JSON line on early errors too', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['check', './p', '--json'], {
      check: async () => { throw new Error('should not be called'); },
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    const lines = out.join('\n').trim().split('\n');
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]);
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain('absolute');
  });

  // ── verdict readability / explicit-empty planes ──────────────────────────

  it('renders an explicit empty plane as [] and never as unbounded', async () => {
    const out: string[] = [];
    await runPluginStandardCommand(['check', '/abs/p'], {
      check: async () => ({
        ok: false,
        error: 'invalid contributions: action "ping" is not declared in plugin.json contributes.gateway.actions',
        declared: { actions: [], events: [], tools: [], observers: [], http: false },
        registered: { actions: ['ping'], http: 0 },
      }),
      print: (t) => out.push(t),
    });
    const declaredLine = out.find((line) => line.startsWith('declared:'));
    expect(declaredLine).toBeDefined();
    expect(declaredLine).toContain('actions []');
    expect(declaredLine).not.toContain('unbounded');
  });

  it('keeps one terminal --strict verdict and puts next steps after it', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['check', '/abs/p', '--strict'], {
      check: async () => ({ ok: true, warnings: ['legacy-permissions'] }),
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    const lines = out.join('\n').split('\n');
    expect(lines[0].startsWith('ok ')).toBe(true);   // the check itself passed
    const verdict = lines.findIndex((line) => line.startsWith('not ok: --strict'));
    const next = lines.findIndex((line) => line.startsWith('next:'));
    expect(verdict).toBeGreaterThanOrEqual(0);
    expect(next).toBeGreaterThan(verdict);
    expect(lines.some((line) => line.startsWith('install:'))).toBe(false);
  });
});
