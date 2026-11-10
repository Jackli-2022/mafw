/**
 * 依赖边界守卫（Plan 3 Task 7 / 设计 §3.6）——
 * ① gateway/src 中 runtime/ 之外禁 import 两 SDK（@opencode-ai/sdk、
 *    @earendil-works/pi-coding-agent）
 * ② 业务目录（routes/core/media/trajectory/usage）禁 import adapter 实现与
 *    `@mafw/adapter-*` / `adapters/` 包；opencode 驱动只经
 *    `runtime/opencode-adapter.ts` 单一入口
 * 违例即红：防止解耦被悄悄腐蚀（spec 反目标）。
 *
 * 扫描用共享的 `import-scan.ts`（整段文本收集 specifier）：多行 import 与
 * `export * from` 不会因为 specifier 不在 `import` 同一行而漏判。
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { scanModuleSpecifiers } from './import-scan';

const SRC = join(__dirname, '..', '..', '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    let stat: ReturnType<typeof statSync>;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FORBIDDEN_SDKS = ['@opencode-ai/sdk', '@earendil-works/pi-coding-agent'];

describe('依赖边界守卫（runtime/ 之外零 SDK import）', () => {
  const files = walk(SRC).filter((f) => !f.replace(/\\/g, '/').includes('/src/runtime/'));

  it('扫面非空（守卫自身有效）', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.replace(/\\/g, '/').endsWith('src/index.ts'))).toBe(true);
  });

  it('非 runtime 文件零 SDK import（@opencode-ai/sdk / @earendil-works/pi-coding-agent）', () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = file.replace(SRC, '').replace(/^[\\/]/, '');
      for (const entry of scanModuleSpecifiers(readFileSync(file, 'utf8'))) {
        for (const pkg of FORBIDDEN_SDKS) {
          if (entry.specifier === pkg || entry.specifier.startsWith(`${pkg}/`)) {
            violations.push(`${rel}:${entry.line}: ${entry.snippet}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('opencode 凭据读取只经包 shim（旧 runtime/auth 接线已删除）', () => {
    // walk 扫描代替 git grep（测试沙箱内 git 可能受限）
    const movedReader: string[] = [];
    for (const file of walk(SRC)) {
      const rel = 'src/' + file.replace(SRC, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
      if (readFileSync(file, 'utf8').includes('runtime/auth')) movedReader.push(rel);
    }
    expect(movedReader).toEqual([]);
    // 唯一的凭据兜底仍走包 shim（Task 7 删除 re-export shim 后单点接线保持）。
    const credentials = readFileSync(join(SRC, 'runtime', 'plugin-credentials.ts'), 'utf8');
    expect(credentials).toContain("from './opencode-adapter'");
  });

  it('业务目录不 import adapter 实现（runtime 私有布局/原生 SDK 只属于 adapter）', () => {
    const BUSINESS_DIRS = ['src/routes/', 'src/core/', 'src/media/', 'src/trajectory/'];
    const ADAPTER_MODULES = [
      'opencode-runtime', 'opencode-adapter', 'opencode-snapshot', 'opencode-mcp',
      'opencode-mcp-config', 'plugins/pi-runtime', 'pi-runtime', 'pi-session',
      'pi-adapter', 'pi-events', 'pi-approval', 'claude',
    ];
    let businessFiles = 0;
    let scanned = 0;
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const rel = 'src/' + file.replace(SRC, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
      if (!BUSINESS_DIRS.some((dir) => rel.startsWith(dir))) continue;
      businessFiles++;
      for (const entry of scanModuleSpecifiers(readFileSync(file, 'utf8'))) {
        scanned++;
        if (!entry.specifier.includes('runtime/')) continue;
        for (const mod of ADAPTER_MODULES) {
          if (entry.specifier.includes(mod)) violations.push(`${rel}:${entry.line}: ${entry.snippet}`);
        }
      }
    }
    expect(violations).toEqual([]);
    expect(businessFiles).toBeGreaterThan(20);
    expect(scanned).toBeGreaterThan(50);
  });

  it('业务目录不 import adapter 包（opencode 只经 runtime/opencode-adapter.ts 单一入口）', () => {
    const BUSINESS_DIRS = ['src/routes/', 'src/core/', 'src/media/', 'src/trajectory/', 'src/usage/'];
    let businessFiles = 0;
    let scanned = 0;
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const rel = 'src/' + file.replace(SRC, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
      if (!BUSINESS_DIRS.some((dir) => rel.startsWith(dir))) continue;
      businessFiles++;
      for (const entry of scanModuleSpecifiers(readFileSync(file, 'utf8'))) {
        scanned++;
        if (entry.specifier.includes('@mafw/adapter-') || entry.specifier.includes('adapters/')) {
          violations.push(`${rel}:${entry.line}: ${entry.snippet}`);
        }
      }
    }
    expect(violations).toEqual([]);
    // 扫描面非空：业务目录确实被扫到、确实有 import（否则整段断言假绿）。
    expect(businessFiles).toBeGreaterThan(20);
    expect(scanned).toBeGreaterThan(50);
  });
});
