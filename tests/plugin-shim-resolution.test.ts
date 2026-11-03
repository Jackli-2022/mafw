/**
 * Dev-loop shim resolution test — `.opencode/plugins/mafw-plugin.ts`.
 *
 * Root cause these tests pin: OpenCode v2.2.5+ loads `.opencode/plugins/*`
 * natively and resolves plugin imports FILE-RELATIVE (Bun ResolveMessage).
 * The shim re-exported `'../src/plugin'`, which from `.opencode/plugins/`
 * resolves to `.opencode/src/plugin` (nonexistent); the server failed every
 * load with
 * `Cannot find module '../src/plugin' imported from ...mafw-plugin.ts`
 * (server log ref err_0d1a5d0f, 2026-11-03) and silently fell back to the
 * globally installed plugin — breaking the documented dev loop (edits under
 * src/ stopped taking effect after `mafw restart-agent`). The correct
 * specifier is `'../../src/plugin'` = `<repo>/src/plugin.ts`.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const SHIM_PATH = path.join(REPO_ROOT, '.opencode', 'plugins', 'mafw-plugin.ts');

function shimSpecifier(): string {
  const content = fs.readFileSync(SHIM_PATH, 'utf8');
  const match = content.match(
    /export\s*\{[^}]*default[^}]*\}\s*from\s*['"]([^'"]+)['"]/,
  );
  if (!match) {
    throw new Error(
      'mafw-plugin.ts shim must default-re-export from a module specifier',
    );
  }
  return match[1];
}

// File-relative resolution the OpenCode (Bun) loader performs, minus extension.
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.js'];

function resolvesToExistingFile(fromDir: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(fromDir, spec);
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return null;
}

describe('dev-loop shim (.opencode/plugins/mafw-plugin.ts)', () => {
  test('shim exists in the repo', () => {
    expect(fs.existsSync(SHIM_PATH)).toBe(true);
  });

  test("shim import resolves file-relative to the repo's plugin source (src/plugin.ts)", () => {
    const spec = shimSpecifier();
    const resolved = resolvesToExistingFile(path.dirname(SHIM_PATH), spec);
    // Dev-loop contract: the shim loads the repo SOURCE (v2 plugin API entry),
    // not the built dist — otherwise src/ edits silently stop taking effect.
    expect(resolved).toBe(path.join(REPO_ROOT, 'src', 'plugin.ts'));
  });
});
