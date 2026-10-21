/**
 * 依赖边界守卫（Plan 3 Task 7 / 设计 §3.6）——
 * ① gateway/src 中 runtime/ 之外禁 import 两 SDK（@opencode-ai/sdk、
 *    @earendil-works/pi-coding-agent）
 * ② runtime/auth.ts（opencode 凭据源）仅允许 runtime/** 与 index.ts（单点接线）
 *    import
 * 违例即红：防止解耦被悄悄腐蚀（spec 反目标）。
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

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

function importLineMatches(line: string, pkg: string): boolean {
  return line.includes(`'${pkg}`) || line.includes(`"${pkg}`) || line.includes('`' + pkg);
}

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
      const content = readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('import') && !trimmed.includes('require(') && !trimmed.includes('import(')) continue;
        for (const pkg of FORBIDDEN_SDKS) {
          if (importLineMatches(trimmed, pkg)) violations.push(`${rel}: ${trimmed}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('runtime/auth.ts 仅 runtime/** 与 index.ts import（单点接线）', () => {
    // walk 扫描代替 git grep（测试沙箱内 git 可能受限）
    const importers: string[] = [];
    for (const file of walk(SRC)) {
      const rel = 'src/' + file.replace(SRC, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
      if (!readFileSync(file, 'utf8').includes('runtime/auth')) continue;
      importers.push(rel);
    }
    const allowed = (f: string) => f.startsWith('src/runtime/') || f === 'src/index.ts';
    const violations = importers.filter((f) => !allowed(f));
    expect(violations).toEqual([]);
  });
});
