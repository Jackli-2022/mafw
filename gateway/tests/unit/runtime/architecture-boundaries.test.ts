/**
 * 架构边界守卫（第二批 Task 7 / 设计 §7.1、§11）。
 *
 * 业务核心（routes / core / media / trajectory）与组合根的业务区段只能消费
 * RuntimeAccess surface / Experience / View DTO：
 *   - 不读 runtime 名称（含 `?.`、cast、括号访问等变体）与 runtimeName 比较
 *   - 不读裸 capabilities
 *   - 不读诊断字段（config / completion / credentials / agentProcess /
 *     getBaseUrl / healthCheck / activeDialect），也不把它们 getter 回去
 *   - 不出现 runtime 私有存储路径（opencode snapshot 根）
 *
 * 白名单只有一处，且是「精确文件 + 精确符号」：`src/index.ts` 组合根的
 * runtimeHost / runtimeDiagnostics / runtimeCaps / runtimeName 访问器；
 * 组合根不得通过 `this.runtime?.<诊断字段>` 回读门面。业务目录整目录扫描，
 * 没有目录级或文件级豁免。
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();

export type BoundaryRule =
  | 'runtime-name'
  | 'raw-capability'
  | 'facade-diagnostics'
  | 'diagnostics-getter'
  | 'runtime-private-path';

export interface BoundaryLeak {
  rule: BoundaryRule;
  line: number;
  excerpt: string;
}

/** 接收者标识符：runtime 门面 / 宿主 / 上一代 runtime 的常见局部名。 */
const RECEIVER = '(?:rt|runtime|facade|agentRuntime)';
const CAST = '(?:\\s+as\\s+[^)\\n]+)?\\s*\\)?';

function fieldPattern(keys: string[]): RegExp {
  const alt = keys.join('|');
  return new RegExp(`\\b${RECEIVER}\\b${CAST}\\s*\\??\\.\\s*(?:${alt})\\b`, 'g');
}

/** bracket 形式：`(runtime as any)['capabilities']`（key 写在字符串里）。 */
function bracketPattern(keys: string[]): RegExp {
  const alt = keys.join('|');
  return new RegExp(`\\b${RECEIVER}\\b${CAST}\\s*\\[\\s*['"](?:${alt})['"]\\s*\\]`, 'g');
}

interface RuleSpec {
  rule: BoundaryRule;
  patterns: RegExp[];
  /** 只在原始文本（含字符串）上匹配的模式（bracket key / 路径 / getter）。 */
  stringPatterns?: RegExp[];
}

