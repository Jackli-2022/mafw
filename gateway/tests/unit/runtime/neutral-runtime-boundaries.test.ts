import * as fs from 'node:fs';
import * as path from 'node:path';
import { builtinModules } from 'node:module';
import { stripComments } from '../../../../packages/test-shim/comment-strip';
import { noRuntimeRegisteredError } from '../../../src/runtime/loader';

const NEUTRAL_FILES = [
  'adapter-event.ts',
  'adapter-event-mapper.ts',
  'adapter-bridge.ts',
  'runtime-bus.ts',
  'plugin-entry.ts',
];

const FORBIDDEN = /opencode|claude|\bpi\b/i;

function readCode(file: string): string {
  return stripComments(fs.readFileSync(file, 'utf8')).code;
}

it('neutral kernel files do not contain runtime protocol names', () => {
  const root = path.join(__dirname, '../../../src/runtime');
  const offenders: string[] = [];
  for (const file of NEUTRAL_FILES) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    if (FORBIDDEN.test(readCode(full))) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

it('only the mapper may speak payload.properties', () => {
  const root = path.join(__dirname, '../../../src/runtime');
  const offenders = NEUTRAL_FILES
    .filter((file) => file !== 'adapter-event-mapper.ts')
    .filter((file) => {
      const full = path.join(root, file);
      return fs.existsSync(full) && fs.readFileSync(full, 'utf8').includes('payload.properties');
    });
  expect(offenders).toEqual([]);
});

it('the loader has no legacy builtin registration API', () => {
  const loader = readCode(path.join(__dirname, '../../../src/runtime/loader.ts'));
  expect(loader).not.toMatch(/\bregisterBuiltin\s*\(/);
  expect(loader).not.toMatch(/\bprivate builtins\b/);
});

it('the composition root registers no legacy builtins', () => {
  const index = readCode(path.join(__dirname, '../../../src/index.ts'));
  expect(index).not.toMatch(/runtimeLoader\.registerBuiltin\s*\(/);
});

it('the composition root has no direct adapter fallback', () => {
  const index = readCode(path.join(__dirname, '../../../src/index.ts'));
  expect(index).not.toMatch(/createOpencodeRuntime\s*\(/);
  expect(index).not.toMatch(/builtin:opencode\(direct\)/);
});

it('removed the legacy bridge shim', () => {
  expect(fs.existsSync(path.join(__dirname, '../../../src/runtime/legacy'))).toBe(false);
});

it('the legacy in-tree pi driver is gone and the package shim is the only import site', () => {
  const root = path.join(__dirname, '../../../src');
  expect(fs.existsSync(path.join(root, 'runtime/pi'))).toBe(false);
  expect(fs.existsSync(path.join(root, 'runtime/plugins/pi-runtime.ts'))).toBe(false);

  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const rel = path.relative(root, full).replace(/\\/g, '/');
      for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('import') && !trimmed.includes('require(') && !trimmed.includes('import(')) continue;
        if (!trimmed.includes('@mafw/adapter-pi') && !trimmed.includes('adapters/pi')) continue;
        if (rel !== 'runtime/pi-adapter.ts') offenders.push(`${rel}: ${trimmed}`);
      }
    }
  };
  walk(root);
  expect(offenders).toEqual([]);
});

it('the pi adapter package does not reach back into the gateway', () => {
  const adapterRoot = path.join(__dirname, '../../../../adapters/pi/src');
  const offenders: string[] = [];
  const allowedPackage = (line: string) =>
    line.includes("'@mafw/runtime-contract") ||
    line.includes("'@mafw/runtime-core") ||
    line.includes("'@earendil-works/pi-coding-agent") ||
    /from\s+['"](?:node:)?(?:fs|path|crypto|os|url|util)['"]/.test(line) ||
    /require\(\s*['"](?:node:)?(?:fs|path|crypto|os|url|util)['"]\s*\)/.test(line);
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(path.join(dir, entry.name)); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const full = path.join(dir, entry.name);
      for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('import') && !trimmed.includes('require(') && !trimmed.includes('import(')) continue;
        const specifier = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/.exec(trimmed);
        const from = specifier?.[1] ?? specifier?.[2];
        if (!from) continue;
        if (from.startsWith('.')) {
          if (from.startsWith('../../')) offenders.push(`${entry.name}: ${trimmed}`);
          continue;
        }
        if (!allowedPackage(trimmed)) offenders.push(`${entry.name}: ${trimmed}`);
      }
    }
  };
  walk(adapterRoot);
  expect(offenders).toEqual([]);
});

