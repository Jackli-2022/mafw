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
 *
 * Output safety: every package-derived value (name, permissions, warning and
 * error text, plane names) is flattened before it reaches the terminal, and the
 * install line is only printed when *every* token in it matches
 * `SAFE_COMMAND_TOKEN`. `isKnownPermissionToken` only prefix-checks
 * `net.fetch:`, so a manifest can legally declare a token containing `;` or a
 * newline; pasting that line would execute whatever follows it.
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
  '  --json     Print one JSON line; its `ok` is the command verdict',
  '  --strict   Treat manifest warnings as failures',
].join('\n');

const CHECK_FLAGS = new Set(['--json', '--strict']);

/**
 * What may appear in a printed, paste-ready command for an **unquoted** token
 * (`--trust <kind>`, `--permission <token>`). Deliberately narrower than a
 * shell: package names and permission tokens (`net.fetch:host`) fit; quoting,
 * separators and newlines do not.
 *
 * Quoted tokens (the package path) use `isQuotablePath()` instead: a space or a
 * CJK character is inert inside double quotes and must not suppress the line.
 */
const SAFE_COMMAND_TOKEN = /^[A-Za-z0-9._:/@-]+$/;

/**
 * What can end a double-quoted token early: the quote itself, a control/newline
 * byte, or a trailing backslash (POSIX `sh` treats `\"` as an escaped quote, so
 * a path like `/tmp/a\` would swallow the closing one).
 */
