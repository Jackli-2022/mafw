/**
 * `mafw plugin check` — pure command surface with injected deps, so the human
 * report, the `--json` single line, `--strict` and the paste-ready install
 * command are all testable without a gateway or a real package.
 *
 * `mafw plugin init` writes real files: the scaffold tests only ever touch a
 * fresh `mkdtemp` directory, and the last group pins the generated manifest and
 * sources to what `checkPackage` will later judge (`package-check-inventory`).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runPluginStandardCommand } from '../../../src/cli/plugin-standard-command';
import { isValidPackageName, pluginTemplates } from '../../../src/cli/plugin-templates';
import { createLocalCheck } from '../../../src/cli/plugin-check-local';
import { parsePackageManifest } from '../../../src/plugins/package-manifest';
import type { PluginCheckResult } from '../../../src/plugins/package-host';

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
    expect(text).toContain('package declares tokens');   // package side is named
    expect(text).toContain(injected);          // named for review, never executed
    const warning = out.find((line) => line.startsWith('warning:'));
    expect(warning).toContain(injected);
  });

  it('keeps a quoted path containing a space in the install command', async () => {
    const out: string[] = [];
    const target = '/Program Files/mafw/hello-plugin';
    const code = await runPluginStandardCommand(['check', target], {
      check: async () => ({ ok: true, kind: 'trusted', permissions: ['actions'] }),
      print: (t) => out.push(t),
    });
    expect(code).toBe(0);
    const install = out.find((line) => line.startsWith('install:'));
    // The path is inert inside the quotes, so it must not suppress the line.
    expect(install).toBe(
      `install: mafw plugins install "${target}" --trust trusted --permission actions`,
    );
  });

  it('keeps a non-ASCII path in the install command', async () => {
    const out: string[] = [];
    const target = '/Users/开发者/插件/hello-plugin';
    const code = await runPluginStandardCommand(['check', target], {
      check: async () => ({ ok: true, kind: 'trusted', permissions: ['actions'] }),
      print: (t) => out.push(t),
    });
    expect(code).toBe(0);
    const install = out.find((line) => line.startsWith('install:'));
    expect(install).toContain(`"${target}"`);
    expect(install).not.toContain('omitted');
  });

  it('omits the line and blames the path when the path cannot be quoted', async () => {
    const out: string[] = [];
    const target = '/tmp/a"b/hello-plugin';
    const code = await runPluginStandardCommand(['check', target], {
      check: async () => ({ ok: true, kind: 'trusted', permissions: ['actions'] }),
      print: (t) => out.push(t),
    });
    expect(code).toBe(0);                      // the check itself is unaffected
    const text = out.join('\n');
    expect(text).not.toContain('install: mafw');
    expect(text).toContain('install: (omitted');
    expect(text).toContain('package path');    // path side is named, not the package
    expect(text).not.toContain('package declares tokens');
    const warning = out.find((line) => line.startsWith('warning:'));
    expect(warning).toContain('package path');
  });

  it('omits the line when the path would be expanded by a shell', async () => {
    // `$`, backtick and `!` all expand *inside* POSIX double quotes, so a
    // directory named `$(calc)` would execute when the line is pasted.
    const targets = [
      '/tmp/$(calc)/hello-plugin',
      '/home/$HOME/hello-plugin',
      '/tmp/`id`/hello-plugin',
      '/tmp/a!b/hello-plugin',
    ];
    for (const target of targets) {
      const out: string[] = [];
      const code = await runPluginStandardCommand(['check', target], {
        check: async () => ({ ok: true, kind: 'trusted', permissions: ['actions'] }),
        print: (t) => out.push(t),
      });
      expect(code).toBe(0);                    // the check itself is unaffected
      const text = out.join('\n');
      expect(text).not.toContain('install: mafw');
      expect(text).toContain('install: (omitted');
      expect(text).toContain('package path');  // path side is named, not the package
      expect(text).not.toContain('package declares tokens');
      const warning = out.find((line) => line.startsWith('warning:'));
      expect(warning).toContain('package path');
      expect(warning).toContain(target);
    }
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

// ── acceptance regressions: the report survives a failing package ──────────

describe('mafw plugin check — acceptance regressions', () => {
  const failed = (error: string) => async () => ({ ok: false, error }) as const;

  it('echoes --strict in the re-run hint instead of downgrading the gate', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['check', '/abs/p', '--strict'], {
      check: failed('version must be a non-empty string'),
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    const recheck = out.find((line) => line.startsWith('next:') && line.includes('mafw plugin check'));
    expect(recheck).toBeDefined();
    expect(recheck).toContain('mafw plugin check "/abs/p" --strict');
  });

  it('does not invent flags the author did not pass', async () => {
    const out: string[] = [];
    await runPluginStandardCommand(['check', '/abs/p'], {
      check: failed('version must be a non-empty string'),
      print: (t) => out.push(t),
    });
    const recheck = out.find((line) => line.startsWith('next:') && line.includes('mafw plugin check'));
    expect(recheck).toBe('next: fix the error above, then re-run: mafw plugin check "/abs/p"');
  });

  it('uses one http vocabulary on both inventory lines', async () => {
    async function inventory(declaredHttp: boolean | undefined, registeredHttp: number) {
      const out: string[] = [];
      await runPluginStandardCommand(['check', '/abs/p'], {
        check: async () => ({
          ok: true,
          declared: {
            actions: ['ping'],
            ...(declaredHttp === undefined ? {} : { http: declaredHttp }),
          },
          registered: {
            actions: ['ping'], events: [], tools: [], observers: [], http: registeredHttp,
          },
        }),
        print: (t) => out.push(t),
      });
      return {
        declared: out.find((line) => line.startsWith('declared:')) ?? '',
        registered: out.find((line) => line.startsWith('registered:')) ?? '',
      };
    }

    const optedOut = await inventory(false, 0);
    expect(optedOut.declared).toContain('http false');
    expect(optedOut.registered).toContain('http 0 route(s)');
    expect(optedOut.declared).not.toContain('opted out');

    const declared = await inventory(true, 3);
    expect(declared.declared).toContain('http true');
    expect(declared.registered).toContain('http 3 route(s)');

    const unbounded = await inventory(undefined, 1);
    expect(unbounded.declared).toContain('http (unbounded)');
    expect(unbounded.registered).toContain('http 1 route(s)');
    expect(unbounded.registered).not.toContain('unbounded');
  });

  it('prints the identity block the result carries on failure', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['check', '/abs/p'], {
      check: async () => ({
        ok: false,
        name: 'broken',
        apiVersion: 2,
        kind: 'trusted',
        permissions: ['actions'],
        contributions: ['actions'],
        error: 'invalid contributions: action "pong" is not declared in plugin.json contributes.gateway.actions',
      }),
      print: (t) => out.push(t),
    });
    const text = out.join('\n');
    expect(code).toBe(1);
    expect(out[0].startsWith('not ok broken ')).toBe(true);
    expect(text).toContain('apiVersion 2, kind trusted');
    expect(text).toContain('permissions: actions');
    expect(text).toContain('contributions: actions');
    expect(text).not.toContain('install:');
  });

  it('reads apiVersion/kind/permissions from the manifest when the check failed early', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
      name: 'broken',
      version: '1.0.0',
      apiVersion: 2,
      kind: 'trusted',
      permissions: ['actions'],
      contributes: { gateway: { actions: ['ping'] } },
    }));
    const out: string[] = [];
    const code = await runPluginStandardCommand(['check', dir], {
      check: async () => ({
        ok: false,
        name: 'broken',
        error: 'version must be a non-empty string',
        registered: { actions: [], events: [], tools: [], observers: [], http: 0 },
      }),
      print: (t) => out.push(t),
    });
    const text = out.join('\n');
    expect(code).toBe(1);
    expect(out[0].startsWith('not ok broken ')).toBe(true);
    expect(text).toContain('apiVersion 2, kind trusted');
    expect(text).toContain('permissions: actions');
    expect(text).not.toContain('install:');
  });

  it('says activate() already ran on every run', async () => {
    for (const result of [
      { ok: true },
      { ok: false, error: 'boom' },
    ]) {
      const out: string[] = [];
      await runPluginStandardCommand(['check', '/abs/p'], {
        check: async () => result,
        print: (t) => out.push(t),
      });
      const note = out.find((line) => line.startsWith('note:') && line.includes('sandbox'));
      expect(note).toBeDefined();
      expect(note).toContain('activate()');
      expect(note).toContain('already happened');
    }
  });
});

// ── deltas + failure code: the two lines must answer "what is wrong here?" ──

describe('mafw plugin check — declared-vs-registered deltas and the failure code', () => {
  /** Runs one check and returns the rendered lines plus the exit code. */
  async function render(result: PluginCheckResult, args: string[] = []) {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['check', '/abs/p', ...args], {
      check: async () => result,
      print: (line) => out.push(line),
    });
    const line = (prefix: string): string => out.find((entry) => entry.startsWith(prefix)) ?? '';
    return { out, code, text: out.join('\n'), line };
  }

  it('marks a registered-but-undeclared name and prints the failure code', async () => {
    const { code, line, text } = await render({
      ok: false,
      code: 'contribution_bound',
      evaluated: true,
      error: 'invalid contributions: action "pong" is not declared in plugin.json contributes.gateway.actions',
      declared: { actions: ['ping'] },
      registered: { actions: ['ping', 'pong'], http: 0 },
    });
    expect(code).toBe(1);
    // A real bound violation: the extra name is the violation, so it is marked.
    expect(line('registered:')).toContain('actions [ping +pong]');
    expect(line('declared:')).toContain('actions [ping]');
    expect(text).toContain('error[contribution_bound]: invalid contributions:');
  });

  it('marks a declared-but-unregistered name as legal and keeps exit 0', async () => {
    const { code, line, text } = await render({
      ok: true,
      declared: { actions: ['ping', 'ghost'] },
      registered: { actions: ['ping'], http: 0 },
    });
    expect(code).toBe(0);
    expect(line('declared:')).toContain('actions [ping -ghost]');
    expect(line('registered:')).toContain('actions [ping]');
    // The informational note is unchanged: a delta is never a verdict here.
    expect(text).toContain('note: declared but not registered: action "ghost"');
  });

  it('never marks a plane the manifest leaves undeclared', async () => {
    const { code, line } = await render({
      ok: true,
      declared: { actions: ['ping'] },
      registered: { actions: ['ping'], events: ['plugin:p:tick'], http: 0 },
    });
    expect(code).toBe(0);
    // Undeclared = no upper bound, so a registered event is not a delta and the
    // declared view keeps the unbounded marker instead of an empty bound.
    expect(line('declared:')).toContain('events (unbounded)');
    expect(line('declared:')).not.toMatch(/[+-][A-Za-z]/);
    expect(line('registered:')).toContain('events [plugin:p:tick]');
    expect(line('registered:')).not.toMatch(/[+-][A-Za-z]/);
  });

  it('marks a zero-bound plane, where every registration is an extra', async () => {
    const { line, text } = await render({
      ok: false,
      code: 'contribution_bound',
      error: 'invalid contributions: action "ping" is not declared in plugin.json contributes.gateway.actions',
      declared: { actions: [] },
      registered: { actions: ['ping'], http: 0 },
    });
    expect(line('declared:')).toContain('actions []');
    expect(line('registered:')).toContain('actions [+ping]');
    expect(text).toContain('error[contribution_bound]:');
  });

  it('orders a declared plane by its declaration, then extras by registration', async () => {
    const { line } = await render({
      ok: false,
      code: 'contribution_bound',
      error: 'invalid contributions',
      declared: { actions: ['beta', 'alpha'] },
      registered: { actions: ['alpha', 'beta', 'gamma', 'delta'], http: 0 },
    });
    // Declared order wins over activation order, so the two lines line up.
    expect(line('declared:')).toContain('actions [beta alpha]');
    expect(line('registered:')).toContain('actions [beta alpha +gamma +delta]');
  });

  it('keeps the bare error line when the result carries no code', async () => {
    const { text } = await render({ ok: false, error: 'boom' });
    expect(text).toContain('error: boom');
    expect(text).not.toContain('error[');
  });

  it('--json passes code and evaluated through untouched', async () => {
    const { code, out } = await render({
      ok: false,
      code: 'activation_failed',
      evaluated: false,
      error: 'boom',
    }, ['--json']);
    expect(code).toBe(1);
    const lines = out.join('\n').trim().split('\n');
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]);
    expect(payload.ok).toBe(false);          // the command verdict, unchanged
    expect(payload.code).toBe('activation_failed');
    expect(payload.evaluated).toBe(false);
    expect(payload.error).toBe('boom');
  });

  it('flattens a control character in a marked name', async () => {
    const { line } = await render({
      ok: false,
      code: 'contribution_bound',
      error: 'invalid contributions',
      declared: { actions: ['ping'] },
      registered: { actions: ['ping', 'pong\nnext: mafw plugins install "/evil"'], http: 0 },
    });
    // The marker must not become a way to smuggle a second line into the report.
    expect(line('registered:')).toContain('+pong␤next: mafw plugins install "/evil"');
    expect(line('registered:')).not.toContain('\n');
  });
});

