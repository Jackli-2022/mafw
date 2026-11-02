// gateway/src/core/goal/probe-scope-guard.ts
// Spike 范围守门（spec §6.5）：ProbeRequest 声明的路径 / 命令类别 / 网络 / 凭据
// 是**机器可读授权**，探针会话里的每一次工具动作都要先过这里。
//
// 判决三值（与审批政策对齐）：
// - `allow`：动作在声明范围内 → 可自动放行（安全、只读、隔离的 Spike 不打扰用户）；
// - `ask`：超出声明范围（未声明的路径 / 命令类别 / 网络 / 凭据）→ 必须转人工；
// - `deny`：主工作区写入 / 路径逃逸 / NUL → 结构上不可能授权（人工也不批）。
//
// 关键不变量：guard 在身份策略与 internal blanket 之前评估，因此
// **内部 Session / full-access 身份都不能把 ask 变成自动放行**（spec §6.5）。
//
// 这里只做纯判定，不读盘、不调用 LLM——便于在审批热路径上同步执行。

import type { ProbeCommandClass, ProbeRequest } from './probe';

export type ProbeScopeVerdict = 'allow' | 'ask' | 'deny';

/** 一次待判定动作（从审批 facet 派生，或测试直接构造）。 */
export interface ProbeScopeAction {
  /** 工具名（bash / read / edit / webfetch ...），用于无显式字段时兜底。 */
  tool?: string;
  /** 目标文件路径（绝对或相对探针工作区）。 */
  path?: string;
  /** 原始命令（bash 类工具）。 */
  command?: string;
  /** 显式命令类别（优先于 command 推断）。 */
  commandClass?: ProbeCommandClass;
  /** 是否访问网络。 */
  network?: boolean;
  /** 需要使用的凭据名。 */
  credential?: string;
  /** 探针隔离工作区（用于把绝对路径折算成范围内的相对路径）。 */
  workspaceDir?: string | null;
  /** 主项目目录（命令里出现它 = 越过隔离边界，deny）。 */
  projectDir?: string | null;
}

/** 探针会话的范围绑定：active probe 的请求 + 它的隔离工作区 + 主项目。 */
export interface ProbeScopeBinding {
  request: ProbeRequest;
  workspaceDir?: string | null;
  projectDir?: string | null;
}

const FILE_TOOLS = new Set([
  'read', 'write', 'edit', 'multiedit', 'patch', 'apply_patch', 'create', 'delete',
  'ls', 'list', 'glob', 'grep', 'find', 'rg', 'view', 'open',
]);
/** 修改型文件工具：看不到目标路径时不能猜，必须问人。 */
const MUTATING_FILE_TOOLS = new Set([
  'write', 'edit', 'multiedit', 'patch', 'apply_patch', 'create', 'delete',
]);
const SHELL_TOOLS = new Set(['bash', 'shell', 'sh', 'command', 'exec', 'run', 'powershell', 'cmd', 'terminal']);
const NETWORK_TOOLS = new Set(['webfetch', 'websearch', 'fetch', 'http', 'curl', 'wget']);

const NETWORK_PATTERNS: RegExp[] = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bgit\s+(?:clone|fetch|pull|push|remote)\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|ci|publish)\b/i,
  /\bpip3?\s+install\b/i,
  /\b(?:apt|apt-get|brew|choco|winget)\s+install\b/i,
  /\bhttps?:\/\//i,
];

const COMMAND_CLASS_PATTERNS: Array<[ProbeCommandClass, RegExp]> = [
  ['install', /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|ci)\b|\bpip3?\s+install\b|\b(?:apt|apt-get|brew|choco|winget)\s+install\b|\bcargo\s+install\b/i],
  ['test', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bjest\b|\bvitest\b|\bpytest\b|\bmocha\b|\bgo\s+test\b|\bcargo\s+test\b/i],
  ['lint', /\beslint\b|\btsc\s+--noEmit\b|\blint\b|\bruff\b|\bflake8\b/i],
  ['format', /\bprettier\b|\bgo\s+fmt\b|\bformat\b|\bblack\b/i],
  ['build', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\btsc\b|\bmake\b|\bcargo\s+build\b|\bwebpack\b|\bvite\s+build\b/i],
  ['search', /\b(?:grep|rg|ag|find|fd)\b/i],
  ['read', /\b(?:cat|ls|dir|head|tail|wc|stat|pwd|echo|type|more)\b|\bgit\s+(?:status|log|diff|show)\b/i],
];

