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
  | 'runtime-private-path'
  | 'runtime-access-construction';

export interface BoundaryLeak {
  rule: BoundaryRule;
  line: number;
  excerpt: string;
}

/**
 * runtime 门面/宿主的常见接收者。不限于固定变量名：`client` / `runtimeClient` /
 * `deps.getRuntime()` 等别名同样命中（review 实证的漏网形态）。
 */
const RUNTIME_RECEIVER =
  '(?:\\b(?:rt|runtime|facade|agentRuntime|client|runtimeClient|runtimeHost|hostRuntime)\\b|\\bdeps\\s*\\.\\s*getRuntime\\s*\\(\\s*\\)|\\bgetRuntime\\s*\\(\\s*\\))';
const CAST = '(?:\\s+as\\s+[^)\\n]+)?\\s*\\)?';

const DIAGNOSTIC_FIELDS = ['config', 'completion', 'credentials', 'agentProcess', 'getBaseUrl', 'healthCheck'];

function fieldPattern(keys: string[]): RegExp {
  const alt = keys.join('|');
  return new RegExp(`${RUNTIME_RECEIVER}${CAST}\\s*\\??\\.\\s*(?:${alt})\\b`, 'g');
}

/** 任意接收者的字段读取（能力位用：别名/解构/任意链都算，不做接收者白名单）。 */
function anyReceiverFieldPattern(keys: string[]): RegExp {
  const alt = keys.join('|');
  return new RegExp(`\\.\\s*(?:${alt})\\b`, 'g');
}

/** bracket 形式：`(runtime as any)['capabilities']`（key 写在字符串里）。 */
function bracketPattern(keys: string[]): RegExp {
  const alt = keys.join('|');
  return new RegExp(`${RUNTIME_RECEIVER}${CAST}\\s*\\[\\s*['"](?:${alt})['"]\\s*\\]`, 'g');
}

interface RuleSpec {
  rule: BoundaryRule;
  /** 在「字符串体已置空、模板 `${...}` 保留」的代码上匹配（别名/解构可见）。 */
  patterns: RegExp[];
  /** 在原始文本（含字符串）上匹配（bracket key / getter / 路径 / 引号比较）。 */
  stringPatterns?: RegExp[];
}

