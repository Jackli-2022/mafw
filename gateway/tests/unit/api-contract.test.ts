/**
 * P4 契约防线（gateway 侧）：spec 事实源已收敛到 routes/route-catalog.ts，本测试守两条：
 *
 * A. phantom 检查 —— catalog 每条路由必须在 gateway 源码的路由面上有落地
 *    （=== 字面量 / startsWith 前缀 / /^...$/ 正则三种匹配器，路径参数归一化为 {}），
 *    防 catalog 登记了实际不存在的端点。
 * B. 新鲜度 —— contract/openapi.json 的 paths/operationId 必须与 catalog 重新生成的
 *    结果一致，防 catalog 改了忘跑 emit:openapi（陈旧产物）。
 *
 * 用法：npx jest tests/unit/api-contract.test.ts
 * 新增 gateway 路由：登记进 route-catalog.ts → npm run emit:openapi → (sdk) npm run gen:api。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { RouteRegistry, toOpenApiPath } from '../../src/routes/registry';
import { buildRouteCatalog } from '../../src/routes/route-catalog';

const CONTRACT_PATH = join(__dirname, '..', '..', '..', 'packages', 'gateway-sdk', 'contract', 'openapi.json');
const GATEWAY_SRC = join(__dirname, '..', '..', 'src');

const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
const registry = new RouteRegistry().register(...buildRouteCatalog());

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

// ── gateway 源码路由面采集 ──

const exactRoutes = new Set<string>();
const prefixRoutes = new Set<string>();
const regexRoutes = new Set<string>();

/** 正则体 → 归一化路径：\/→/、去锚点、去非捕获组、捕获组→{}。 */
function normalizeRegexBody(body: string): string | null {
  let s = body.replace(/\\(.)/g, '$1');
  s = s.replace(/^\^/, '').replace(/\$$/, '');
  s = s.replace(/\(\?:[^)]*\)/g, '');
  s = s.replace(/\(([^()]*)\)/g, '{}');
  if (!s.startsWith('/')) return null;
  if (/[^a-zA-Z0-9\/\-_.:{}]/.test(s)) return null;
  return s;
}

/** 扫描 /^ 开头的正则字面量体（括号/字符类感知的定界符扫描）。 */
function extractRegexBodies(src: string): string[] {
  const bodies: string[] = [];
  for (let i = 0; i < src.length - 2; i++) {
    if (src[i] === '/' && src[i + 1] === '^') {
      let j = i + 1;
      let inBracket = false;
      let escaped = false;
      for (; j < src.length; j++) {
        const c = src[j];
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (inBracket) { if (c === ']') inBracket = false; continue; }
        if (c === '[') { inBracket = true; continue; }
        if (c === '/') break;
      }
      bodies.push(src.slice(i + 1, j));
      i = j;
    }
  }
  return bodies;
}

beforeAll(() => {
  for (const file of walk(GATEWAY_SRC)) {
    const src = readFileSync(file, 'utf-8');
    for (const m of src.matchAll(/\b(?:req\.)?url\s*===\s*['"](\/[^'"]+)['"]/g)) exactRoutes.add(m[1]);
    for (const m of src.matchAll(/\.startsWith\(\s*['"](\/[^'"]+)['"]\s*\)/g)) prefixRoutes.add(m[1]);
    for (const body of extractRegexBodies(src)) {
      const norm = normalizeRegexBody(body);
      if (norm) regexRoutes.add(norm);
    }
  }
});

/**
 * 由 index.ts 末尾的反代兜底（"Reverse proxy to the agent backend for non-MAFW routes"）
 * 服务的契约路径——无独立路由匹配器，透传 opencode serve。
 */
const REVERSE_PROXY_PATHS = new Set(['/command', '/skill']);

/** 归一化路径是否被源码路由面覆盖。 */
function isCovered(normPath: string): boolean {
  if (exactRoutes.has(normPath) || regexRoutes.has(normPath)) return true;
  if (REVERSE_PROXY_PATHS.has(normPath)) return true;
  for (const p of prefixRoutes) {
    if (normPath === p || normPath.startsWith(p.endsWith('/') ? p : p + '/')) return true;
  }
  return false;
}

describe('api-contract: catalog phantom 检查', () => {
  test('catalog 每条路由在 gateway 源码有落地', () => {
    const phantom: string[] = [];
    for (const def of registry.list()) {
      const normPath = toOpenApiPath(def.path).replace(/\{[^}]+\}/g, '{}');
      if (!isCovered(normPath)) phantom.push(`${def.method} ${normPath} (${def.operationId})`);
    }
    if (phantom.length) console.error('[api-contract] catalog 幻影路由:\n' + phantom.join('\n'));
    expect(phantom).toEqual([]);
  });

  test('本次两个漂移 bug 的回归锚点（catalog 内）', () => {
    const ids = new Set(registry.list().map((d) => d.operationId));
    expect(ids.has('triage.dismiss')).toBe(true);
    expect(ids.has('goals.control')).toBe(true);
    expect(ids.has('goals.respondQuestion')).toBe(true);
  });
});

describe('api-contract: contract 产物新鲜度', () => {
  test('openapi.json paths/operationId ≡ catalog 当前生成结果', () => {
    const expected = registry.toOpenApiPaths();
    const contractPaths = contract.paths as Record<string, any>;
    const missing = Object.keys(expected).filter((p) => !(p in contractPaths));
    const extra = Object.keys(contractPaths).filter((p) => !(p in expected));
    const idDrift: string[] = [];
    for (const [p, methods] of Object.entries<any>(expected)) {
      const cp = contractPaths[p];
      if (!cp) continue;
      for (const [m, op] of Object.entries<any>(methods)) {
        if (!cp[m]) { idDrift.push(`${m.toUpperCase()} ${p} 缺失`); continue; }
        if (cp[m].operationId !== op.operationId) idDrift.push(`${m.toUpperCase()} ${p}: ${cp[m].operationId} ≠ ${op.operationId}`);
      }
    }
    const problems = [...missing.map((p) => `contract 缺 path ${p}`), ...extra.map((p) => `contract 多 path ${p}`), ...idDrift];
    if (problems.length) {
      console.error('[api-contract] 契约产物过期 —— 先跑: (gateway) npm run emit:openapi && (sdk) npm run gen:api\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });
});