/** 命令 → 声明类别（封闭词汇表；未知一律 `shell`）。 */
export function probeCommandClassOf(command: string): ProbeCommandClass {
  const text = String(command ?? '');
  for (const [key, pattern] of COMMAND_CLASS_PATTERNS) {
    if (pattern.test(text)) return key;
  }
  return 'shell';
}

function commandTouchesNetwork(command: string): boolean {
  const text = String(command ?? '');
  return NETWORK_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/');
}

function isAbsolutePath(value: string): boolean {
  const raw = normalizePath(value);
  return raw.startsWith('/') || /^[A-Za-z]:\//.test(raw) || raw.startsWith('//');
}

function isInside(child: string, parent: string): boolean {
  const base = normalizePath(parent).replace(/\/+$/, '');
  const target = normalizePath(child);
  if (!base || !target) return false;
  const fold = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const b = fold(base);
  const t = fold(target);
  if (t === b) return true;
  return t.startsWith(`${b}/`);
}

/** 绝对路径 → 探针工作区内的相对路径；不在工作区内时 null。 */
function relativeWithinWorkspace(pathValue: string, workspaceDir: string | null | undefined): string | null {
  if (!workspaceDir) return null;
  if (!isInside(pathValue, workspaceDir)) return null;
  const base = normalizePath(workspaceDir).replace(/\/+$/, '');
  const target = normalizePath(pathValue);
  return target.slice(base.length).replace(/^\/+/, '') || '.';
}

function pathVerdict(request: ProbeRequest, action: ProbeScopeAction): ProbeScopeVerdict {
  const raw = String(action.path ?? '');
  if (!raw.trim()) return 'allow';
  if (raw.includes('\0')) return 'deny';

  let relative: string;
  if (isAbsolutePath(raw)) {
    // 绝对路径只有一种合法解释：探针工作区内部（折算成相对路径再判范围）。
    const mapped = relativeWithinWorkspace(raw, action.workspaceDir ?? null);
    if (mapped === null) {
      // 主工作区写入 / 任意绝对路径：结构上不可授权（不是"问一下"）。
      return 'deny';
    }
    relative = mapped;
  } else {
    relative = normalizePath(raw).replace(/^\.\//, '');
  }

  const segments = relative.split('/').filter((segment) => segment && segment !== '.');
  if (segments.some((segment) => segment === '..')) return 'deny';
  const normalized = segments.length ? segments.join('/') : '.';

  const scopePaths = (request.scope?.paths ?? []).map((item) => normalizePath(item).replace(/\/+$/, ''));
  if (scopePaths.length === 0) return 'ask';
  if (scopePaths.includes('.')) return 'allow';
  const fold = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const target = fold(normalized);
  const covered = scopePaths.some((scopePath) => {
    const scope = fold(scopePath || '.');
    return scope === '.' ? true : target === scope || target.startsWith(`${scope}/`);
  });
  return covered ? 'allow' : 'ask';
}

function worst(verdicts: ProbeScopeVerdict[]): ProbeScopeVerdict {
  if (verdicts.includes('deny')) return 'deny';
  if (verdicts.includes('ask')) return 'ask';
  return 'allow';
}

const CD_COMMANDS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);
const SHELL_SEGMENT = /&&|\|\||[;|\n]/;

/** 极简 shell 分词（引号感知）——只用于审批前的边界判定，不执行任何东西。 */
function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  for (let match = re.exec(segment); match; match = re.exec(segment)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

/** 纯字符串归一化（不触碰文件系统）：折叠 `.` / `..`，保留盘符与根。 */
function normalizeResolved(value: string): string {
  const raw = normalizePath(value);
  const drive = /^([A-Za-z]:)\//.exec(raw)?.[1] ?? '';
  const absolute = !!drive || raw.startsWith('/');
  const segments = (drive ? raw.slice(drive.length) : raw).split('/');
  const out: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { out.pop(); continue; }
    out.push(segment);
  }
  const joined = out.join('/');
  if (drive) return `${drive}/${joined}`;
  return absolute ? `/${joined}` : joined;
}