// ── schema: the machine-readable contract, printed as-is ────────────────────

const noCheck = async (): Promise<never> => {
  throw new Error('this command must never run the check host');
};

async function captureSchema(args: string[]): Promise<string[]> {
  const out: string[] = [];
  const code = await runPluginStandardCommand(['schema', ...args], {
    check: noCheck,
    print: (t) => out.push(t),
  });
  expect(code).toBe(0);
  return out;
}

describe('mafw plugin schema', () => {
  it('prints the manifest schema itself, with no envelope', async () => {
    const out = await captureSchema([]);
    expect(out).toHaveLength(1);
    expect(out[0].split('\n')[0]).toBe('{');
    const schema = JSON.parse(out[0]);
    expect(schema.required).toEqual(['name']);
    expect(schema.properties.standardVersion).toMatchObject({ type: 'integer', minimum: 1 });
    // Unknown top-level keys are legal for the parser, so the object stays open;
    // `contributes` is where the standard is strict.
    expect(schema.additionalProperties).toBeUndefined();
    expect(schema.$defs.contributes.additionalProperties).toBe(false);
  });

  it('prints the same document for --json, because the schema is already JSON', async () => {
    expect(await captureSchema(['--json'])).toEqual(await captureSchema([]));
  });

  it('rejects an unknown flag with the usage', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['schema', '--wat'], {
      check: noCheck,
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('unknown flag: --wat');
    expect(out.join('\n')).toContain('mafw plugin schema');
  });
});

