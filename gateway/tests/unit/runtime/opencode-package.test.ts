/**
 * Task 4 — packaging contract for the opencode driver package.
 *
 * The opencode driver is moving out of `gateway/src` into its own private
 * workspace package (`adapters/opencode`). This suite pins the packaging
 * contract the extraction depends on:
 *
 *  - the package is private, ESM-authored and ships a CJS entry (`dist/index.js`)
 *    plus typings (`dist/index.d.ts`);
 *  - the built entry exports the placeholder surface the gateway shim and the
 *    later driver modules build on;
 *  - `@opencode-ai/sdk` (including `/v2`) and the neutral contract packages stay
 *    external so the gateway keeps exactly one copy of the contract;
 *  - the dynamic `import('@opencode-ai/sdk/v2')` survives as a real `import(...)`
 *    in the CJS bundle — the SDK's `/v2` subpath is ESM-only and a `require()`
 *    rewrite would throw `ERR_REQUIRE_ESM` on the gateway;
 *  - `jsonc-parser` and `cross-spawn` are bundled dependencies, not externals.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PACKAGING_SUITE_TIMEOUT_MS, ensureAdapterBuilt } from '../../helpers/adapter-build';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ADAPTER_DIR = path.join(REPO_ROOT, 'adapters', 'opencode');
const DIST_DIR = path.join(ADAPTER_DIR, 'dist');
const DIST_ENTRY = path.join(DIST_DIR, 'index.js');
const DIST_TYPES = path.join(DIST_DIR, 'index.d.ts');

function readJson<T = any>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

// These assertions read the *built* bundle while Jest resolves the package to
// its TypeScript source, so a clean checkout has no `dist/`. Build on demand
// (skipped when dist is fresh) instead of requiring a prior root build.
beforeAll(() => {
  ensureAdapterBuilt();
}, PACKAGING_SUITE_TIMEOUT_MS);

/**
 * Loads the built bundle the way the gateway does — plain `require()` in a child
 * Node process — instead of through Jest's TypeScript transform.
 */