/**
 * Task 7 (Plan 6) boundary guards — the opencode driver lives in
 * `adapters/opencode` and reaches the gateway through exactly one package shim.
 *
 * The full “no protocol names anywhere in gateway/src” guard belongs to the
 * later Phase 4 plan; these assertions only pin the physical boundary that
 * Task 5/6 established, so a future edit cannot quietly reintroduce a gateway
 * copy of the driver (or a second package import site).
 */
const OPENCODE_MOVED_MODULES = [
  // driver assembly (Task 6)
  'opencode-runtime.ts',
  'opencode-definition.ts',
  // pure driver modules (Task 5)
  'opencode-events.ts',
  'opencode-21-events.ts',
  'opencode-history.ts',
  'opencode-snapshot.ts',
  'opencode-mcp.ts',
  'opencode-mcp-config.ts',
  'opencode-canonical.ts',
  'opencode-dialect-probe.ts',
  'auth.ts',
  'provider-settings.ts',
  'serve-sidecar.ts',
  'mcp-jsonc.ts',
  'form-question.ts',
];

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

it('gateway/src/runtime no longer carries the moved opencode driver modules', () => {
  const root = path.join(__dirname, '../../../src/runtime');
  // The scan itself must see files (a renamed/relocated src tree would make
  // every "missing" assertion below vacuously true).
  expect(walkTs(root).length).toBeGreaterThan(40);
  const present = OPENCODE_MOVED_MODULES.filter((file) => fs.existsSync(path.join(root, file)));
  expect(present).toEqual([]);
});

it('only the package shim resolves @mafw/adapter-opencode / adapters/opencode', () => {
  const root = path.join(__dirname, '../../../src');
  const SHIM = 'runtime/opencode-adapter.ts';
  const offenders: string[] = [];
  for (const file of walkTs(root)) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    if (rel === SHIM) continue;
    const code = stripComments(fs.readFileSync(file, 'utf8')).code;
    for (const line of code.split('\n')) {
      if (line.includes('@mafw/adapter-opencode') || line.includes('adapters/opencode')) {
        offenders.push(`${rel}: ${line.trim()}`);
      }
    }
  }
  expect(offenders).toEqual([]);
  // Reverse fixture: the shim must still be the package entry (otherwise the
  // positive half of this guard could pass on a driver-less gateway).
  expect(fs.readFileSync(path.join(root, SHIM), 'utf8')).toContain("require('@mafw/adapter-opencode')");
});

it('the opencode adapter package does not reach back into the gateway', () => {
  // Same allowlist as the pi extraction: contract + core + the driver's own
  // native dependencies, Node builtins and local modules. No `gateway/src`.
  const adapterRoot = path.join(__dirname, '../../../../adapters/opencode/src');
  const ALLOWED_PACKAGES = new Set([
    '@mafw/runtime-contract',
    '@mafw/runtime-core',
    '@opencode-ai/sdk',
    '@opencode-ai/sdk/v2',
    'jsonc-parser',
    'cross-spawn',
  ]);
  const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  const SPECIFIER = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/;

  const files = walkTs(adapterRoot);
  expect(files.length).toBeGreaterThan(15);

  const offenders: string[] = [];
  for (const file of files) {
    const rel = path.relative(adapterRoot, file).replace(/\\/g, '/');
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('import') && !trimmed.includes('require(') && !trimmed.includes('import(')) continue;
      const match = SPECIFIER.exec(trimmed);
      const from = match?.[1] ?? match?.[2] ?? match?.[3];
      if (!from) continue;
      if (from.startsWith('./')) continue;
      if (BUILTINS.has(from) || ALLOWED_PACKAGES.has(from)) continue;
      offenders.push(`${rel}: ${trimmed}`);
    }
  }
  expect(offenders).toEqual([]);
});

it('missing-surface errors stay runtime-neutral', () => {
  const access = readCode(path.join(__dirname, '../../../src/runtime/runtime-access.ts'));
  expect(FORBIDDEN.test(access)).toBe(false);
});

it('the cold-start error names the configured runtime and stays neutral', () => {
  const err = noRuntimeRegisteredError('missing-plugin');
  expect(err.message).toContain("'missing-plugin'");
  expect(err.message).toContain('Configure runtime.plugin');
  expect(FORBIDDEN.test(err.message.replace('missing-plugin', ''))).toBe(false);
});
