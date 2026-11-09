import * as fs from 'node:fs';
import * as path from 'node:path';
import { stripComments } from '../../../../packages/test-shim/comment-strip';

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

it('missing-surface errors stay runtime-neutral', () => {
  const access = readCode(path.join(__dirname, '../../../src/runtime/runtime-access.ts'));
  expect(FORBIDDEN.test(access)).toBe(false);
});
