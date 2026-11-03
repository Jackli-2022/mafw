// gateway/src/core/goal/probe-scope-guard.ts
// Spike 范围守门（spec §6.5）：ProbeRequest 声明的路径 / 命令类别 / 网络 / 凭据
// 是**机器可读授权**，探针会话里的每一次工具动作都要先过这里。
//
// 判决三值（与审批政策对齐）：
// - `allow`：动作在声明范围内 → 可自动放行（安全、只读、隔离的 Spike 不打扰用户）；
// - `ask`：超出声明范围（未声明的路径 / 命令类别 / 网络 / 凭据）或敏感文件 → 必须转人工；
// - `deny`：主工作区写入 / 路径逃逸 / NUL / `.git` 内部数据 → 结构上不可能授权（人工也不批）。
//
// 主项目只读（2026-11-03 修正）：探针 cwd 是空隔离目录，读工具必须能读主项目里
// **ProbeRequest.scope.paths 声明过的**源码（否则 Spike 只能对着空目录推理）。
// 因此 READONLY_FILE_TOOLS 对主项目内、落在声明路径下的绝对路径放行；写工具与
// 一切 shell 命令仍然走原判定（主项目写入 / 命令里出现项目路径 = deny）。
//
// 敏感路径与符号链接（2026-11-03 final review）：
// - `.env*` / 私钥 / 凭据文件即使落在声明范围内也**不自动放行**（ask），
//   `.git/**` 属于仓库内部数据（deny）——`scope.paths: ['.']` 不等于"整个仓库无秘密"；
// - 目标路径与声明根都解析 **realpath**：落在声明范围里的符号链接若指向项目外，
//   realpath 之后不再位于项目/范围内 → deny（词法前缀检查挡不住 symlink 逃逸）。
//
// 关键不变量：guard 在身份策略与 internal blanket 之前评估，因此
// **内部 Session / full-access 身份都不能把 ask 变成自动放行**（spec §6.5）。
//
// 判定保持同步（审批热路径）：只做字符串运算 + 少量 realpath（路径不存在的部分按
// 最近已存在祖先折叠，失败 fail-open 到词法判定）。

import * as fs from 'fs';
import * as path from 'path';

import type { ProbeCommandClass, ProbeRequest } from './probe';

export type ProbeScopeVerdict = 'allow' | 'ask' | 'deny';

