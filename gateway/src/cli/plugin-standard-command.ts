/**
 * `mafw plugin ...` — the in-process plugin standard surface.
 *
 * `init` writes the smallest package that already passes `check` (inline
 * templates, no build-time files): one action, one event, and a manifest whose
 * `contributes.gateway` declares exactly what `activate()` registers. An author
 * therefore starts inside the standard's bounds.
 *
 * `check` runs the *same* judgement function as a real activation
 * (`PluginHost.checkPackage`, a dry-run activation) inside this CLI process:
 * no gateway, no human token, no network. It prints the declared-vs-registered
 * inventory and a paste-ready install command, so an agent can self-verify a
 * package before asking a human for consent. The inventory carries the delta
 * inline (`+name` = registered but not declared; `-name` = the legal opposite),
 * and a classified failure is printed as `error[<code>]: …`, so a CI or an agent
 * can switch on the code instead of the prose.
 *
 * `schema` prints the machine-readable manifest contract
 * (`MANIFEST_JSON_SCHEMA`) for editors and agents. It is deliberately the
 * schema document itself, not a report about it: the caller asked for the
 * contract, not for a verdict on it.
 *
 * Everything here is a pure function over injected deps: the CLI entrypoint
 * (`bin/mafw.js`) owns process/fs wiring where it can, tests own the assertions.
 * `init` is the exception that necessarily touches fs — it writes only under
 * the given parent directory.
 *
 * Output safety: every package-derived value (name, permissions, warning and
 * error text, plane names) is flattened before it reaches the terminal, and the
 * install line is only printed when *every* token in it matches
 * `SAFE_COMMAND_TOKEN`. `isKnownPermissionToken` only prefix-checks
 * `net.fetch:`, so a manifest can legally declare a token containing `;` or a
 * newline; pasting that line would execute whatever follows it.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { PluginCheckResult } from '../plugins/package-host';
import { MANIFEST_JSON_SCHEMA } from '../plugins/manifest-schema';
import {
  PACKAGE_NAME_MAX_LENGTH,
  packageNameError,
  pluginTemplates,
  PACKAGE_NAME_RULE,
  type PluginTemplateFiles,
} from './plugin-templates';

export interface PluginStandardDeps {
  /** In-process check; the CLI passes `createLocalCheck()`. */
  check(path: string): Promise<PluginCheckResult>;
  print(text: string): void;
  /** Used by `init` for the default target, and to suggest absolute paths. */
  cwd?: string;
}

const USAGE = [
  'usage: mafw plugin init <name> [--dir <parent>] [--force] [--json]',
  '       mafw plugin check <absolute-path> [--json] [--strict]',
  '       mafw plugin schema [--json]',
  '',
  '  init       Scaffold a package that already passes `plugin check`',
  '             (default target: <cwd>/.mafw/plugin-drafts/<name>)',
  '  check      Dry-run one package in this process (no gateway, no token, no network)',
  '  schema     Print the plugin.json JSON Schema (editors/agents; never stricter',
  '             than the parser)',
  '',
  '  --dir      Parent directory for init (default: <cwd>/.mafw/plugin-drafts)',
  '  --force    Overwrite the template files when the target already exists',
  '  --json     Print one JSON line; its `ok` is the command verdict (schema is',
  '             always plain JSON, so the flag changes nothing there)',
  '  --strict   Treat manifest warnings as failures (check only)',
].join('\n');

