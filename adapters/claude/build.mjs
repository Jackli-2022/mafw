/**
 * esbuild 打包：单文件 CJS（dist/claude.js）。
 *
 * define：`import.meta.url` → `__filename`——SDK 模块初始化做
 * createRequire(import.meta.url)（定位自身/可选依赖），CJS 打包下
 * import.meta 为空对象会碎；__filename 在 CJS 天然存在且语义等价。
 * claude CLI 与登录是环境前置（SDK spawn CLI，二进制不可打包）。
 * 用法：node build.mjs（或 npm run build）
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

mkdirSync(resolve(here, 'dist'), { recursive: true });

const result = await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: resolve(here, 'dist/claude.js'),
  sourcemap: false,
  logLevel: 'info',
  metafile: true,
  define: { 'import.meta.url': '__filename' },
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`dist/claude.js written (${(bytes / 1024).toFixed(0)} KB)`);
