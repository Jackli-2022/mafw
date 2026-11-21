/**
 * Shared module-specifier scanner for the boundary guards (Plan 6 Task 7 fix).
 *
 * The first version of the guards scanned line-by-line:
 *
 *   const trimmed = line.trim();
 *   if (!trimmed.startsWith('import') && !trimmed.includes('require(')) continue;
 *   const from = /from\s+['"]([^'"]+)['"]/.exec(trimmed);
 *
 * That silently misses the shapes TypeScript/Prettier actually produce in this
 * repo, because the specifier is not on the `import` line:
 *
 *   import {
 *     a,
 *     b,
 *   } from '@mafw/adapter-pi';
 *   export * from '@mafw/adapter-opencode';
 *
 * The scanner below collects specifiers over the whole (comment-stripped) text,
 * so multi-line imports, re-exports and `require()`/`import()` calls are all
 * covered. Comments are stripped with the shared state machine in
 * `packages/test-shim/comment-strip` (same implementation as the other
 * architecture guards): a commented-out import never counts, and line numbers
 * stay aligned with the source file.
 */
import { builtinModules as BUILTIN_MODULES } from 'node:module';
import { stripComments } from '../../../../packages/test-shim/comment-strip';

export interface ScannedSpecifier {
  /** Module specifier exactly as written (quotes stripped). */
  specifier: string;
  /** 1-based line holding the specifier text (the `from` / `require` / `import` line). */
  line: number;
  /** Trimmed source text of that line, for violation messages. */
  snippet: string;
}

/**
 * `from '<spec>'`, `require('<spec>')`, `import('<spec>')`.
 *
 * Matching `from` (rather than `import`) is what makes multi-line imports and
 * `export * from` / `export { x } from` work: every import form ends in a
 * `from '<specifier>'` clause on the last line of the statement.
 */
const SPECIFIER_PATTERN =
  /\bfrom\s*(['"])([^'"]+)\1|\brequire\s*\(\s*(['"])([^'"]+)\3\s*\)|\bimport\s*\(\s*(['"])([^'"]+)\5\s*\)/g;

/** Collect every module specifier in `source`, comment-safe and multi-line-safe. */
export function scanModuleSpecifiers(source: string): ScannedSpecifier[] {
  const code = stripComments(source).code;
  const lines = code.split('\n');
  const lineStarts: number[] = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') lineStarts.push(i + 1);
  }

  const out: ScannedSpecifier[] = [];
  for (const match of code.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[2] ?? match[4] ?? match[6];
    if (!specifier) continue;
    const index = match.index ?? 0;
    let line = 1;
    for (let i = lineStarts.length - 1; i >= 0; i--) {
      if (lineStarts[i] <= index) { line = i + 1; break; }
    }
    out.push({ specifier, line, snippet: (lines[line - 1] ?? '').trim() });
  }
  return out;
}

/** Specifiers in `source` that the supplied allowlist rejects. */
export function disallowedSpecifiers(
  source: string,
  isAllowed: (specifier: string) => boolean,
): ScannedSpecifier[] {
  return scanModuleSpecifiers(source).filter((entry) => !isAllowed(entry.specifier));
}

/**
 * Allowlist for `adapters/opencode/src` (Plan 6 global constraint):
 * contract + core, the driver's own native dependencies, Node builtins and
 * local modules. Anything else — especially `gateway/src` — is a violation.
 */
const ADAPTER_ALLOWED_PACKAGES = new Set([
  '@mafw/runtime-contract',
  '@mafw/runtime-core',
  '@opencode-ai/sdk',
  '@opencode-ai/sdk/v2',
  'jsonc-parser',
  'cross-spawn',
]);

const ADAPTER_BUILTINS = new Set(BUILTIN_MODULES.flatMap((name) => [name, `node:${name}`]));

export function isAllowedAdapterSpecifier(specifier: string): boolean {
  if (specifier.startsWith('./')) return true;
  // `node:sqlite` is a builtin on newer Node but may be absent from
  // `builtinModules` on older runtimes; the scheme is the stable signal.
  if (specifier.startsWith('node:')) return true;
  return ADAPTER_BUILTINS.has(specifier) || ADAPTER_ALLOWED_PACKAGES.has(specifier);
}
