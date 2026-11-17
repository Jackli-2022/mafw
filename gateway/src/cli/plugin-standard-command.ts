/**
 * `mafw plugin ...` — the in-process plugin standard surface.
 *
 * `check` runs the *same* judgement function as a real activation
 * (`PluginHost.checkPackage`, a dry-run activation) inside this CLI process:
 * no gateway, no human token, no network. It prints the declared-vs-registered
 * inventory and a paste-ready install command, so an agent can self-verify a
 * package before asking a human for consent.
 *
 * Everything here is a pure function over injected deps: the CLI entrypoint
 * (`bin/mafw.js`) owns process/fs wiring, tests own the assertions.
 */
import * as path from 'path';
import type { PluginCheckResult } from '../plugins/package-host';

export interface PluginStandardDeps {
  /** In-process check; the CLI passes `createLocalCheck()`. */
  check(path: string): Promise<PluginCheckResult>;
  print(text: string): void;
  /** Used only to suggest an absolute path when one is not given. */
  cwd?: string;
}

const USAGE = [
  'usage: mafw plugin check <absolute-path> [--json] [--strict]',
  '',
  '  check      Dry-run one package in this process (no gateway, no token, no network)',
  '  --json     Print the raw result as one JSON line',
  '  --strict   Treat manifest warnings as failures',
].join('\n');

const CHECK_FLAGS = new Set(['--json', '--strict']);