/** 真实路径解析注入（测试可给假映射；缺省 = fs.realpathSync.native）。 */
export interface ProbeScopeGuardOptions {
  realpath?: (absolutePath: string) => string | null;
}

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
/** 只读文件工具：可以读主项目内**声明路径**下的源码（写工具永远不行）。 */
const READONLY_FILE_TOOLS = new Set([
  'read', 'ls', 'list', 'glob', 'grep', 'find', 'rg', 'view', 'open',
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

/** 绝对路径 → 目录内的相对路径；不在该目录内时 null。 */
function relativeWithinDir(pathValue: string, dir: string | null | undefined): string | null {
  if (!dir) return null;
  if (!isInside(pathValue, dir)) return null;
  const base = normalizePath(dir).replace(/\/+$/, '');
  const target = normalizePath(pathValue);
  return target.slice(base.length).replace(/^\/+/, '') || '.';
}

/** 主项目内的只读访问：只有只读文件工具可以碰（写工具结构性拒绝）。 */
function isReadOnlyFileTool(tool: string | undefined): boolean {
  if (!tool) return false;
  return READONLY_FILE_TOOLS.has(tool.toLowerCase());
}

/**
 * 敏感路径（相对项目/工作区根）：
 * - `.git` / `.ssh` 等仓库/凭据内部目录 → deny（不是源码，人也不该拿来当证据）；
 * - `.env*` / `*.pem` / `*.key` / `credentials*` / `secrets*` → ask（声明范围内也不自动放行）。
 */
function sensitivePathVerdict(relative: string): ProbeScopeVerdict | null {
  const segments = relative.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  if (segments.includes('.git') || segments.includes('.ssh')) return 'deny';
  const base = segments[segments.length - 1] ?? '';
  if (!base) return null;
  if (base === '.env' || base.startsWith('.env.')) return 'ask';
  if (/\.(?:pem|key|p12|pfx|keystore)$/.test(base)) return 'ask';
  if (/^(?:credentials?|secrets?)(?:\.[a-z0-9_-]+)?$/.test(base)) return 'ask';
  return null;
}

function defaultRealpath(value: string): string | null {
  try { return fs.realpathSync.native(value); } catch { /* 文件可能还不存在 */ }
  try { return fs.realpathSync(value); } catch { return null; }
}

/**
 * 解析真实路径；目标不存在时解析**最近的已存在祖先**再拼回缺失部分
 * （写新文件也要过 symlink 检查，不能因为"还不存在"就跳过）。
 */
function resolveRealPath(value: string, realpath: (absolutePath: string) => string | null): string | null {
  let current = normalizeResolved(value);
  const missing: string[] = [];
  for (let depth = 0; depth < 64; depth++) {
    const resolved = realpath(current);
    if (resolved) {
      const real = normalizeResolved(resolved).replace(/\/+$/, '');
      if (missing.length === 0) return real || '/';
      return normalizeResolved(`${real}/${missing.reverse().join('/')}`);
    }
    const parent = normalizeResolved(path.dirname(current));
    if (!parent || parent === current) return null;
    missing.push(path.basename(current));
    current = parent;
  }
  return null;
}

function scopeVerdictFor(request: ProbeRequest, relative: string): ProbeScopeVerdict {
  const scopePaths = (request.scope?.paths ?? []).map((item) => normalizePath(item).replace(/\/+$/, ''));
  if (scopePaths.length === 0) return 'ask';
  if (scopePaths.includes('.')) return 'allow';
  const fold = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const target = fold(relative);
  const covered = scopePaths.some((scopePath) => {
    const scope = fold(scopePath || '.');
    return scope === '.' ? true : target === scope || target.startsWith(`${scope}/`);
  });
  return covered ? 'allow' : 'ask';
}

/**
 * realpath 边界：目标解析后必须仍在**声明根**内，且仍落在声明路径（真实路径）内。
 * 无法解析（路径不存在且祖先都解析失败）时返回 allow，交给词法判定。
 */
function realPathVerdict(
  request: ProbeRequest,
  raw: string,
  rootDir: string | null,
  realpath: (absolutePath: string) => string | null,
): ProbeScopeVerdict {
  if (!rootDir) return 'allow';
  const root = normalizePath(rootDir).replace(/\/+$/, '');
  if (!root) return 'allow';
  const targetAbs = isAbsolutePath(raw) ? raw : `${root}/${normalizePath(raw)}`;
  const rootReal = resolveRealPath(root, realpath);
  const targetReal = resolveRealPath(targetAbs, realpath);
  if (!rootReal || !targetReal) return 'allow';
  if (!isInside(targetReal, rootReal)) return 'deny';
  // 词法名字可以被符号链接掩盖（`src/alias -> .env`）：按真实相对路径再判一次敏感名。
  const realRelative = relativeWithinDir(targetReal, rootReal);
  const sensitiveReal = realRelative ? sensitivePathVerdict(realRelative) : null;
  if (sensitiveReal) return sensitiveReal;

  const scopePaths = (request.scope?.paths ?? []).map((item) => normalizePath(item).replace(/\/+$/, ''));
  if (scopePaths.length === 0) return 'allow';
  if (scopePaths.includes('.')) return 'allow';
  const allowedRoots = scopePaths
    .map((scopePath) => (scopePath === '.' ? rootReal : resolveRealPath(`${root}/${scopePath}`, realpath)))
    .filter((value): value is string => !!value);
  if (allowedRoots.length > 0 && !allowedRoots.some((allowed) => isInside(targetReal, allowed))) {
    // 真实路径不在声明范围（但仍在项目内）：与词法越界同语义——转人工，不是结构性拒绝。
    return 'ask';
  }
  return 'allow';
}

function pathVerdict(
  request: ProbeRequest,
  action: ProbeScopeAction,
  realpath: (absolutePath: string) => string | null,
): ProbeScopeVerdict {
  const raw = String(action.path ?? '');
  if (!raw.trim()) return 'allow';
  if (raw.includes('\0')) return 'deny';

  let relative: string;
  let rootDir: string | null;
  if (isAbsolutePath(raw)) {
    // 绝对路径只有两种合法解释：
    //   1. 探针工作区内部（折算成相对路径再判范围）；
    //   2. 主项目内、且由只读工具访问（Spike 读源码）——仍要落在声明路径内。
    // 其余（主工作区写入 / 任意绝对路径）结构上不可授权，不是"问一下"。
    const inWorkspace = relativeWithinDir(raw, action.workspaceDir ?? null);
    if (inWorkspace !== null) {
      relative = inWorkspace;
      rootDir = action.workspaceDir ?? null;
    } else {
      const inProject = relativeWithinDir(raw, action.projectDir ?? null);
      if (inProject === null || !isReadOnlyFileTool(action.tool)) return 'deny';
      relative = inProject;
      rootDir = action.projectDir ?? null;
    }
  } else {
    relative = normalizePath(raw).replace(/^\.\//, '');
    rootDir = action.workspaceDir ?? action.projectDir ?? null;
  }

  const segments = relative.split('/').filter((segment) => segment && segment !== '.');
  if (segments.some((segment) => segment === '..')) return 'deny';
  const normalized = segments.length ? segments.join('/') : '.';

  const sensitive = sensitivePathVerdict(normalized);
  const verdicts: ProbeScopeVerdict[] = [
    scopeVerdictFor(request, normalized),
    realPathVerdict(request, raw, rootDir, realpath),
  ];
  if (sensitive) verdicts.push(sensitive);
  return worst(verdicts);
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
  evaluate(
    binding: ProbeScopeBinding | ProbeRequest | null | undefined,
    action: ProbeScopeAction,
    options?: ProbeScopeGuardOptions,
  ): ProbeScopeVerdict {
    const request: ProbeRequest | null = binding
      ? (((binding as ProbeScopeBinding).request ?? (binding as ProbeRequest)) as ProbeRequest)
      : null;
    if (!request || !request.scope) return 'deny';
    const effectiveWorkspace = action.workspaceDir ?? (binding as ProbeScopeBinding)?.workspaceDir ?? null;
    const effectiveProject = action.projectDir ?? (binding as ProbeScopeBinding)?.projectDir ?? null;
    const realpath = options?.realpath ?? defaultRealpath;
    const verdicts: ProbeScopeVerdict[] = [];

    if (action.path !== undefined && action.path !== null) {
      verdicts.push(pathVerdict(request, {
        ...action, workspaceDir: effectiveWorkspace, projectDir: effectiveProject,
      }, realpath));
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
