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
    'src/voice/registry.ts',
    'src/media/media-plugin-loader.ts',
    'src/commands/custom-exec.ts',
    'src/runtime/event-dispatch.ts',
    'src/runtime/mafw-tools.ts',
    'src/server/event-hub.ts',
    'src/event-bus.ts',
    'src/mcp/tool-registry.ts',
    'src/mcp/tools.ts',
  ].map((p) => resolve(ROOT, p)),
);

const PROVIDERS_DIR = join(KERNEL_V2, 'providers');
const PROBES_DIR = join(KERNEL_V2, 'probes');
const COMPOSITION_ENTRIES = new Set(['main.ts', 'facade.ts']);

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

  test('v1 entry files do not import kernel-v2 directly', () => {
    for (const file of ['src/kernel.ts', 'src/boot.ts']) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      const direct = importSpecifiers(source).filter((specifier) =>
        specifier.includes('kernel-v2'),
      );
      expect(direct).toEqual([]);
    }
  });

  test('kernel-v2 core files do not import providers or probes', () => {
    const violations: string[] = [];
    for (const file of filesUnder(KERNEL_V2)) {
      const rel = relative(KERNEL_V2, file).replace(/\\/g, '/');
      if (COMPOSITION_ENTRIES.has(rel)) continue;
      if (rel.startsWith('providers/') || rel.startsWith('probes/')) continue;
      const source = readFileSync(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        if (!specifier.startsWith('.')) continue;
        const target = resolve(join(file, '..'), specifier);
        if (target.startsWith(PROVIDERS_DIR) || target.startsWith(PROBES_DIR)) {
          violations.push(`${rel} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('only runtime/v2-live.ts imports kernel-v2 from live code', () => {
    const src = resolve(ROOT, 'src');
    const bridge = resolve(src, 'runtime/v2-live.ts');
    const violations: string[] = [];
    for (const file of filesUnder(src)) {
      if (file.startsWith(KERNEL_V2) || file === bridge) continue;
      const source = readFileSync(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        if (specifier.includes('kernel-v2')) {
          violations.push(`${relative(ROOT, file)} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('isolated entrypoint has no ambient home or network access', () => {
    const main = readFileSync(resolve(KERNEL_V2, 'main.ts'), 'utf8');
    const facade = readFileSync(resolve(KERNEL_V2, 'facade.ts'), 'utf8');
    expect(main).not.toMatch(/from ['"]node:os['"]/);
    expect(main).not.toMatch(/\bfetch\s*\(/);
    expect(facade).not.toMatch(/\bfetch\s*\(/);
  });
});