/** cd 目标解析成绝对路径；无法解析（`~` / 未知 cwd）→ null（按越界处理）。 */
function resolveDirectoryTarget(target: string, cwd: string | null): string | null {
  const raw = normalizePath(target);
  if (!raw || raw === '~' || raw.startsWith('~/')) return null; // HOME 在隔离工作区之外
  if (isAbsolutePath(raw)) return normalizeResolved(raw);
  if (!cwd) return null;
  return normalizeResolved(`${cwd}/${raw}`);
}

/**
 * 命令级边界：
 * - `cd` / `pushd` / `chdir` / `Set-Location` 的目标**解析成绝对路径**后判定：
 *   落在主项目内或隔离工作区之外 → deny（覆盖 `cd <projectParent> && cat <base>/src/a.ts`、
 *   `cd -- ..`、`cd -P ..` 这类只做子串匹配会漏掉的形态）；
 * - 命令里的绝对路径 / `./` / `../` 参数同样解析后判定（不靠子串猜）；
 * - 其余交给命令类别 / 网络判定。
 */
function commandVerdict(
  command: string,
  ctx: { projectDir?: string | null; workspaceDir?: string | null },
): ProbeScopeVerdict {
  const text = String(command ?? '');
  if (!text.trim()) return 'allow';
  const verdicts: ProbeScopeVerdict[] = [];
  let cwd = ctx.workspaceDir ? normalizeResolved(ctx.workspaceDir) : null;

  const judgePath = (value: string): void => {
    const resolved = resolveDirectoryTarget(value, cwd);
    if (!resolved) { verdicts.push('deny'); return; }
    if (ctx.projectDir && isInside(resolved, ctx.projectDir)) verdicts.push('deny');
    if (ctx.workspaceDir && !isInside(resolved, ctx.workspaceDir)) verdicts.push('deny');
  };

  for (const segment of text.split(SHELL_SEGMENT)) {
    const tokens = tokenizeSegment(segment);
    if (tokens.length === 0) continue;
    const head = tokens[0].toLowerCase();

    if (CD_COMMANDS.has(head)) {
      // 跳过 `--` / `-P` / `-L` / `-` 等选项，第一个非选项 token 是目标。
      const target = tokens.slice(1).find((token) => !token.startsWith('-'));
      const resolved = resolveDirectoryTarget(target ?? '~', cwd);
      if (!resolved) { verdicts.push('deny'); continue; }
      if (ctx.projectDir && isInside(resolved, ctx.projectDir)) verdicts.push('deny');
      if (ctx.workspaceDir && !isInside(resolved, ctx.workspaceDir)) verdicts.push('deny');
      cwd = resolved;
      continue;
    }

    for (const token of tokens) {
      if (token.includes('://')) continue; // URL 归网络判定
      const pathLike = normalizePath(token);
      const looksLikePath = isAbsolutePath(pathLike)
        || pathLike.startsWith('./') || pathLike.startsWith('../')
        || pathLike.split('/').includes('..');
      if (!looksLikePath) continue;
      judgePath(token);
    }
  }

  // 兜底：命令里出现主项目绝对路径（即使被引号/拼接拆开，字面量也拦）。
  if (ctx.projectDir) {
    const project = normalizePath(ctx.projectDir).replace(/\/+$/, '');
    const fold = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
    if (project && fold(normalizePath(text)).includes(fold(project))) verdicts.push('deny');
  }

  return verdicts.length ? worst(verdicts) : 'allow';
}

/**
 * 判定一次动作是否在声明范围内。
 *
 * 无绑定的探针请求一律 `deny`（fail-closed：没有可执行范围就没有授权）。
 * 多字段同时越界时取最严：deny > ask > allow。
 */
