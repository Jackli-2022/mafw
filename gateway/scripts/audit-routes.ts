/**
 * 反向全扫诊断（一次性工具）：gateway 源码路由面 vs route-catalog 登记。
 * 找出"源码有 matcher 但 catalog 未登记"的漏网路由。
 * 运行：npx ts-node --project tsconfig.json scripts/__audit-routes.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { RouteRegistry, toOpenApiPath } from '../src/routes/registry';
import { buildRouteCatalog } from '../src/routes/route-catalog';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const src = walk(path.join(__dirname, '..', 'src')).map((f) => fs.readFileSync(f, 'utf-8')).join('\n');

// 归一化辅助：捕获组/参数段 → {}
const norm = (p: string) => toOpenApiPath(p).replace(/\{[^}]+\}/g, '{}');

// 源码面：=== 字面量 / startsWith 前缀 / /^...$/ 正则（与 api-contract.test 同法）
const exact = new Set<string>();
const prefix = new Set<string>();
const regexRoutes = new Set<string>();
for (const m of src.matchAll(/\b(?:req\.)?url\s*===\s*['"](\/[^'"]+)['"]/g)) exact.add(m[1]);
for (const m of src.matchAll(/\.startsWith\(\s*['"](\/[^'"]+)['"]\s*\)/g)) prefix.add(m[1]);
for (let i = 0; i < src.length - 2; i++) {
  if (src[i] === '/' && src[i + 1] === '^') {
    let j = i + 1, inBracket = false, escaped = false;
    for (; j < src.length; j++) {
      const c = src[j];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (inBracket) { if (c === ']') inBracket = false; continue; }
      if (c === '[') { inBracket = true; continue; }
      if (c === '/') break;
    }
    let body = src.slice(i + 1, j).replace(/\\(.)/g, '$1').replace(/^\^/, '').replace(/\$$/, '');
    body = body.replace(/\(\?:[^)]*\)/g, '').replace(/\(([^()]*)\)/g, '{}');
    if (body.startsWith('/') && !/[^a-zA-Z0-9\/\-_.:{}]/.test(body)) regexRoutes.add(body);
    i = j;
  }
}

const registry = new RouteRegistry().register(...buildRouteCatalog());
const catalogPaths = new Set(registry.list().map((d) => norm(d.path)));

const missing: string[] = [];
for (const e of exact) if (!catalogPaths.has(norm(e))) missing.push('exact: ' + e);
for (const p of prefix) if (!catalogPaths.has(norm(p))) missing.push('prefix: ' + p);
for (const r of regexRoutes) if (!catalogPaths.has(r)) missing.push('regex: ' + r);

console.log('catalog paths:', catalogPaths.size);
console.log('源码有而 catalog 未登记（前缀类可能为委托兜底，人工甄别）:');
for (const m of missing.sort()) console.log('  ' + m);