function isAbsolutePath(candidate: string): boolean {
  return path.isAbsolute(candidate);
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/** Planes as a renderer sees them: partial after a JSON round-trip. */
interface PlaneNames {
  actions?: string[];
  events?: string[];
  tools?: string[];
  observers?: string[];
}

type DeclaredView = PlaneNames & { http?: boolean };
type RegisteredView = PlaneNames & { http?: number };

/** `actions [a, b], events -, tools -, observers -, http true`. */
function formatDeclared(declared: DeclaredView | undefined): string {
  if (!declared) return '(no contributes.gateway block — no static upper bound)';
  const planes = [
    `actions ${formatNames(declared.actions)}`,
    `events ${formatNames(declared.events)}`,
    `tools ${formatNames(declared.tools)}`,
    `observers ${formatNames(declared.observers)}`,
    declared.http === undefined
      ? 'http -'
      : `http ${declared.http ? 'declared' : 'opted out'}`,
  ];
  // An empty plane is *undeclared*, not "nothing allowed": the validator only
  // checks the planes the manifest actually lists.
  return `${planes.join(', ')} (unlisted planes are unbounded)`;
}

/** `actions [a, b], events -, tools -, observers -, http 2`. */
function formatRegistered(registered: RegisteredView | undefined): string {
  if (!registered) return '(not reported)';
  return [
    `actions ${formatNames(registered.actions)}`,
    `events ${formatNames(registered.events)}`,
    `tools ${formatNames(registered.tools)}`,
    `observers ${formatNames(registered.observers)}`,
    `http ${registered.http ?? 0}`,
  ].join(', ');
}

function formatNames(names: string[] | undefined): string {
  return names && names.length > 0 ? `[${names.join(', ')}]` : '-';
}

/**
 * Paste-ready install command for the package that was just checked.
 *
 * v2 packages need explicit consent: `--trust <kind>` plus one `--permission`
 * per declared permission token (the manager compares the accepted set with the
 * manifest set). Legacy (v1) packages take neither flag.
 */
function installCommand(target: string, result: PluginCheckResult): string {
  const command = ['mafw', 'plugins', 'install', `"${target}"`];
  const v2 = result.apiVersion === 2 || result.kind !== undefined;
  if (v2) {
    command.push('--trust', result.kind ?? 'trusted');
    for (const permission of result.permissions ?? []) {
      command.push('--permission', permission);
    }
  }
  return command.join(' ');
}

/** Planes the manifest allows but `activate()` did not register (legal). */
function declaredOnly(result: PluginCheckResult): string[] {
  const declared: DeclaredView | undefined = result.declared;
  const registered: RegisteredView | undefined = result.registered;
  if (!declared || !registered) return [];
  const planes: Array<[string, string[] | undefined, string[] | undefined]> = [
    ['action', declared.actions, registered.actions],
    ['event', declared.events, registered.events],
    ['tool', declared.tools, registered.tools],
    ['observer', declared.observers, registered.observers],
  ];
  const out: string[] = [];
  for (const [label, all, used] of planes) {
    for (const name of all ?? []) {
      if (!(used ?? []).includes(name)) out.push(`${label} "${name}"`);
    }
  }
  return out;
}

function nextSteps(target: string, result: PluginCheckResult, strictFailure: boolean): string[] {
  const steps: string[] = [];
  if (strictFailure) {
    steps.push('next: fix the manifest warnings above (they come from plugin.json normalization) or drop --strict');
  }
  if (!result.ok) {
    const error = result.error ?? '(no reason reported)';
    if (error.includes('is not declared in plugin.json contributes.gateway.')) {
      steps.push('next: add the name to contributes.gateway in plugin.json, or stop registering it in activate()');
    } else if (error.includes('permission denied')) {
      steps.push('next: add the missing permission to plugin.json "permissions"');
    }
    steps.push(`next: fix the error above, then re-run: mafw plugin check "${target}"`);
  }
  return steps;
}

export async function runPluginStandardCommand(
  argv: string[],
  deps: PluginStandardDeps,
): Promise<number> {
  const args = [...argv];
  const command = args.shift();

  if (command !== 'check') {
    if (command !== undefined && command.length > 0) {
      deps.print(`unknown plugin command: ${command}`);
    }
    deps.print(USAGE);
    return 1;
  }

  const unknownFlag = args.find((arg) => arg.startsWith('--') && !CHECK_FLAGS.has(arg));
  if (unknownFlag) {
    deps.print(`unknown flag: ${unknownFlag}`);
    deps.print(USAGE);
    return 1;
  }
  const asJson = args.includes('--json');
  const strict = args.includes('--strict');
  const target = args.find((arg) => !arg.startsWith('--'));
  if (!target) {
    deps.print(USAGE);
    return 1;
  }

  // Rejected here, not by the host: `checkPackage` resolves silently and would
  // turn `./p` into a path relative to whatever directory the CLI happens to
  // run from.
  if (!isAbsolutePath(target)) {
    deps.print(`path must be absolute: ${target}`);
    const suggestion = deps.cwd ? path.resolve(deps.cwd, target) : null;
    deps.print(
      'next: pass the absolute path to the package directory'
      + (suggestion ? ` (e.g. ${suggestion})` : ''),
    );
    return 1;
  }

  let result: PluginCheckResult;
  try {
    result = await deps.check(target);
  } catch (err) {
    deps.print(`check failed: ${messageOf(err)}`);
    deps.print(`next: verify the path exists and is a package directory (plugin.json + index.js)`);
    return 1;
  }

  const warnings = result.warnings ?? [];
  const strictFailure = strict && warnings.length > 0;
  const ok = result.ok && !strictFailure;

  if (asJson) {
    deps.print(JSON.stringify(result));
    return ok ? 0 : 1;
  }

  deps.print(`${result.ok ? 'ok' : 'not ok'} ${result.name ?? target} (${target})`);
  if (result.version) deps.print(`  version: ${result.version}`);
  if (result.apiVersion !== undefined || result.kind !== undefined) {
    const api = result.apiVersion !== undefined ? `apiVersion ${result.apiVersion}` : null;
    const kind = result.kind !== undefined ? `kind ${result.kind}` : null;
    deps.print(`  ${[api, kind].filter(Boolean).join(', ')}`);
  }
  if (result.permissions && result.permissions.length > 0) {
    deps.print(`  permissions: ${result.permissions.join(', ')}`);
  }
  if (result.contributions && result.contributions.length > 0) {
    deps.print(`  contributions: ${result.contributions.join(', ')}`);
  }
  deps.print(`declared: ${formatDeclared(result.declared)}`);
  deps.print(`registered: ${formatRegistered(result.registered)}`);

  const unregistered = declaredOnly(result);
  if (unregistered.length > 0) {
    // Legal by design (packages register conditionally) — never a failure.
    deps.print(`note: declared but not registered: ${unregistered.join(', ')}`);
  }
  for (const warning of warnings) deps.print(`warning: ${warning}`);
  if (!result.ok) deps.print(`error: ${result.error ?? '(no reason reported)'}`);
  for (const step of nextSteps(target, result, strictFailure)) deps.print(step);

  if (ok) {
    deps.print(`install: ${installCommand(target, result)}`);
  } else if (strictFailure && result.ok) {
    deps.print('not ok: --strict turned the manifest warnings above into failures');
  }

  return ok ? 0 : 1;
}
