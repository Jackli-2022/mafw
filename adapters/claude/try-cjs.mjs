import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const tmp = mkdtempSync(join(tmpdir(), 'claude-cjs-try-'));
const out = join(tmp, 'claude.js');
await build({
  entryPoints: ['src/index.ts'],
  bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  outfile: out, sourcemap: false, logLevel: 'silent',
  define: { 'import.meta.url': '__filename' },
});
writeFileSync(join(tmp, 'run.js'), "const p = require('./claude.js'); console.log('cjs-define loaded:', p.name, typeof p.createRuntime, p.eventMappings.length);");
console.log('TMP=' + tmp);