function loadBuiltEntry(entry: string): Record<string, unknown> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-adapter-opencode-'));
  const probe = path.join(dir, 'probe.cjs');
  fs.writeFileSync(
    probe,
    `const adapter = require(process.argv[2]);
const names = [
  'createOpencodeDefinition',
  'createOpencodeRuntime',
  'createOpencodeAdapter',
  'opencodeStaticEntry',
  'opencodeCapabilities',
  'resolveOpencodeEntry',
  'thinkingVariantForLevel',
  'decodeOpencodePtyChunk',
  'getBridgeEventEntry',
  'setBridgeEventEntry',
  'getProviderApiKey',
  'startServeSidecar',
];
console.log(JSON.stringify({
  packageName: adapter.ADAPTER_PACKAGE_NAME,
  runtimeName: adapter.OPENCODE_RUNTIME_NAME,
  variants: adapter.OPENCODE_VARIANTS,
  eventApiVersion: adapter.ADAPTER_EVENT_API_VERSION,
  loader: typeof adapter.loadOpencodeSdkV2,
  surface: Object.fromEntries(names.map((name) => [name, typeof adapter[name]])),
}));
`,
  );
  try {
    const result = spawnSync(process.execPath, [probe, entry], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`require('${entry}') failed: ${result.stderr || result.stdout}`);
    }
    return JSON.parse(result.stdout) as Record<string, unknown>;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('@mafw/adapter-opencode package skeleton', () => {
  it('is a private CJS package with gateway-facing entry points', () => {
    const pkg = readJson(path.join(ADAPTER_DIR, 'package.json'));
    expect(pkg.name).toBe('@mafw/adapter-opencode');
    expect(pkg.private).toBe(true);
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.types).toBe('dist/index.d.ts');
    expect(pkg.scripts?.build).toBe('node build.mjs');
    // The neutral contract packages are shared with the gateway, never copied.
    expect(pkg.dependencies?.['@mafw/runtime-contract']).toBe('*');
    expect(pkg.dependencies?.['@mafw/runtime-core']).toBe('*');
    // Bundled dependencies must be declared so the build can resolve them.
    expect(pkg.dependencies?.['jsonc-parser']).toBeDefined();
    expect(pkg.dependencies?.['cross-spawn']).toBeDefined();
  });

  it('builds dist/index.js with the driver exports and CJS typings', () => {
    expect(fs.existsSync(DIST_ENTRY)).toBe(true);
    expect(fs.existsSync(DIST_TYPES)).toBe(true);
    expect(readJson(path.join(DIST_DIR, 'package.json')).type).toBe('commonjs');

    const adapter = loadBuiltEntry(DIST_ENTRY);
    expect(adapter.packageName).toBe('@mafw/adapter-opencode');
    expect(adapter.runtimeName).toBe('opencode');
    expect(adapter.variants).toEqual(['adaptive', 'v1', 'v2', 'v21']);
    expect(typeof adapter.eventApiVersion).toBe('number');
    expect(adapter.loader).toBe('function');
    // Real driver surface (not just package identity placeholders): the built
    // bundle must expose the runtime/definition assembly the gateway shim loads.
    expect(adapter.surface).toEqual({
      createOpencodeDefinition: 'function',
      createOpencodeRuntime: 'function',
      createOpencodeAdapter: 'function',
      opencodeStaticEntry: 'function',
      opencodeCapabilities: 'function',
      resolveOpencodeEntry: 'function',
      thinkingVariantForLevel: 'function',
      decodeOpencodePtyChunk: 'function',
      getBridgeEventEntry: 'function',
      setBridgeEventEntry: 'function',
      getProviderApiKey: 'function',
      startServeSidecar: 'function',
    });

    // Declarations are emitted per module and `index.d.ts` re-exports them, so
    // scan the emitted declaration set (real tsc output, not a hand-written
    // list) instead of only the barrel file.
    const types = fs.readdirSync(DIST_DIR)
      .filter((name) => name.endsWith('.d.ts'))
      .map((name) => fs.readFileSync(path.join(DIST_DIR, name), 'utf8'))
      .join('\n');
    for (const symbol of [
      'ADAPTER_PACKAGE_NAME',
      'OPENCODE_RUNTIME_NAME',
      'OPENCODE_VARIANTS',
      'ADAPTER_EVENT_API_VERSION',
      'loadOpencodeSdkV2',
      'createOpencodeDefinition',
      'createOpencodeRuntime',
      'createOpencodeAdapter',
      'opencodeStaticEntry',
      'opencodeCapabilities',
      'resolveOpencodeEntry',
      'thinkingVariantForLevel',
      'decodeOpencodePtyChunk',
      'getBridgeEventEntry',
      'setBridgeEventEntry',
      'getProviderApiKey',
      'startServeSidecar',
    ]) {
      expect(types).toContain(symbol);
    }
  });

  it('keeps the dynamic @opencode-ai/sdk/v2 import as import(...)', () => {
    const text = fs.readFileSync(DIST_ENTRY, 'utf8');
    // ESM-only subpath: `import()` is the only loader the gateway may use.
    expect(text).toMatch(/import\(\s*["']@opencode-ai\/sdk\/v2["']\s*\)/);
    expect(text).not.toMatch(/require\(\s*["']@opencode-ai\/sdk\/v2["']\s*\)/);
    // The adapter never reaches back into the gateway source tree.
    expect(text).not.toContain('gateway/src');
  });

  it('declares the SDK and neutral contracts external, bundles the rest', () => {
    const buildScript = fs.readFileSync(path.join(ADAPTER_DIR, 'build.mjs'), 'utf8');
    const externals = /external:\s*\[([\s\S]*?)\]/.exec(buildScript)?.[1];
    expect(externals).toBeDefined();

    for (const specifier of [
      '@opencode-ai/sdk',
      '@opencode-ai/sdk/v2',
      '@mafw/runtime-contract',
      '@mafw/runtime-core',
    ]) {
      expect(externals).toContain(`'${specifier}'`);
    }
    for (const bundled of ['jsonc-parser', 'cross-spawn']) {
      expect(externals).not.toContain(`'${bundled}'`);
    }
    expect(buildScript).toContain('dist/package.json');
  });
});