const CHECK_FLAGS = new Set(['--json', '--strict']);
const INIT_FLAGS = new Set(['--dir', '--force', '--json']);
const SCHEMA_FLAGS = new Set(['--json']);

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
 * What a quoted path may not contain, because the quoting cannot neutralise it:
 *
 * - `"` ends the token, and a trailing backslash escapes the closing quote
 *   (POSIX `sh` reads `\"` as a literal quote, so `/tmp/a\` swallows the quote);
 * - control/newline bytes can start a new line;
 * - `$`, `` ` `` and `!` are still *expanded inside* double quotes: `"$(calc)"`,
 *   `` "`id`" `` and (interactive bash) `"!x"` run, so a directory named
 *   `$(calc)` would execute when the printed line is pasted.
 *
 * Spaces, `&`, parentheses and non-ASCII stay allowed — double quotes make them
 * literal, and a common Windows/macOS path must not lose its install line.
 */
const UNQUOTABLE = /["$`!\u0000-\u001f\u007f-\u009f]/;

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
 * The path is printed inside double quotes, so only characters the quoting can
 * NOT neutralise matter: quote-breakers, control bytes, and shell expansion
 * (`$`, `` ` ``, `!`). Spaces, punctuation and CJK are literal there, so
 * `C:/Program Files/mafw/pkg` and non-ASCII home directories stay installable.
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
 * One plane on the `declared:` line, as a delta against what was registered.
 *
 * `-name` means the manifest allows it and nothing registered it: legal by
 * design (packages register conditionally), so the marker is informational.
 * `registered` is only consulted here, never printed: a name that is not
 * declared does not belong on a line that claims to describe the declaration.
 * Without a registered view to compare against (legacy result shape), the plane
 * keeps its plain rendering.
 *
 * Plane lists are space-joined (`[ping +pong]`): the markers are per-token, and
 * a name can never contain a space (the manifest name pattern forbids it), so
 * one token is always one name on the two lines a human compares.
 */
function formatDeclaredPlane(
  declared: string[] | undefined,
  registered: string[] | undefined,
): string {
  if (declared === undefined) return '(unbounded)';
  if (declared.length === 0) return '[]';
  if (registered === undefined) return `[${declared.map((name) => text(name)).join(' ')}]`;
  const used = new Set(registered);
  const missing = declared.filter((name) => !used.has(name));
  if (missing.length === 0) return `[${declared.map((name) => text(name)).join(' ')}]`;
  return `[${declared.map((name) => (used.has(name) ? text(name) : `-${text(name)}`)).join(' ')}]`;
}

/**
 * One plane on the `registered:` line, as a delta against the declaration.
 *
 * `+name` is registered but not declared — the one shape that fails a check
 * *because* of this line, so it must be visible without reading the error text.
 * Declared names come first **in declaration order** (the two lines then line
 * up), extras follow in registration order. An undeclared plane is unbounded:
 * nothing on it is a delta, so it is never marked.
 */
function formatRegisteredPlane(
  declared: string[] | undefined,
  registered: string[] | undefined,
): string {
  if (registered === undefined) return '-';
  if (declared === undefined) {
    return registered.length === 0 ? '[]' : `[${registered.map((name) => text(name)).join(' ')}]`;
  }
  const declaredNames = new Set(declared);
  const registeredNames = new Set(registered);
  const inDeclaredOrder = declared.filter((name) => registeredNames.has(name));
  const extras = registered.filter((name) => !declaredNames.has(name));
  if (extras.length === 0) {
    return inDeclaredOrder.length === 0 ? '[]' : `[${inDeclaredOrder.map((name) => text(name)).join(' ')}]`;
  }
  const tokens = [
    ...inDeclaredOrder.map((name) => text(name)),
    ...extras.map((name) => `+${text(name)}`),
  ];
  return `[${tokens.join(' ')}]`;
}

/**
 * `actions [a b], events [], tools (unbounded), observers (unbounded), http true`.
 *
 * `declared` and `registered` are the two lines a human is told to compare, so
 * the `http` field uses one vocabulary on both: a boolean flag on the manifest
 * side (`true` / `false`, or `(unbounded)` when the key is absent) and a route
 * count on the activation side (`N route(s)`). Never `declared` / `opted out`.
 *
 * Name planes carry the delta inline (see `formatDeclaredPlane` /
 * `formatRegisteredPlane`): a declared name that never registered is legal, a
 * registered name that was not declared is the violation.
 */
function formatDeclared(
  declared: DeclaredView | undefined,
  registered: RegisteredView | undefined,
): string {
  if (!declared) return '(no contributes.gateway block — no static upper bound)';
  return [
    `actions ${formatDeclaredPlane(declared.actions, registered?.actions)}`,
    `events ${formatDeclaredPlane(declared.events, registered?.events)}`,
    `tools ${formatDeclaredPlane(declared.tools, registered?.tools)}`,
    `observers ${formatDeclaredPlane(declared.observers, registered?.observers)}`,
    declared.http === undefined ? 'http (unbounded)' : `http ${declared.http}`,
  ].join(', ');
}

/** `actions [a b], events -, tools -, observers -, http 2 route(s)`. */
function formatRegistered(
  registered: RegisteredView | undefined,
  declared: DeclaredView | undefined,
): string {
  if (!registered) return '(not reported)';
  return [
    `actions ${formatRegisteredPlane(declared?.actions, registered.actions)}`,
    `events ${formatRegisteredPlane(declared?.events, registered.events)}`,
    `tools ${formatRegisteredPlane(declared?.tools, registered.tools)}`,
    `observers ${formatRegisteredPlane(declared?.observers, registered.observers)}`,
    `http ${typeof registered.http === 'number' ? registered.http : 0} route(s)`,
  ].join(', ');
}

/**
 * The terminal failure line: `error[<code>]: <message>` when the host classified
 * the failure, `error: <message>` for an older/foreign result shape.
 *
 * The code is the machine half (CI and agents switch on it); the message is the
 * human half and stays byte-identical to what the host produced.
 */
function errorLine(result: PluginCheckResult): string {
  const code = typeof result.code === 'string' && result.code.length > 0
    ? `[${text(result.code, 40)}]`
    : '';
  return `error${code}: ${text(result.error ?? '(no reason reported)')}`;
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

/** Identity fields a manifest can still supply when the check itself failed. */
interface CheckFacts {
  apiVersion?: number;
  kind?: string;
  permissions?: string[];
}

/**
 * Best-effort identity block for a failed check.
 *
 * `checkPackage` only attaches `apiVersion` / `kind` / `permissions` to a
 * candidate that activated; a package rejected earlier still has a readable
 * `plugin.json`, and that manifest is exactly what the author is debugging.
 * Display-only: never throws, never validated, never influences the verdict.
 * A manifest that changed mid-check can only make the printed facts stale, not
 * wrong about the file on disk at the moment it is read.
 */
function manifestFacts(target: string): CheckFacts {
  try {
    if (!fs.statSync(target).isDirectory()) return {};
    const raw = JSON.parse(fs.readFileSync(path.join(target, 'plugin.json'), 'utf-8')) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const record = raw as Record<string, unknown>;
    const facts: CheckFacts = {};
    if (typeof record.apiVersion === 'number') facts.apiVersion = record.apiVersion;
    if (typeof record.kind === 'string' && record.kind.length > 0) facts.kind = record.kind;
    if (Array.isArray(record.permissions)) {
      const permissions = record.permissions
        .filter((permission): permission is string => typeof permission === 'string');
      if (permissions.length > 0) facts.permissions = permissions;
    }
    return facts;
  } catch {
    return {};
  }
}

/**
 * The command a failing author should run next, carrying the flags they
 * actually passed: a `--strict` run that prints a bare re-run command silently
 * downgrades the gate on the next attempt (and can then return `ok` on a
 * package that still has warnings).
 */
function recheckCommand(target: string, flags: readonly string[]): string {
  const suffix = flags.length > 0 ? ` ${flags.join(' ')}` : '';
  return `mafw plugin check "${target}"${suffix}`;
}

function nextSteps(
  target: string,
  result: PluginCheckResult,
  strictFailed: boolean,
  flags: readonly string[],
): string[] {
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
    steps.push(`next: fix the error above, then re-run: ${recheckCommand(text(target), flags)}`);
  }
  return steps;
}

/**
 * The one command that verifies a freshly scaffolded package.
 *
 * Same quoting rule as the install line: a path holding a shell-expandable
 * character (`$`, backtick, `!`) is *named*, not pasted — the operator chose
 * the directory, the package is still fine.
 */
function nextCheckStep(target: string): string {
  if (!isQuotablePath(target)) {
    return 'next: run "mafw plugin check" on the path above — it contains characters '
      + 'that cannot be printed inside a shell command safely';
  }
  return `next: mafw plugin check "${target}"`;
}

/**
 * `mafw plugin init <name>` — writes the three template files, prints `created`
 * plus the single command that verifies them.
 *
 * The name is operator input and must sit exactly inside the manifest's name
 * rule: every template embeds it in generated source and it becomes a directory
 * name, so an invalid one is rejected before anything touches disk.
 */
async function runInit(
  args: string[],
  deps: PluginStandardDeps,
  asJson: boolean,
): Promise<number> {
  const unknownFlag = args.find((arg) => arg.startsWith('--') && !INIT_FLAGS.has(arg));
  if (unknownFlag) {
    return fail(deps, asJson, `unknown flag: ${unknownFlag}`, [
      `unknown flag: ${text(unknownFlag)}`,
      USAGE,
    ]);
  }

  const dirIndex = args.indexOf('--dir');
  let parentArg: string | undefined;
  if (dirIndex >= 0) {
    parentArg = args[dirIndex + 1];
    // A following flag means the value is missing; never take `--force` as a path.
    if (parentArg === undefined || parentArg.startsWith('--')) {
      return fail(deps, asJson, 'missing value for --dir', [
        'missing value for --dir <parent>',
        USAGE,
      ]);
    }
  }

  const positional = args.filter(
    (arg, index) => !arg.startsWith('--') && (dirIndex < 0 || index !== dirIndex + 1),
  );
  const name = positional[0];
  if (name === undefined || name.length === 0) {
    return fail(deps, asJson, 'missing package name', [USAGE]);
  }
  if (positional.length > 1) {
    // `init a b` cannot mean "create b inside a" — `--dir` is the only way to
    // choose a parent, and guessing here would write to the wrong place.
    return fail(deps, asJson, `unexpected argument: ${positional[1]}`, [
      `unexpected argument: ${text(positional[1])}`,
      USAGE,
    ]);
  }
  // `init` is one rule stricter than the manifest: its own event type is
  // `plugin:<name>:ping`, so it refuses names longer than 100 characters to keep
  // that type inside the 128-character identifier ceiling with room to spare.
  // The parser keeps the plain rule (a hand-written package may use a longer
  // name), which is also why the published schema has no `maxLength` on `name`.
  const nameError = packageNameError(name);
  if (nameError !== null) {
    return fail(deps, asJson, nameError, [
      `invalid package name: ${text(name)}`,
      ...(name.length > PACKAGE_NAME_MAX_LENGTH
        ? [`package name must be at most ${PACKAGE_NAME_MAX_LENGTH} characters`]
        : []),
      `rule: ${PACKAGE_NAME_RULE}`,
      'next: pass a name like "my-plugin"',
    ]);
  }

  const base = deps.cwd ?? process.cwd();
  const parent = parentArg === undefined
    ? path.join(path.resolve(base), '.mafw', 'plugin-drafts')
    : path.resolve(base, parentArg);
  const target = path.join(parent, name);

  if (fs.existsSync(target) && !args.includes('--force')) {
    return fail(deps, asJson, `refusing to overwrite: ${target} (pass --force)`, [
      `refusing to overwrite: ${text(target)} (pass --force)`,
      'next: pass --force to rewrite the three template files, or pick another name',
    ]);
  }

  let files: PluginTemplateFiles;
  try {
    // `pluginTemplates` is called inside the guard too: a name that slipped
    // past validation must become "init failed", never an unhandled rejection.
    files = pluginTemplates(name);
    fs.mkdirSync(target, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(target, file), content, 'utf8');
    }
  } catch (err) {
    return fail(deps, asJson, `init failed: ${messageOf(err)}`, [
      `init failed: ${text(messageOf(err))}`,
      `next: check that ${text(target)} is writable`,
    ]);
  }

  const printedTarget = commandPath(target);
  if (asJson) {
    printJson(deps, {
      ok: true,
      verdict: 'ok',
      name,
      path: printedTarget,
      files: Object.keys(files),
    });
    return 0;
  }

  deps.print(`created ${text(target)}`);
  deps.print(nextCheckStep(printedTarget));
  return 0;
}

/**
 * `mafw plugin schema` — the `plugin.json` contract as one JSON document.
 *
 * No envelope: an editor or agent asked for the schema, so it gets the schema.
 * `--json` is accepted for symmetry with the sibling subcommands (and changes
 * nothing); any other flag would silently imply the flag did something.
 */
function runSchema(args: string[], deps: PluginStandardDeps, asJson: boolean): number {
  const unknownFlag = args.find((arg) => arg.startsWith('--') && !SCHEMA_FLAGS.has(arg));
  if (unknownFlag) {
    return fail(deps, asJson, `unknown flag: ${unknownFlag}`, [
      `unknown flag: ${text(unknownFlag)}`,
      USAGE,
    ]);
  }
  const extra = args.find((arg) => !arg.startsWith('--'));
  if (extra !== undefined) {
    return fail(deps, asJson, `unexpected argument: ${extra}`, [
      `unexpected argument: ${text(extra)}`,
      USAGE,
    ]);
  }
  deps.print(JSON.stringify(MANIFEST_JSON_SCHEMA, null, 2));
  return 0;
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

  if (command === 'init') {
    return runInit(args, deps, asJson);
  }

  if (command === 'schema') {
    return runSchema(args, deps, asJson);
  }

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
  // Echo the gate the author actually chose into the re-run hint; only the
  // human channel prints hints (so `--json` is unreachable here today, but the
  // helper stays faithful to argv rather than assuming).
  const echoedFlags = [...new Set(args.filter((arg) => CHECK_FLAGS.has(arg)))];
  // A rejected candidate never activates, so the host's result carries no
  // identity block; the manifest is still on disk and is what the author is
  // debugging. Printer-only fallback (see `manifestFacts`).
  const fallbackFacts: CheckFacts = checkOk ? {} : manifestFacts(target);

  if (asJson) {
    // `ok` here is the **command verdict**, not the raw check result: a strict
    // failure must be visible without reading the exit code. Facts come first
    // so a result field always wins over the disk fallback.
    printJson(deps, {
      ...fallbackFacts,
      ...result,
      ok: verdictOk,
      verdict: verdictOk ? 'ok' : 'fail',
      strictFailed,
    });
    return verdictOk ? 0 : 1;
  }

  deps.print(`${checkOk ? 'ok' : 'not ok'} ${text(result.name ?? target)} (${text(target)})`);
  if (result.version) deps.print(`  version: ${text(result.version)}`);
  const apiVersionValue = typeof result.apiVersion === 'number'
    ? result.apiVersion
    : fallbackFacts.apiVersion;
  const kindValue = typeof result.kind === 'string' ? result.kind : fallbackFacts.kind;
  const apiVersion = typeof apiVersionValue === 'number' ? `apiVersion ${apiVersionValue}` : null;
  const kind = typeof kindValue === 'string' ? `kind ${text(kindValue)}` : null;
  const facts = [apiVersion, kind].filter(Boolean);
  if (facts.length > 0) deps.print(`  ${facts.join(', ')}`);
  const permissions = (result.permissions ?? fallbackFacts.permissions ?? [])
    .filter((permission): permission is string => typeof permission === 'string');
  if (permissions.length > 0) {
    deps.print(`  permissions: ${permissions.map((permission) => text(permission)).join(', ')}`);
  }
  const contributions = (result.contributions ?? []).map((contribution) => text(contribution));
  if (contributions.length > 0) deps.print(`  contributions: ${contributions.join(', ')}`);
  deps.print(`declared: ${formatDeclared(result.declared, result.registered)}`);
  deps.print(`registered: ${formatRegistered(result.registered, result.declared)}`);
  // `check` is a dry-run activation, not a sandbox: the author must know the
  // package's own side effects already happened.
  deps.print(
    'note: check is not a sandbox: the package\'s activate() really ran, '
    + 'so any side effects it caused have already happened',
  );

  const unregistered = declaredOnly(result);
  if (unregistered.length > 0) {
    // Legal by design (packages register conditionally) — never a failure.
    deps.print(`note: declared but not registered: ${unregistered.join(', ')}`);
  }
  for (const warning of warnings) deps.print(`warning: ${warning}`);
  if (!checkOk) deps.print(errorLine(result));

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
        + '(it contains a shell-expandable character, a quote or a control character, '
        + `or ends with a backslash): ${text(plan.path)}`,
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
  for (const step of nextSteps(target, result, strictFailed, echoedFlags)) deps.print(step);

  return verdictOk ? 0 : 1;
}