export const ProbeScopeGuard = {
  evaluate(binding: ProbeScopeBinding | ProbeRequest | null | undefined, action: ProbeScopeAction): ProbeScopeVerdict {
    const request: ProbeRequest | null = binding
      ? (((binding as ProbeScopeBinding).request ?? (binding as ProbeRequest)) as ProbeRequest)
      : null;
    if (!request || !request.scope) return 'deny';
    const effectiveWorkspace = action.workspaceDir ?? (binding as ProbeScopeBinding)?.workspaceDir ?? null;
    const effectiveProject = action.projectDir ?? (binding as ProbeScopeBinding)?.projectDir ?? null;
    const verdicts: ProbeScopeVerdict[] = [];

    if (action.path !== undefined && action.path !== null) {
      verdicts.push(pathVerdict(request, { ...action, workspaceDir: effectiveWorkspace }));
    } else if (action.tool && MUTATING_FILE_TOOLS.has(action.tool.toLowerCase())) {
      // 修改型工具但看不到目标路径：无法证明在范围内 → 转人工（不猜）。
      verdicts.push('ask');
    }

    if (action.credential) {
      const declared = (request.scope.credentials ?? []).map((item) => item.trim());
      verdicts.push(declared.includes(action.credential.trim()) ? 'allow' : 'ask');
    }

    if (action.network === true) {
      verdicts.push(request.scope.network ? 'allow' : 'ask');
    }

    const command = action.command?.trim() ?? '';
    const commandClass = action.commandClass ?? (command ? probeCommandClassOf(command) : undefined);
    if (commandClass) {
      const declared = (request.scope.commandClasses ?? []).includes(commandClass);
      verdicts.push(declared ? 'allow' : 'ask');
      if (command && commandTouchesNetwork(command)) {
        verdicts.push(request.scope.network ? 'allow' : 'ask');
      }
    } else if (action.tool && SHELL_TOOLS.has(action.tool.toLowerCase())) {
      // shell 类工具但看不到命令：无法判范围 → 转人工。
      verdicts.push('ask');
    }
    if (command) {
      // 命令可能绕过路径参数直接操作主项目（`cd <mainProject>` / `cd -- ..` / 绝对路径参数）。
      verdicts.push(commandVerdict(command, {
        projectDir: effectiveProject,
        workspaceDir: effectiveWorkspace,
      }));
    }

    if (verdicts.length === 0) {
      // 没有可判定的边界（例如日志/记忆类工具）：不属于探针越界面。
      return 'allow';
    }
    return worst(verdicts);
  },
};

/**
 * 从审批 facet 派生待判定动作（opencode/pi 的工具参数形状差异在这里收敛）。
 * 缺 key 一律返回 `{}`（guard 对未知动作按 allow——它不触碰探针边界）。
 */
export function probeActionFromApproval(
  toolName: string,
  patterns: string[] = [],
  metadata?: Record<string, unknown>,
): ProbeScopeAction {
  const tool = String(toolName ?? '').trim().toLowerCase();
  const action: ProbeScopeAction = { tool };
  const meta = metadata ?? {};
  const command = Array.isArray(patterns) && patterns.length > 0
    ? patterns.join(' ')
    : (typeof meta.command === 'string' ? meta.command : typeof meta.cmd === 'string' ? meta.cmd : '');

  if (SHELL_TOOLS.has(tool) && command) {
    action.command = command;
    action.commandClass = probeCommandClassOf(command);
    if (commandTouchesNetwork(command)) action.network = true;
    return action;
  }
  if (NETWORK_TOOLS.has(tool)) {
    action.network = true;
    return action;
  }
  if (FILE_TOOLS.has(tool)) {
    const pathValue = ['filePath', 'path', 'file_path', 'target']
      .map((key) => (typeof meta[key] === 'string' ? meta[key] as string : ''))
      .find((value) => !!value)
      ?? (Array.isArray(patterns) ? patterns.find((value) => typeof value === 'string' && /[\\/.]/.test(value)) : '');
    if (pathValue) action.path = pathValue;
  }
  const credential = ['credential', 'credentialName', 'secret']
    .map((key) => (typeof meta[key] === 'string' ? meta[key] as string : ''))
    .find((value) => !!value);
  if (credential) action.credential = credential;
  return action;
}