// ── init: the scaffold must be checkable the moment it is written ──────────

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-init-'));
}

/** `next:` line as pasted: Windows separators are normalized on Windows only. */
function commandTarget(target: string): string {
  return path.sep === '\\' ? target.replace(/\\/g, '/') : target;
}

describe('mafw plugin init', () => {
  it('scaffolds a package into .mafw/plugin-drafts by default', async () => {
    const cwd = tempDir();
    const out: string[] = [];
    const code = await runPluginStandardCommand(['init', 'demo'], {
      check: noCheck,
      print: (t) => out.push(t),
      cwd,
    });
    expect(code).toBe(0);
    const root = path.join(cwd, '.mafw', 'plugin-drafts', 'demo');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).name).toBe('demo');
    expect(fs.existsSync(path.join(root, 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'README.md'))).toBe(true);
    const text = out.join('\n');
    expect(text).toContain(`created ${root}`);
    expect(text).toContain('mafw plugin check');
    // Exactly one next step, and it names the absolute path just created.
    const next = out.filter((line) => line.startsWith('next:'));
    expect(next).toHaveLength(1);
    expect(next[0]).toContain(commandTarget(root));
  });

  it('refuses to overwrite without --force', async () => {
    const cwd = tempDir();
    const deps = { check: noCheck, print: () => {}, cwd };
    expect(await runPluginStandardCommand(['init', 'demo'], deps)).toBe(0);
    const out: string[] = [];
    const code = await runPluginStandardCommand(['init', 'demo'], { ...deps, print: (t) => out.push(t) });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('--force');
  });

  it('--force rewrites the template files over an existing draft', async () => {
    const cwd = tempDir();
    const deps = { check: noCheck, print: () => {}, cwd };
    expect(await runPluginStandardCommand(['init', 'demo'], deps)).toBe(0);
    const root = path.join(cwd, '.mafw', 'plugin-drafts', 'demo');
    fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = {};\n');
    expect(await runPluginStandardCommand(['init', 'demo', '--force'], deps)).toBe(0);
    expect(fs.readFileSync(path.join(root, 'index.js'), 'utf8')).toContain('async activate');
  });

  it('--dir overrides the parent directory', async () => {
    const parent = tempDir();
    const code = await runPluginStandardCommand(['init', 'demo', '--dir', parent], {
      check: noCheck,
      print: () => {},
    });
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(parent, 'demo', 'plugin.json'))).toBe(true);
  });

  it('rejects an invalid package name', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['init', 'bad name'], {
      check: noCheck,
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('name');
  });

  // The rule is not invented here: `init` must accept what
  // `parsePackageManifest` accepts, or the scaffold is dead on arrival. (The
  // only delta is the 100-char cap below, which is strictly narrower.)
  it('accepts exactly the names the manifest parser accepts', async () => {
    const names = [
      'demo', 'a', 'A1', 'my-plugin', 'my.plugin', 'my_plugin', '0x', 'a.b-c_d9',
      'bad name', '.hidden', '-demo', 'demo.', 'demo ', 'a/b', 'a\\b', 'a:b', 'ä', '',
    ];
    const parent = tempDir();
    for (const name of names) {
      const manifestOk = parsePackageManifest({ name }).ok;
      expect(isValidPackageName(name)).toBe(manifestOk);
      const code = await runPluginStandardCommand(['init', name, '--dir', parent], {
        check: noCheck,
        print: () => {},
      });
      expect(code).toBe(manifestOk ? 0 : 1);
    }
  });

  it('rejects a trailing "." or " ", which the manifest parser rejects too', async () => {
    for (const name of ['demo.', 'demo ']) {
      const out: string[] = [];
      const code = await runPluginStandardCommand(['init', name], {
        check: noCheck,
        print: (t) => out.push(t),
      });
      expect(code).toBe(1);
      expect(out.join('\n')).toContain('invalid package name');
    }
  });

  // The one deliberate delta from the manifest rule: the scaffold's own event
  // type is `plugin:<name>:ping`, so `init` refuses a name longer than 100
  // characters to keep that type inside the 128-character identifier ceiling
  // with room to spare. The *parser* keeps accepting such a name (a
  // hand-written package is not the scaffold's problem), which is exactly why
  // this cap lives here and not in `parsePackageManifest`.
  it('caps the scaffold name at 100 characters without changing the parser', async () => {
    const hundred = 'a'.repeat(100);
    const tooLong = 'a'.repeat(101);
    expect(isValidPackageName(hundred)).toBe(true);
    expect(isValidPackageName(tooLong)).toBe(false);
    expect(parsePackageManifest({ name: hundred }).ok).toBe(true);
    expect(parsePackageManifest({ name: tooLong }).ok).toBe(true);

    const out: string[] = [];
    const code = await runPluginStandardCommand(['init', tooLong, '--dir', tempDir()], {
      check: noCheck,
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('package name must be at most 100 characters');
  });

  it('scaffolds a 100-character name that already passes `check --strict`', async () => {
    const name = 'a'.repeat(100);
    const parent = tempDir();
    expect(await runPluginStandardCommand(['init', name, '--dir', parent], {
      check: noCheck,
      print: () => {},
    })).toBe(0);
    const out: string[] = [];
    const code = await runPluginStandardCommand(['check', path.join(parent, name), '--strict'], {
      check: createLocalCheck(),
      print: (t) => out.push(t),
    });
    expect(out.join('\n')).toContain('ok');
    expect(code).toBe(0);
  });

  it('declares exactly the planes the generated index.js registers', async () => {
    const cwd = tempDir();
    expect(await runPluginStandardCommand(['init', 'demo'], { check: noCheck, print: () => {}, cwd })).toBe(0);
    const root = path.join(cwd, '.mafw', 'plugin-drafts', 'demo');
    const parsed = parsePackageManifest(JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')));
    expect(parsed.errors).toEqual([]);
    const manifest = parsed.manifest;
    if (!manifest) throw new Error('the generated manifest must parse');
    expect(manifest.apiVersion).toBe(2);
    expect(manifest.kind).toBe('trusted');
    expect(manifest.permissions).toEqual(['actions', 'events']);
    expect(manifest.contributes?.gateway).toMatchObject({
      actions: ['ping'],
      events: ['plugin:demo:ping'],
      // Explicit zero bounds: the scaffold teaches that a plane is declared
      // *empty* until the author opts in, not silently unbounded.
      tools: [],
      observers: [],
      http: false,
    });

    const mod = require(path.join(root, 'index.js')) as { name?: string; activate?: unknown };
    expect(mod.name).toBe('demo');
    expect(typeof mod.activate).toBe('function');
    // A scaffold that starts a timer would need ctx.effect() to be safe; the
    // default must be quiet until the author decides otherwise.
    const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    expect(source).not.toContain('setInterval');
    expect(source).not.toContain('setTimeout');
  });

  it('writes a README naming the check and the human-only install command', async () => {
    const cwd = tempDir();
    expect(await runPluginStandardCommand(['init', 'demo'], { check: noCheck, print: () => {}, cwd })).toBe(0);
    const readme = fs.readFileSync(path.join(cwd, '.mafw', 'plugin-drafts', 'demo', 'README.md'), 'utf8');
    expect(readme).toContain('mafw plugin check');
    expect(readme).toContain('--trust trusted');
    expect(readme).toContain('--permission actions');
    expect(readme).toContain('--permission events');
    expect(readme.toLowerCase()).toContain('human');
    // The zero bounds are part of the lesson, not an accident of the template.
    expect(readme).toContain('tools: []');
    expect(readme).toContain('observers: []');
  });

  it('flattens a newline in a rejected name so it cannot forge a next line', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(
      ['init', 'bad\nnext: mafw plugins install "/evil" --trust trusted'],
      { check: noCheck, print: (t) => out.push(t) },
    );
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('␤');
    expect(out.filter((line) => line.startsWith('next: mafw'))).toHaveLength(0);
    expect(out[0].startsWith('invalid package name:')).toBe(true);
  });

  it('rejects an unknown init flag with the usage', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['init', 'demo', '--wat'], {
      check: noCheck,
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('unknown flag: --wat');
    expect(out.join('\n')).toContain('usage: mafw plugin init');
  });

  it('prints the usage when the name is missing', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['init'], { check: noCheck, print: (t) => out.push(t) });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('usage: mafw plugin init');
  });

  it('rejects --dir without a value', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['init', 'demo', '--dir'], {
      check: noCheck,
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('--dir');
  });

  it('rejects a second positional argument', async () => {
    const out: string[] = [];
    const code = await runPluginStandardCommand(['init', 'demo', 'other'], {
      check: noCheck,
      print: (t) => out.push(t),
    });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('unexpected argument');
  });

  it('--json prints one machine-readable line with the created path', async () => {
    const cwd = tempDir();
    const out: string[] = [];
    const code = await runPluginStandardCommand(['init', 'demo', '--json'], {
      check: noCheck,
      print: (t) => out.push(t),
      cwd,
    });
    expect(code).toBe(0);
    const lines = out.join('\n').trim().split('\n');
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]);
    expect(payload.ok).toBe(true);
    expect(path.isAbsolute(payload.path)).toBe(true);
    expect(fs.existsSync(path.join(payload.path, 'plugin.json'))).toBe(true);
  });

  it('does not print a paste-ready check line when the path cannot be quoted', async () => {
    const parent = path.join(tempDir(), '$HOME');
    fs.mkdirSync(parent, { recursive: true });
    const out: string[] = [];
    const code = await runPluginStandardCommand(['init', 'demo', '--dir', parent], {
      check: noCheck,
      print: (t) => out.push(t),
    });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('created');
    // `$` expands inside double quotes, so this path must not become a command.
    expect(out.some((line) => line.startsWith('next: mafw plugin check'))).toBe(false);
    expect(out.join('\n')).toContain('mafw plugin check');
  });
});

describe('plugin init templates', () => {
  it('refuses names it could not embed in generated sources', () => {
    expect(() => pluginTemplates('bad name')).toThrow(/invalid package name/);
    expect(() => pluginTemplates("x', evil: 'y")).toThrow();
  });

  it('keeps the name inside the manifest, the export and the event namespace', () => {
    const files = pluginTemplates('acme.tools');
    expect(Object.keys(files).sort()).toEqual(['README.md', 'index.js', 'plugin.json']);
    const manifest = JSON.parse(files['plugin.json']);
    expect(manifest.name).toBe('acme.tools');
    expect(manifest.contributes.gateway.events).toEqual(['plugin:acme.tools:ping']);
    expect(files['index.js']).toContain("name: 'acme.tools'");
    expect(files['README.md']).toContain('acme.tools');
  });
});
