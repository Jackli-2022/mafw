/**
 * Bundle the pi adapter as a CJS entry for the gateway (like adapters/claude).
 *
 * The pi SDK and the neutral contract packages stay external: the gateway
 * resolves them from its own node_modules, and the adapter must not carry a
 * second copy of the contract.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
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
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-coding-agent/node_modules/typebox',
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
    "import type { RuntimeCapabilities, RuntimeDefinition, RuntimeFactoryContext } from '@mafw/runtime-contract';",
    'export declare const PI_CAPABILITIES: RuntimeCapabilities;',
    'export declare function createPiDefinition(ctx: RuntimeFactoryContext, deps?: unknown): Promise<RuntimeDefinition>;',
    'export declare function setPiUnknownRecorder(fn: ((type: string) => void) | undefined): void;',
    '',
  ].join('\n'),
);
console.log(`dist/index.js written (${(bytes / 1024).toFixed(0)} KB)`);