const UNQUOTABLE = /["\u0000-\u001f\u007f-\u009f]/;

/** C0 + DEL + C1 — the characters that can forge a line or drive a terminal. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const CONTROL_MARKER = '␤';

/** Per-value render budget: package text must not swallow the report. */
const MAX_FIELD_CHARS = 200;

const INSTALL_OMITTED_TOKENS =
  'install: (omitted — package declares tokens that are unsafe to paste; install manually after review)';
const INSTALL_OMITTED_PATH =
  'install: (omitted — the package path cannot be printed in a shell command; install manually after review)';

/**
 * Flattens package-derived text: control characters become a visible marker
 * (so `\n` cannot start a second `install:` line) and over-long values are
 * capped per field.
 */
function text(value: unknown, max = MAX_FIELD_CHARS): string {
  const raw = typeof value === 'string' ? value : String(value);
  const flattened = raw.replace(CONTROL_CHARS, CONTROL_MARKER);
  const chars = [...flattened];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : flattened;
}

function isSafeCommandToken(value: string): boolean {
  return SAFE_COMMAND_TOKEN.test(value);
}

/**
 * The path is printed inside double quotes, so only quote-breaking characters
 * matter: spaces, CJK, `&`, `(` … are literal there. Accepting them keeps
 * `C:/Program Files/mafw/pkg` and non-ASCII home directories installable.
 */
function isQuotablePath(value: string): boolean {
  if (value.length === 0) return false;
  if (UNQUOTABLE.test(value)) return false;
  return !value.endsWith('\\');
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/**
 * JSON is a machine channel: `JSON.stringify` escapes control characters, so a
 * payload is one physical line by construction and never needs the terminal
 * sanitizer.
 */
function printJson(deps: PluginStandardDeps, payload: unknown): void {
  deps.print(JSON.stringify(payload));
}

/** One failure shape for both channels: JSON gets one line, humans get text. */
function fail(
  deps: PluginStandardDeps,
  asJson: boolean,
  message: string,
  humanLines: string[],
): number {
  if (asJson) printJson(deps, { ok: false, error: message });
  else for (const line of humanLines) deps.print(line);
  return 1;
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

/**
 * `[a, b]` / `[]` / the absent marker. Presence is per plane: `[]` is a zero
 * bound and must never be described as unbounded.
 */
function formatPlane(names: string[] | undefined, absent: string): string {
  if (!names) return absent;
  if (names.length === 0) return '[]';
  return `[${names.map((name) => text(name)).join(', ')}]`;
}

/** `actions [a, b], events [], tools (unbounded), observers (unbounded), http true`. */
function formatDeclared(declared: DeclaredView | undefined): string {
  if (!declared) return '(no contributes.gateway block — no static upper bound)';
  return [
    `actions ${formatPlane(declared.actions, '(unbounded)')}`,
    `events ${formatPlane(declared.events, '(unbounded)')}`,
    `tools ${formatPlane(declared.tools, '(unbounded)')}`,
    `observers ${formatPlane(declared.observers, '(unbounded)')}`,
    declared.http === undefined
      ? 'http (unbounded)'
      : `http ${declared.http ? 'declared' : 'opted out'}`,
  ].join(', ');
}

/** `actions [a, b], events -, tools -, observers -, http 2`. */
function formatRegistered(registered: RegisteredView | undefined): string {
  if (!registered) return '(not reported)';
  return [
    `actions ${formatPlane(registered.actions, '-')}`,
    `events ${formatPlane(registered.events, '-')}`,
    `tools ${formatPlane(registered.tools, '-')}`,
    `observers ${formatPlane(registered.observers, '-')}`,
    `http ${typeof registered.http === 'number' ? registered.http : 0}`,
  ].join(', ');
}

/** Why the install line could not be printed; the notice names the culprit. */
type InstallPlan =
  | { kind: 'ready'; command: string }
  | { kind: 'path-unsafe'; path: string }
  | { kind: 'tokens-unsafe'; tokens: string[] };

/**
 * Windows separators are normalized **only on Windows**: `path.sep` says which
 * separator this platform passes to argv, so a POSIX directory literally named
 * `a\b` keeps its name instead of pointing somewhere else.
 */
function commandPath(target: string): string {
  return path.sep === '\\' ? target.replace(/\\/g, '/') : target;
}

/**
 * Paste-ready install command for the checked package.
 *
 * v2 packages need explicit consent: `--trust <kind>` plus one `--permission`
 * per declared permission token (the manager compares the accepted set with the
 * manifest set). Legacy (v1) packages take neither flag.
 *
 * Two different rules apply: the path is quoted, so it only has to be quotable;
 * `kind` and every permission are unquoted, so they must match
 * `SAFE_COMMAND_TOKEN`. Permission tokens are deduped because `assertConsent`
 * compares sets: a repeated flag can never match a manifest that lists the token
 * once.
 */
function installPlan(target: string, result: PluginCheckResult): InstallPlan {
  const pathToken = commandPath(target);
  if (!isQuotablePath(pathToken)) return { kind: 'path-unsafe', path: pathToken };

  const v2 = result.apiVersion === 2 || typeof result.kind === 'string';
  const kind = typeof result.kind === 'string' && result.kind.length > 0 ? result.kind : 'trusted';
  const permissions = [...new Set(
    (result.permissions ?? []).filter((permission): permission is string => typeof permission === 'string'),
  )];
  const unquoted = v2 ? [kind, ...permissions] : [];
  const unsafeTokens = unquoted.filter((token) => !isSafeCommandToken(token));
  if (unsafeTokens.length > 0) return { kind: 'tokens-unsafe', tokens: unsafeTokens };

  const command = ['mafw', 'plugins', 'install', `"${pathToken}"`];
  if (v2) {
    command.push('--trust', kind);
    for (const permission of permissions) command.push('--permission', permission);
  }
  return { kind: 'ready', command: command.join(' ') };
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
      if (!(used ?? []).includes(name)) out.push(`${label} "${text(name)}"`);
    }
  }
  return out;
}

function nextSteps(target: string, result: PluginCheckResult, strictFailed: boolean): string[] {
  const steps: string[] = [];
  if (strictFailed) {
    steps.push('next: fix the manifest warnings above (they come from plugin.json normalization) or drop --strict');
  }
  if (result.ok !== true) {
    const error = typeof result.error === 'string' ? result.error : '';
    if (error.includes('is not declared in plugin.json contributes.gateway.')) {
      steps.push('next: add the name to contributes.gateway in plugin.json, or stop registering it in activate()');
    } else if (error.includes('permission denied')) {
      steps.push('next: add the missing permission to plugin.json "permissions"');
    }
    steps.push(`next: fix the error above, then re-run: mafw plugin check "${text(target)}"`);
  }
  return steps;
}

export async function runPluginStandardCommand(
  argv: string[],
  deps: PluginStandardDeps,
): Promise<number> {
  const args = [...argv];
  // `--json` is decided before any validation so early failures keep the
  // machine channel a single parseable line too.
  const asJson = args.includes('--json');
  const command = args.shift();

  if (command !== 'check') {
    const missing = command === undefined || command.length === 0;
    const message = missing ? 'missing plugin command' : `unknown plugin command: ${command}`;
    return fail(
      deps,
      asJson,
      message,
      missing ? [USAGE] : [`unknown plugin command: ${text(command)}`, USAGE],
    );
  }

  const unknownFlag = args.find((arg) => arg.startsWith('--') && !CHECK_FLAGS.has(arg));
  if (unknownFlag) {
    return fail(deps, asJson, `unknown flag: ${unknownFlag}`, [
      `unknown flag: ${text(unknownFlag)}`,
      USAGE,
    ]);
  }
  const strict = args.includes('--strict');
  const target = args.find((arg) => !arg.startsWith('--'));
  if (!target) {
    return fail(deps, asJson, 'missing path', [USAGE]);
  }

  // Rejected here, not by the host: `checkPackage` resolves silently and would
  // turn `./p` into a path relative to whatever directory the CLI happens to
  // run from.
  if (!path.isAbsolute(target)) {
    const suggestion = deps.cwd ? path.resolve(deps.cwd, target) : null;
    return fail(deps, asJson, `path must be absolute: ${target}`, [
      `path must be absolute: ${text(target)}`,
      'next: pass the absolute path to the package directory'
        + (suggestion ? ` (e.g. ${text(suggestion)})` : ''),
    ]);
  }

  let result: PluginCheckResult;
  try {
    result = await deps.check(target);
  } catch (err) {
    const message = `check failed: ${messageOf(err)}`;
    return fail(deps, asJson, message, [
      `check failed: ${text(messageOf(err))}`,
      'next: verify the path exists and is a package directory (plugin.json + index.js)',
    ]);
  }

  const warnings = (result.warnings ?? []).map((warning) => text(warning));
  const strictFailed = strict && warnings.length > 0;
  const checkOk = result.ok === true;
  const verdictOk = checkOk && !strictFailed;

  if (asJson) {
    // `ok` here is the **command verdict**, not the raw check result: a strict
    // failure must be visible without reading the exit code.
    printJson(deps, { ...result, ok: verdictOk, verdict: verdictOk ? 'ok' : 'fail', strictFailed });
    return verdictOk ? 0 : 1;
  }

  deps.print(`${checkOk ? 'ok' : 'not ok'} ${text(result.name ?? target)} (${text(target)})`);
  if (result.version) deps.print(`  version: ${text(result.version)}`);
  const apiVersion = typeof result.apiVersion === 'number' ? `apiVersion ${result.apiVersion}` : null;
  const kind = typeof result.kind === 'string' ? `kind ${text(result.kind)}` : null;
  const facts = [apiVersion, kind].filter(Boolean);
  if (facts.length > 0) deps.print(`  ${facts.join(', ')}`);
  const permissions = (result.permissions ?? [])
    .filter((permission): permission is string => typeof permission === 'string');
  if (permissions.length > 0) {
    deps.print(`  permissions: ${permissions.map((permission) => text(permission)).join(', ')}`);
  }
  const contributions = (result.contributions ?? []).map((contribution) => text(contribution));
  if (contributions.length > 0) deps.print(`  contributions: ${contributions.join(', ')}`);
  deps.print(`declared: ${formatDeclared(result.declared)}`);
  deps.print(`registered: ${formatRegistered(result.registered)}`);

  const unregistered = declaredOnly(result);
  if (unregistered.length > 0) {
    // Legal by design (packages register conditionally) — never a failure.
    deps.print(`note: declared but not registered: ${unregistered.join(', ')}`);
  }
  for (const warning of warnings) deps.print(`warning: ${warning}`);
  if (!checkOk) deps.print(`error: ${text(result.error ?? '(no reason reported)')}`);

  if (verdictOk) {
    const plan = installPlan(target, result);
    if (plan.kind === 'ready') {
      deps.print(`install: ${plan.command}`);
    } else if (plan.kind === 'path-unsafe') {
      // The path is operator input, not package text: say so, so the fix is
      // "quote/move the package", not "edit plugin.json".
      deps.print(INSTALL_OMITTED_PATH);
      deps.print(
        'warning: the package path cannot be printed inside double quotes '
        + `(it contains a quote, a control character or ends with a backslash): ${text(plan.path)}`,
      );
    } else {
      deps.print(INSTALL_OMITTED_TOKENS);
      deps.print(
        'warning: package tokens with characters that are unsafe to paste were left out of that '
        + `command: ${plan.tokens.map((token) => text(token)).join(', ')}`,
      );
    }
  } else if (strictFailed && checkOk) {
    // Terminal verdict after the evidence, before any next steps.
    deps.print('not ok: --strict turned the manifest warnings above into failures');
  }
  for (const step of nextSteps(target, result, strictFailed)) deps.print(step);

  return verdictOk ? 0 : 1;
}
