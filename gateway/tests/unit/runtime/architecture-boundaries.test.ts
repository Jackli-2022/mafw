import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();

function scanSource(text: string, forbidden: string[]): string[] {
  // 注释里的术语不算违规（文档需要解释被替换掉的旧能力位）；代码行内出现才算。
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return forbidden.filter((token) => code.includes(token));
}

function violations(file: string, forbidden: string[]): string[] {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return scanSource(text, forbidden).map((token) => `${file}: ${token}`);
}

describe('runtime isolation architecture boundaries', () => {
  it('scan itself catches a synthetic raw bypass fixture', () => {
    const fixture = "const rt = deps.runtime(); if (rt.name === 'pi') { rt.global.event(); }";
    expect(scanSource(fixture, ['rt.name', 'global.event'])).toEqual(['rt.name', 'global.event']);
  });

  it('business routes do not interpret runtime names or raw capabilities', () => {
    const root = path.join(ROOT, 'src', 'routes');
    const exceptions = new Set(['runtime-switch.ts', 'conformance.ts']);
    const files = fs.readdirSync(root)
      .filter((f) => f.endsWith('.ts') && !exceptions.has(f))
      .map((f) => `src/routes/${f}`);
    const bad = [
      'runtime.name', 'rt.name', 'capabilities?.', 'runtimeCaps', 'runtimeName',
      // 裸能力位 / 方法存在性不得充当门（设计 §7.1）：统一走 RuntimeAccess surface。
      'getCapabilities', 'worktreeApi', 'diffApi', 'agentProcessApi', 'sessionBranchApi',
    ];
    expect(files.flatMap((file) => violations(file, bad))).toEqual([]);
  });

  it('worktree availability is a gateway git + directory contract, not a runtime capability', () => {
    const files = ['src/core/worktree/worktree-availability.ts'];
    const bad = ['worktreeApi', 'capabilities', 'runtime.name', 'rt.name'];
    expect(files.flatMap((file) => violations(file, bad))).toEqual([]);
  });

  it('every gated route entry point receives RuntimeAccess instead of capabilities', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src', 'index.ts'), 'utf8');
    // 两条 permission reply 入口都必须注入 access（拒绝路径也要能中性 503）。
    expect(text).toMatch(/handlePermissionReplyById\(req, res, pReplyMatch\[1\], \{[^}]*access:/);
    expect(text).toMatch(/handlePermissionReply\(this\.runtime, req, res, permMatch\[1\], permMatch\[2\], \{[^}]*access:/);
  });

  it('first-party run/checkpoint core uses RuntimeAccess, not runtime identity branches', () => {
    const files = [
      'src/core/run/run-coordinator.ts',
      'src/core/checkpoint/auto-hook.ts',
    ];
    const bad = ['rt.name', "=== 'pi'", 'capabilities?.', 'runtimeName', 'runtimeCaps'];
    expect(files.flatMap((file) => violations(file, bad))).toEqual([]);
  });
});
