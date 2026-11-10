/**
 * Build helper for the extracted `@mafw/adapter-opencode` package.
 *
 * The packaging suites (`opencode-package.test.ts`, the staging test in
 * `plugin-package-e2e.test.ts`) assert against the *built* bundle, while Jest
 * resolves the package to its TypeScript source (see `jest.config.js`). A clean
 * checkout therefore has no `adapters/opencode/dist` and those suites fail for a
 * reason that has nothing to do with what they pin.
 *
 * `ensureAdapterBuilt()` closes that gap without turning every test run into a
 * build: the bundle is rebuilt only when an output is missing or older than the
 * newest build input (`src/**\/*.ts`, `build.mjs`, `tsconfig.build.json`).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const ADAPTER_DIR = path.join(REPO_ROOT, 'adapters', 'opencode');

/** Outputs the packaging suites require. */
export const BUILD_OUTPUTS = ['dist/index.js', 'dist/index.d.ts'] as const;

/** Non-source build inputs at the adapter root. */
const BUILD_INPUT_FILES = ['build.mjs', 'tsconfig.build.json'] as const;

export interface BuildInput {
  file: string;
  mtimeMs: number;
}

export interface AdapterBuildStatus {
  fresh: boolean;
  /** Why the build is stale (human readable, used in failure messages). */
  reason?: string;
  /** Newest source/input file, absent when no input exists at all. */
  newestInput?: BuildInput;
  /** Oldest output, absent when an output is missing. */
  oldestOutput?: BuildInput;
}

function walkTypeScript(dir: string, out: string[]): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTypeScript(file, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(file);
  }
  return out;
}

/** Every file whose change must invalidate the bundle. */
export function buildInputFiles(adapterDir: string = ADAPTER_DIR): string[] {
  const files = BUILD_INPUT_FILES.map((name) => path.join(adapterDir, name))
    .filter((file) => fs.existsSync(file));
  return [...files, ...walkTypeScript(path.join(adapterDir, 'src'), [])];
}

function statOrUndefined(file: string): BuildInput | undefined {
  try {
    return { file, mtimeMs: fs.statSync(file).mtimeMs };
  } catch {
    return undefined;
  }
}

/**
 * Pure-ish freshness predicate: no build side effects, safe to unit-test with
 * temp directories. Fresh means every output exists and none of them is older
 * than any input.
 */
export function adapterBuildStatus(adapterDir: string = ADAPTER_DIR): AdapterBuildStatus {
  const outputs = BUILD_OUTPUTS.map((rel) => statOrUndefined(path.join(adapterDir, rel)));
  const missing = BUILD_OUTPUTS.find((_, index) => !outputs[index]);
  if (missing) return { fresh: false, reason: `${missing} is missing` };

  const inputs = buildInputFiles(adapterDir).map((file) => statOrUndefined(file)!);
  if (inputs.length === 0) return { fresh: false, reason: 'no build inputs found (src/**/*.ts, build.mjs)' };

  const present = outputs as BuildInput[];
  const newestInput = inputs.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a));
  const oldestOutput = present.reduce((a, b) => (b.mtimeMs < a.mtimeMs ? b : a));
  if (newestInput.mtimeMs > oldestOutput.mtimeMs) {
    return {
      fresh: false,
      reason: `${path.relative(adapterDir, newestInput.file)} is newer than ${path.relative(adapterDir, oldestOutput.file)}`,
      newestInput,
      oldestOutput,
    };
  }
  return { fresh: true, newestInput, oldestOutput };
}

export function adapterBuildFresh(adapterDir: string = ADAPTER_DIR): boolean {
  return adapterBuildStatus(adapterDir).fresh;
}

export type BuildRunner = (adapterDir: string) => { status: number | null; stdout?: string | null; stderr?: string | null };

function defaultRunner(adapterDir: string) {
  return spawnSync(process.execPath, [path.join(adapterDir, 'build.mjs')], {
    cwd: adapterDir,
    encoding: 'utf8',
    env: process.env,
  });
}

export interface EnsureAdapterBuiltOptions {
  adapterDir?: string;
  /** Injection point for tests: defaults to `node build.mjs` in the adapter dir. */
  run?: BuildRunner;
}

/**
 * Build `adapters/opencode/dist` when it is missing or stale. Throws with the
 * build's stdout/stderr so the packaging suites report the real cause.
 */
export function ensureAdapterBuilt(options: EnsureAdapterBuiltOptions = {}): void {
  const adapterDir = options.adapterDir ?? ADAPTER_DIR;
  const status = adapterBuildStatus(adapterDir);
  if (status.fresh) return;

  const result = (options.run ?? defaultRunner)(adapterDir);
  if (result.status === 0) return;
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  throw new Error(
    `@mafw/adapter-opencode build failed (${status.reason ?? 'stale dist'}; exit ${result.status}):\n${output}`,
  );
}
