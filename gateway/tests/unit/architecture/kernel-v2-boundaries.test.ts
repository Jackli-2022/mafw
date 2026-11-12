import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const KERNEL_V2 = join(ROOT, 'src/kernel-v2');

function filesUnder(dir: string): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) out.push(match[1]);
  }
  return out;
}

const FORBIDDEN_ABSOLUTE = new Set(
  [
    'src/kernel.ts',
    'src/boot.ts',
    'src/http/transport.ts',
    'src/tts/registry.ts',
    'src/usage/plugin-loader.ts',
    'src/plugins/package-host.ts',
  ].map((p) => resolve(ROOT, p)),
);

describe('kernel-v2 boundaries', () => {
  test('kernel-v2 has at least one source file', () => {
    expect(filesUnder(KERNEL_V2).length).toBeGreaterThan(0);
  });

  test('kernel-v2 does not import v1 composition roots or provider registries', () => {
    const violations: string[] = [];
    for (const file of filesUnder(KERNEL_V2)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        if (!specifier.startsWith('.')) continue;
        const target = resolve(join(file, '..'), specifier);
        if (FORBIDDEN_ABSOLUTE.has(target)) {
          violations.push(`${relative(ROOT, file)} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('v1 entry files do not import kernel-v2', () => {
    for (const file of ['src/kernel.ts', 'src/boot.ts']) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      expect(source).not.toMatch(/kernel-v2/);
    }
  });
});