const RULES: RuleSpec[] = [
  {
    rule: 'runtime-name',
    patterns: [
      fieldPattern(['name', 'activeDialect']),
      // 名称分支：runtimeName === 'pi' / x.name === 'opencode'
      /\bruntimeName\s*(?:===|!==|==|!=)\s*['"`]/g,
      /\bname\s*(?:===|!==)\s*['"`](?:pi|opencode|claude|dsh)/g,
    ],
    stringPatterns: [bracketPattern(['name', 'activeDialect'])],
  },
  {
    rule: 'raw-capability',
    patterns: [fieldPattern(['capabilities'])],
    stringPatterns: [bracketPattern(['capabilities'])],
  },
  {
    rule: 'facade-diagnostics',
    patterns: [
      fieldPattern(['config', 'completion', 'credentials', 'agentProcess', 'getBaseUrl', 'healthCheck']),
    ],
    stringPatterns: [bracketPattern(['config', 'completion', 'credentials', 'agentProcess', 'getBaseUrl', 'healthCheck'])],
  },
  {
    rule: 'diagnostics-getter',
    patterns: [],
    stringPatterns: [
      // 把诊断字段重新挂回门面（getter 形态）。
      /Object\s*\.\s*defineProperty\s*\(\s*[^,]+,\s*['"`](?:name|capabilities|config|completion|credentials|agentProcess|getBaseUrl|healthCheck|activeDialect)['"`]/g,
      /get\s+(?:name|capabilities|activeDialect)\s*\(/g,
    ],
  },
  {
    rule: 'runtime-private-path',
    patterns: [],
    stringPatterns: [
      /\.local[\\/]share[\\/]opencode/g,
      /\bopencode[\\/]snapshot\b/g,
    ],
  },
];

/**
 * 扫描源码文本：注释里的术语不算违规（文档需要解释被替换掉的旧能力位），
 * 每个规则每行最多报一次（保持稳定顺序 = 规则声明顺序）。
 *
 * 身份/能力/诊断字段的规则只在「代码」上匹配（字符串字面量先置空），避免把
 * route-catalog 的 `runtime.config.get` operationId 之类数据当读取；路径与
 * getter 规则保留字符串（key/路径本来就写在字符串里）。
 */
export function scanSource(text: string): BoundaryLeak[] {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/[^\n]*$/gm, '');
  const codeNoStrings = code
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  const lines = code.split('\n');
  const linesNoStrings = codeNoStrings.split('\n');
  const leaks: BoundaryLeak[] = [];
  for (const spec of RULES) {
    const seen = new Set<number>();
    const passes: Array<[string[], RegExp[]]> = [
      [linesNoStrings, spec.patterns],
      [lines, spec.stringPatterns ?? []],
    ];
    for (const [scanLines, patterns] of passes) {
      for (const pattern of patterns) {
        for (let i = 0; i < scanLines.length; i++) {
          const line = scanLines[i];
          if (!line) continue;
          pattern.lastIndex = 0;
          if (!pattern.test(line)) continue;
          if (seen.has(i + 1)) continue;
          seen.add(i + 1);
          leaks.push({ rule: spec.rule, line: i + 1, excerpt: lines[i].trim().slice(0, 120) });
        }
      }
    }
  }
  return leaks;
}

function readSource(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function scanFile(file: string): BoundaryLeak[] {
  return scanSource(readSource(file)).map((leak) => ({
    ...leak,
    excerpt: `${file}:${leak.line}: ${leak.excerpt}`,
  }));
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    const stat = fs.statSync(path.join(ROOT, rel));
    if (stat.isDirectory()) out.push(...filesUnder(rel));
    else if (name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

describe('runtime isolation architecture boundaries', () => {
  it('scanner catches optional-chain and cast capabilities', () => {
    const leaks = scanSource(
      'const x = rt?.capabilities?.diffApi; const y = (rt as any).name === "pi";',
    );
    expect(leaks.map((l) => l.rule)).toEqual(['runtime-name', 'raw-capability']);
  });

  it('scanner catches bracket access, getters, name branches and private paths', () => {
    const leaks = scanSource([
      "const a = (runtime as any)['capabilities'].worktreeApi;",
      "Object.defineProperty(facade, 'activeDialect', { get: () => raw.activeDialect });",
      "const b = runtimeName === 'pi';",
      "const c = `${home}/.local/share/opencode/snapshot`;",
      'const d = runtime.agentProcess.spawnServe;',
      'const e = runtime?.getBaseUrl();',
    ].join('\n'));
    expect([...new Set(leaks.map((l) => l.rule))]).toEqual([
      'runtime-name',
      'raw-capability',
      'facade-diagnostics',
      'diagnostics-getter',
      'runtime-private-path',
    ]);
  });

  it('scanner ignores comments and reporting wording about the removed fields', () => {
    const leaks = scanSource([
      '// 不再读 capabilities.diffApi / runtime.name',
      '/* rt?.capabilities — 旧能力位说明 */',
      'const ok = runtime?.session.messages({ sessionID });',
    ].join('\n'));
    expect(leaks).toEqual([]);
  });

  it('reverse fixture is caught (business module leaking runtime identity)', () => {
    const fromFixture = scanSource(
      fs.readFileSync(
        path.join(ROOT, 'tests/fixtures/runtime-boundary-fixtures/business-leak.ts.txt'),
        'utf8',
      ),
    );
    const rules = new Set(fromFixture.map((l) => l.rule));
    expect([...rules].sort()).toEqual([
      'diagnostics-getter',
      'facade-diagnostics',
      'raw-capability',
      'runtime-name',
      'runtime-private-path',
    ]);
  });

  it('business routes/core/media/trajectory have no runtime identity or capability reads', () => {
    const files = [
      ...filesUnder('src/routes'),
      ...filesUnder('src/core'),
      ...filesUnder('src/media'),
      ...filesUnder('src/trajectory'),
    ];
    // 逐文件扫描，无目录级豁免。
    expect(files.length).toBeGreaterThan(100);
    const violations = files.flatMap(scanFile);
    expect(violations).toEqual([]);
  });

  it('worktree availability is a gateway git + directory contract, not a runtime capability', () => {
    const files = ['src/core/worktree/worktree-availability.ts'];
    expect(files.flatMap(scanFile)).toEqual([]);
  });

  it('every gated route entry point receives RuntimeAccess instead of capabilities', () => {
    const text = readSource('src/index.ts');
    // 两条 permission reply 入口都必须注入 access（拒绝路径也要能中性 503）。
    expect(text).toMatch(/handlePermissionReplyById\(req, res, pReplyMatch\[1\], \{[^}]*access:/);
    expect(text).toMatch(/handlePermissionReply\(this\.runtime, req, res, permMatch\[1\], permMatch\[2\], \{[^}]*access:/);
  });

  it('first-party run/checkpoint core uses RuntimeAccess, not runtime identity branches', () => {
    const files = [
      'src/core/run/run-coordinator.ts',
      'src/core/checkpoint/auto-hook.ts',
    ];
    expect(files.flatMap(scanFile)).toEqual([]);
  });

  it('composition root keeps diagnostics on dedicated symbols only', () => {
    const text = readSource('src/index.ts');
    const ALLOWED_SYMBOLS = ['runtimeHost', 'runtimeDiagnostics', 'runtimeCaps', 'runtimeName'];
    for (const symbol of ALLOWED_SYMBOLS) {
      expect(text).toContain(symbol);
    }
    // 组合根不得经门面回读诊断字段（这正是本任务收窄的边界）。
    const facadeReads = [
      /this\.runtime\??\.(?:name|capabilities|config|completion|credentials|agentProcess|getBaseUrl|healthCheck|activeDialect)\b/,
      /this\.runtime!\??\.(?:name|capabilities|config|completion|credentials|agentProcess|getBaseUrl|healthCheck|activeDialect)\b/,
      /\(\s*(?:runtime|rt)\s+as\s+any\s*\)\s*\.\s*(?:name|capabilities|config|completion|credentials|agentProcess|getBaseUrl|healthCheck|activeDialect)\b/,
    ];
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const pattern of facadeReads) {
      expect(code).not.toMatch(pattern);
    }
    // 诊断视图只从组合根的 host 构建，不从门面回读。
    expect(code).toContain('buildRuntimeDiagnostics(this.runtimeHost)');
    expect(code).not.toContain('buildRuntimeDiagnostics(this.runtime)');
  });

  it('composition root gates the completion channel through RuntimeAccess', () => {
    const code = readSource('src/index.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain("access.can('process.completion')");
    expect(code).not.toMatch(/capabilities\??\.completionApi/);
  });
});
