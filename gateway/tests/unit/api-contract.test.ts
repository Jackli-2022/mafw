/**
 * P1 契约漂移防线（gateway 侧）：contract/openapi.json 的每条 SDK-facing
 * operation 必须在 gateway/src 源码中有路由落地（=== 字面量 / startsWith 前缀 /
 * /^...$/ 正则三种匹配器，路径参数归一化为 {}）。
 *
 * 用法：npx jest tests/unit/api-contract.test.ts
 * 删改 gateway 路由前先更新 contract（SDK 侧测试同步红），否则本测试红。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const CONTRACT_PATH = join(__dirname, '..', '..', '..', 'packages', 'gateway-sdk', 'contract', 'openapi.json');
const GATEWAY_SRC = join(__dirname, '..', '..', 'src');

const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));

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

// ── gateway 路由面采集 ──

const exactRoutes = new Set<string>();
const prefixRoutes = new Set<string>();
const regexRoutes = new Set<string>();

/** 正则体 → 归一化路径：\/→/、去锚点、去非捕获组、捕获组→{}。 */
function normalizeRegexBody(body: string): string | null {
  let s = body.replace(/\\(.)/g, '$1'); // \/ → /, \. → ., \- → -
  s = s.replace(/^\^/, '').replace(/\$$/, '');
  s = s.replace(/\(\?:[^)]*\)/g, ''); // 非捕获组（(?:\?|$) 等）剥离
  s = s.replace(/\(([^()]*)\)/g, '{}'); // 捕获组 → {}
  if (!s.startsWith('/')) return null;
  if (/[^a-zA-Z0-9\/\-_.:{}]/.test(s)) return null; // 仍含量词/字符类 → 不是纯路径形状
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
 * 由 index.ts 末尾的反代兜底（"Reverse proxy to the agent backend for non-MAFW routes"，
 * ~5117 行）服务的契约路径——无独立路由匹配器，透传 opencode serve。
 */
const REVERSE_PROXY_PATHS = new Set(['/command', '/skill']);

/** contract 路径是否被 gateway 路由面覆盖。 */
function isCovered(normPath: string): boolean {
  if (exactRoutes.has(normPath) || regexRoutes.has(normPath)) return true;
  if (REVERSE_PROXY_PATHS.has(normPath)) return true;
  for (const p of prefixRoutes) {
    if (normPath === p || normPath.startsWith(p.endsWith('/') ? p : p + '/')) return true;
  }
  return false;
}

describe('api-contract: gateway 路由落地', () => {
  const missing: string[] = [];

  test('每条 contract operation 都有 gateway 路由', () => {
    for (const [path, methods] of Object.entries<any>(contract.paths)) {
      const normPath = path.replace(/\{[^}]+\}/g, '{}');
      if (!isCovered(normPath)) missing.push(`${Object.keys(methods).map((m) => m.toUpperCase()).join('/')} ${normPath}`);
    }
    if (missing.length) console.error('[api-contract] 未落地的契约路径:\n' + missing.join('\n'));
    expect(missing).toEqual([]);
  });

  test('本次两个漂移 bug 的回归锚点', () => {
    expect(exactRoutes.has('/api/goals/control')).toBe(true);
    expect(regexRoutes.has('/api/triage/{}/dismiss')).toBe(true);
    expect(regexRoutes.has('/api/triage/{}/confirm')).toBe(true);
    expect(regexRoutes.has('/api/triage/{}/reject')).toBe(true);
  });
});