const RULES: RuleSpec[] = [
  {
    rule: 'runtime-name',
    patterns: [
      fieldPattern(['name', 'activeDialect']),
      // 名称分支：runtimeName === 'pi'
      /\bruntimeName\s*(?:===|!==|==|!=)\s*['"`]/g,
    ],
    stringPatterns: [
      // 引号比较必须看原文（masked 视图里字符串体已置空，永远匹配不到 —— review #2）。
      /\bname\s*(?:===|!==)\s*['"`](?:pi|opencode|claude|dsh)/g,
      bracketPattern(['name', 'activeDialect']),
    ],
  },
  {
    rule: 'raw-capability',
    patterns: [
      // 不限制接收者：`client.capabilities` / `deps.getRuntime()?.capabilities` /
      // 模板插值 `${rt.capabilities.x}` 都是同一泄漏形态。
      anyReceiverFieldPattern(['capabilities']),
      // 解构：`const { capabilities } = rt`
      /\{\s*capabilities\s*[,}]/g,
      /\{\s*capabilities\s*:/g,
    ],
    stringPatterns: [bracketPattern(['capabilities'])],
  },
  {
    rule: 'facade-diagnostics',
    patterns: [
      // 进程/凭据/补全诊断字段：任意接收者（别名、解构链、调用结果都算）。
      anyReceiverFieldPattern(['completion', 'credentials', 'agentProcess', 'getBaseUrl', 'healthCheck']),
      // `.config` 例外：业务自有配置对象/加载器极常见，只在 runtime 接收者上判泄漏。
      fieldPattern(['config']),
    ],
    stringPatterns: [
      bracketPattern(DIAGNOSTIC_FIELDS),
      // bracket 形式也不限接收者（非 config 字段；config 仍按 runtime 接收者）。
      /\[\s*['"](?:completion|credentials|agentProcess|getBaseUrl|healthCheck)['"]\s*\]/g,
    ],
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
  {
    rule: 'runtime-access-construction',
    patterns: [
      // RuntimeAccess 只能由 runtime/ 内部（facade）用 raw runtime 构造；业务现场
      // 构造等于绕过门面（review #3：session-mutations / session-switch 兜底）。
      /\bnew\s+RuntimeAccess\s*\(/g,
    ],
  },
];

/**
 * 去掉字符串**字面量体**但保留模板 `${...}` 插值表达式：
 *   - `'a.b'` / `"a.b"` → `''` / `""`（避免 route-catalog 的 operationId 假阳性）
 *   - `` `${client.capabilities.diffApi}` `` → 插值里的 `.capabilities` 仍可见
 */
export function maskStringsKeepInterpolations(code: string): string {
  let out = '';
  let i = 0;
  const n = code.length;
  const blank = (ch: string) => (ch === '\n' ? '\n' : ' ');

  const readQuoted = (quote: string): void => {
    out += quote;
    i++;
    while (i < n) {
      const ch = code[i];
      if (ch === '\\') { out += ch + (code[i + 1] ?? ''); i += 2; continue; }
      if (ch === quote) { out += quote; i++; return; }
      out += blank(ch);
      i++;
    }
  };

  const readCode = (stopAtBrace: boolean): void => {
    let depth = 0;
    while (i < n) {
      const ch = code[i];
      if (ch === "'" || ch === '"') { readQuoted(ch); continue; }
      if (ch === '`') { readTemplate(); continue; }
      if (stopAtBrace) {
        if (ch === '{') { depth++; out += ch; i++; continue; }
        if (ch === '}') {
          out += ch;
          i++;
          if (depth === 0) return;
          depth--;
          continue;
        }
      }
      out += ch;
      i++;
    }
  };

  const readTemplate = (): void => {
    out += '`';
    i++;
    while (i < n) {
      const ch = code[i];
      if (ch === '\\') { out += blank(ch) + blank(code[i + 1] ?? ''); i += 2; continue; }
      if (ch === '`') { out += '`'; i++; return; }
      if (ch === '$' && code[i + 1] === '{') {
        out += '${';
        i += 2;
        readCode(true); // 保留插值表达式（含嵌套字符串/模板的掩码）
        continue;
      }
      out += blank(ch);
      i++;
    }
  };

  readCode(false);
  return out;
}

/**
 * 扫描源码文本：注释里的术语不算违规（文档需要解释被替换掉的旧能力位），
 * 每个规则每行最多报一次（保持稳定顺序 = 规则声明顺序）。
 */
export function scanSource(text: string): BoundaryLeak[] {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/[^\n]*$/gm, '');
  const masked = maskStringsKeepInterpolations(code);
  const lines = code.split('\n');
  const maskedLines = masked.split('\n');
  const leaks: BoundaryLeak[] = [];
  for (const spec of RULES) {
    const seen = new Set<number>();
    const passes: Array<[string[], RegExp[]]> = [
      [maskedLines, spec.patterns],
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

  it('scanner catches aliased receivers, destructuring, interpolations and access construction', () => {
    const leaks = scanSource([
      "const a = deps.getRuntime()?.capabilities;",
      "const b = client.capabilities;",
      "const c = runtimeClient.capabilities;",
      "const { capabilities } = client;",
      'const d = `${client.capabilities.diffApi}`;',
      "const e = client.config.get();",
      'const f = new RuntimeAccess(client);',
      "if (client.name === 'pi') {}",
    ].join('\n'));
    expect([...new Set(leaks.map((l) => l.rule))].sort()).toEqual([
      'facade-diagnostics',
      'raw-capability',
      'runtime-access-construction',
      'runtime-name',
    ]);
  });

  it('masks plain string bodies but keeps template interpolations', () => {
    const masked = maskStringsKeepInterpolations(
      "const a = 'rt.capabilities'; const b = `${client.capabilities.diffApi}`;",
    );
    expect(masked).toContain('${client.capabilities.diffApi}');
    expect(masked).not.toContain("'rt.capabilities'");
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
      'runtime-access-construction',
      'runtime-name',
      'runtime-private-path',
    ]);
    // review 漏网的固定接收者白名单形态必须逐条命中。
    const aliased = scanSource(fs.readFileSync(
      path.join(ROOT, 'tests/fixtures/runtime-boundary-fixtures/business-leak.ts.txt'),
      'utf8',
    ));
    const lines = aliased.map((l) => `${l.rule}:${l.excerpt}`);
    expect(lines.some((l) => l.startsWith('raw-capability:') && l.includes('deps.getRuntime()'))).toBe(true);
    expect(lines.some((l) => l.startsWith('raw-capability:') && l.includes('runtimeClient.capabilities'))).toBe(true);
    expect(lines.some((l) => l.startsWith('raw-capability:') && l.includes('{ capabilities }'))).toBe(true);
    expect(lines.some((l) => l.startsWith('raw-capability:') && l.includes('${client.capabilities.diffApi}'))).toBe(true);
    expect(lines.some((l) => l.startsWith('runtime-name:') && l.includes("client.name === 'pi'"))).toBe(true);
    expect(lines.some((l) => l.startsWith('runtime-access-construction:'))).toBe(true);
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
