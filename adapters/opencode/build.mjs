/**
 * Bundle `@mafw/adapter-opencode` as a CJS entry for the gateway (like
 * `adapters/pi` and `adapters/claude`).
 *
 * The opencode SDK is ESM-only and the neutral contract packages are shared with
 * the gateway, so all three stay external: the gateway resolves them from its own
 * node_modules and the adapter must not carry a second copy of the contract. The
 * package is staged into `gateway/node_modules/@mafw/adapter-opencode` (root
 * postinstall, deploy-local and the Desktop bundle) so that the entry's own
 * `@opencode-ai/sdk` import resolves next to the gateway's copy.
 *
 * `jsonc-parser` (opencode.jsonc writer) and `cross-spawn` (Windows `.cmd` shim
 * resolution for the serve sidecar) are bundled: they must not depend on the
 * gateway's install layout.
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(here, 'dist/index.js');

mkdirSync(resolve(here, 'dist'), { recursive: true });

const result = await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile,
  sourcemap: false,
  logLevel: 'info',
  metafile: true,
  external: [
    '@opencode-ai/sdk',
    '@opencode-ai/sdk/v2',
    '@mafw/runtime-contract',
    '@mafw/runtime-core',
  ],
  define: { 'import.meta.url': '__filename' },
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;

// The package root is ESM; pin the bundle to CommonJS for require().
writeFileSync(resolve(here, 'dist/package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
writeFileSync(
  resolve(here, 'dist/index.d.ts'),
  [
    "export declare const ADAPTER_PACKAGE_NAME: '@mafw/adapter-opencode';",
    "export declare const OPENCODE_RUNTIME_NAME: 'opencode';",
    "export type OpencodeVariant = 'adaptive' | 'v1' | 'v2' | 'v21';",
    'export declare const OPENCODE_VARIANTS: readonly OpencodeVariant[];',
    'export declare const ADAPTER_EVENT_API_VERSION: number;',
    'export declare function loadOpencodeSdkV2(): Promise<unknown>;',
    '',
  ].join('\n'),
);

// `@opencode-ai/sdk/v2` is an ESM-only subpath: the bundle must keep a real
// `import()` there. A `require()` rewrite would throw ERR_REQUIRE_ESM at
// runtime, so fail the build instead of shipping a broken loader.
const bundle = readFileSync(outfile, 'utf8');
if (!/import\(\s*["']@opencode-ai\/sdk\/v2["']\s*\)/.test(bundle)) {
  throw new Error('dist/index.js lost the dynamic import() of @opencode-ai/sdk/v2');
}

console.log(`dist/index.js written (${(bytes / 1024).toFixed(0)} KB)`);
