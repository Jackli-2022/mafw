/**
 * Phase 4 W6 protocol guards (spec §9 Phase 4 G1–G4).
 *
 * G1: gateway/src has no runtime protocol names in string literals outside
 *     explicit binding/brand/legacy-tag allowlists.
 * G2: native envelope JSONPaths stay in the mapper/canonical reader.
 * G3: only the legacy plugin bridge may carry native-event bridge machinery.
 * G4: builtin registration comes from adapter descriptors.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { stripComments } from '../../../../packages/test-shim/comment-strip';
import { builtinAdapterRegistrations, DEFAULT_BUILTIN_RUNTIME } from '../../../src/runtime/builtin-adapters';
import { OPENCODE_REGISTRATIONS } from '../../../src/runtime/opencode-adapter';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'src');

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(file, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(file);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(SRC, file).replace(/\\/g, '/');
}

function code(file: string): string {
  return stripComments(fs.readFileSync(file, 'utf8')).code;
}

function stringLiterals(source: string, file = 'guard.ts'): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node)) out.push(node.text);
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}

/** G1 allowlist: adapter binding, brand/provider ids and legacy migration tags. */
const G1_ALLOWLIST = new Set([
  'runtime/opencode-adapter.ts',
  'runtime/pi-adapter.ts',
  'runtime/builtin-adapters.ts',
  'runtime/legacy-runtime-tags.ts',
  'runtime/event-flow-matrix.ts',
  'config.ts',
  'usage/types.ts',
  'routes/misc.ts',
  'core/langchain/agent-adapter.ts',
  'media/pi-adapter.ts',
  'core/cost/cognitive-router.ts',
  'core/discovery/merge.ts',
  'core/media/pi-models.ts',
  'media/media-service.ts',
  'media/media-plugin-loader.ts',
  'media/resolve-prompt.ts',
  'plugins/hub.ts',
  'plugins/package-host.ts',
  'plugins/package-types.ts',
  'routes/media-switch.ts',
  'trajectory/backfill-provider.ts',
  'usage/model-prices.ts',
  'usage/templates.ts',
]);

describe('Phase 4 protocol guards', () => {
  it('G1: no runtime protocol names in gateway/src string literals outside the allowlist', () => {
    const violations: string[] = [];
    let scanned = 0;
    for (const file of filesUnder(SRC)) {
      const r = rel(file);
      scanned += 1;
      if (G1_ALLOWLIST.has(r)) continue;
      for (const literal of stringLiterals(fs.readFileSync(file, 'utf8'), r)) {
        if (/^[.@]/.test(literal)) continue;
        if (/\b(?:opencode|claude)\b/i.test(literal) || /\bpi-(?:runtime|session|native)\b/.test(literal)) {
          violations.push(`${r}: ${literal.slice(0, 80)}`);
          break;
        }
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(violations).toEqual([]);
  });

  it('G2: native envelope JSONPaths stay in the mapper and canonical reader', () => {
    const allowed = new Set(['runtime/adapter-event-mapper.ts', 'runtime/neutral-runtime.ts']);
    const violations: string[] = [];
    for (const file of filesUnder(SRC)) {
      const r = rel(file);
      if (allowed.has(r)) continue;
      if (code(file).includes('$.payload.properties')) violations.push(r);
    }
    expect(violations).toEqual([]);
  });

  it('G3: only the legacy plugin bridge carries native-event bridge machinery', () => {
    const allowed = new Set(['runtime/legacy-plugin-bridge.ts', 'runtime/adapter-bridge.ts']);
    const violations: string[] = [];
    for (const file of filesUnder(SRC)) {
      const r = rel(file);
      if (allowed.has(r)) continue;
      const text = code(file);
      if (/\bnativeEvents\b|\bforwardNative\b|\bcanonicalToAdapterEvent\b/.test(text)) violations.push(r);
    }
    expect(violations).toEqual([]);

    const contract = fs.readFileSync(
      path.join(ROOT, '..', 'packages', 'runtime-contract', 'src', 'define-runtime.ts'),
      'utf8',
    );
    expect(contract).toContain("assert(!('native' in input)");
  });

  it('G4: builtin registrations come from adapter descriptors', () => {
    expect(OPENCODE_REGISTRATIONS.map((registration) => registration.name)).toEqual([
      'opencode',
      'opencode@v1',
      'opencode@v2',
      'opencode@v21',
    ]);
    const registrations = builtinAdapterRegistrations(false);
    expect(registrations).toHaveLength(OPENCODE_REGISTRATIONS.length);
    expect(DEFAULT_BUILTIN_RUNTIME).toBe(OPENCODE_REGISTRATIONS[0].name);
    for (const registration of registrations) {
      expect(registration.options.capabilities).toBeDefined();
      expect(registration.options.eventEntry).toBeDefined();
    }
    const boot = fs.readFileSync(path.join(SRC, 'boot.ts'), 'utf8');
    expect(boot).toContain('builtinAdapterRegistrations(external)');
    expect(boot).not.toMatch(/registerBuiltinDefinition\('(?:opencode|opencode@)/);
  });
});
