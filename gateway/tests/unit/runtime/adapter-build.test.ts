/**
 * Task 3 — freshness predicate for the adapter build helper.
 *
 * These cases run on temp directories only: the real `adapters/opencode/dist`
 * is never touched, so the suite stays fast and does not race the packaging
 * tests that share the helper.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  adapterBuildFresh,
  adapterBuildStatus,
  ensureAdapterBuilt,
  type BuildRunner,
} from '../../helpers/adapter-build';

const BASE_TIME = new Date('2026-01-01T00:00:00Z').getTime();
const MINUTE = 60_000;

let root: string;
let adapterDir: string;

function write(rel: string, mtimeOffset: number): string {
  const file = path.join(adapterDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '// fixture\n');
  fs.utimesSync(file, new Date(BASE_TIME + mtimeOffset), new Date(BASE_TIME + mtimeOffset));
  return file;
}

/** Fresh layout: sources at T0, outputs at T0 + 1min. */
function seedFreshLayout(): void {
  write('build.mjs', 0);
  write('tsconfig.build.json', 0);
  write('src/index.ts', 0);
  write('src/nested/deep.ts', 0);
  write('dist/index.js', MINUTE);
  write('dist/index.d.ts', MINUTE);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-adapter-build-'));
  adapterDir = path.join(root, 'adapters', 'opencode');
  fs.mkdirSync(adapterDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

it('treats a dist newer than every source as fresh', () => {
  seedFreshLayout();
  expect(adapterBuildFresh(adapterDir)).toBe(true);
  expect(adapterBuildStatus(adapterDir).reason).toBeUndefined();
});

it('rebuilds when a nested source is newer than dist', () => {
  seedFreshLayout();
  write('src/nested/deep.ts', MINUTE * 2);
  const status = adapterBuildStatus(adapterDir);
  expect(status.fresh).toBe(false);
  expect(status.reason).toContain(path.join('src', 'nested', 'deep.ts'));
});

it('rebuilds when build.mjs changes', () => {
  seedFreshLayout();
  write('build.mjs', MINUTE * 2);
  expect(adapterBuildFresh(adapterDir)).toBe(false);
});

it('rebuilds when tsconfig.build.json changes', () => {
  seedFreshLayout();
  write('tsconfig.build.json', MINUTE * 2);
  expect(adapterBuildFresh(adapterDir)).toBe(false);
});

it('rebuilds when either output is missing', () => {
  seedFreshLayout();
  fs.rmSync(path.join(adapterDir, 'dist', 'index.d.ts'));
  expect(adapterBuildStatus(adapterDir).reason).toContain('dist/index.d.ts');

  seedFreshLayout();
  fs.rmSync(path.join(adapterDir, 'dist', 'index.js'));
  expect(adapterBuildStatus(adapterDir).reason).toContain('dist/index.js');
});

it('rebuilds when there are no build inputs at all', () => {
  write('dist/index.js', MINUTE);
  write('dist/index.d.ts', MINUTE);
  expect(adapterBuildStatus(adapterDir).reason).toContain('no build inputs');
});

it('does not invoke the build when dist is fresh', () => {
  seedFreshLayout();
  const run: BuildRunner = jest.fn(() => ({ status: 0 }));
  ensureAdapterBuilt({ adapterDir, run });
  expect(run).not.toHaveBeenCalled();
});

it('invokes the build when stale and surfaces stdout/stderr on failure', () => {
  seedFreshLayout();
  write('src/index.ts', MINUTE * 2);

  const ok: BuildRunner = jest.fn(() => ({ status: 0 }));
  ensureAdapterBuilt({ adapterDir, run: ok });
  expect(ok).toHaveBeenCalledTimes(1);
  expect((ok as jest.Mock).mock.calls[0][0]).toBe(adapterDir);

  const failing: BuildRunner = () => ({ status: 1, stdout: 'esbuild out', stderr: 'boom: tsconfig' });
  expect(() => ensureAdapterBuilt({ adapterDir, run: failing })).toThrow(/boom: tsconfig/);
  expect(() => ensureAdapterBuilt({ adapterDir, run: failing })).toThrow(/esbuild out/);
});
