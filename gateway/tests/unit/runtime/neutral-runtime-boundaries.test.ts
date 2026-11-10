import * as fs from 'node:fs';
import * as path from 'node:path';
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
  // D3 Task 8: composition root = kernel.ts.
  const index = readCode(path.join(__dirname, '../../../src/kernel.ts'));
  expect(index).not.toMatch(/runtimeLoader\.registerBuiltin\s*\(/);
});

it('the composition root has no direct adapter fallback', () => {
  // D3 Task 8: composition root = kernel.ts.
  const index = readCode(path.join(__dirname, '../../../src/kernel.ts'));
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
