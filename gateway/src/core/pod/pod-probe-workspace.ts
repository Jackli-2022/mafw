// gateway/src/core/pod/pod-probe-workspace.ts
// Spike 隔离工作区（spec §6.5）。
//
// 不变量：
// - 工作区目录**永远在主项目之外**（默认 `<tmp>/mafw-probes/<project>-<goal>-<probe>-<rand>`）；
//   探针只在这个目录里写文件，主工作区保持只读；
// - 目录名不来自未校验的输入：goalId/probeId 必须通过安全标识符校验，否则拒绝建目录；
// - dispose 只删除自己创建的目录，并且再次校验它不在主项目内——即使调用方传入伪造的
//   workspace 对象，也绝不递归删除主项目（`rm -rf` 类事故的硬防线）；
// - 仓库代码不做 copy：探针要读源码时经 ProbeRequest.scope.paths 只读主项目，
//   写入一律落在隔离目录（避免复制大仓库与污染 .git）。
//
// 这里只做文件系统操作，不知道 Probe 状态机（服务层负责）。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface ProbeWorkspace {
  /** 隔离工作区绝对路径（探针会话的 cwd）。 */
  dir: string;
  /** 主项目绝对路径（只读来源；dispose 的安全边界）。 */
  projectDir: string;
  goalId: string;
  probeId: string;
}

export interface ProbeWorkspaceFactoryDeps {
  /**
   * 隔离根目录（默认 `<os.tmpdir()>/mafw-probes`）。
   * 测试/部署可覆盖；若解析后落在主项目内，prepare 一律拒绝。
   */
  baseDir?: string;
  /** 注入文件系统（测试用；缺省用 node:fs）。 */
  fs?: Pick<typeof fs, 'existsSync' | 'mkdirSync' | 'mkdtempSync' | 'realpathSync' | 'rmSync'>;
}

/**
 * `child` 是否位于 `parent` 内部（不含相等；Windows 大小写不敏感）。
 * 纯路径判断，不要求路径存在。
 */
export function isPathInside(child: string, parent: string): boolean {
  if (!child || !parent) return false;
  const base = path.resolve(parent);
  const target = path.resolve(child);
  const relative = path.relative(base, target);
  if (!relative) return false;
  if (path.isAbsolute(relative)) return false;
  return !relative.startsWith('..');
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function safeSegment(value: string, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!ID_PATTERN.test(text)) {
    throw new Error(`probe workspace ${field} must be a safe identifier`);
  }
  return text;
}

function resolveReal(input: string): string {
  const resolved = path.resolve(input);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Canonicalize a path that may no longer exist (e.g. a disposed workspace), by
 * realpath-ing its nearest existing ancestor and appending the rest. This keeps
 * Windows 8.3 short names (`RUNNER~1`) consistent with the long form after the
 * leaf directory is gone — otherwise the second (idempotent) dispose compares
 * a short path against a long base and refuses.
 */
function resolveRealLoose(input: string): string {
  let current = path.resolve(input);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(input);
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/** 临时目录名前缀：保留可读性（项目名 + goal + probe），不含分隔符。 */
function dirPrefix(projectDir: string, goalId: string, probeId: string): string {
  const project = path.basename(projectDir).replace(/[^A-Za-z0-9._-]/g, '_') || 'project';
  return `${project}--${goalId}--${probeId}--`.slice(0, 120);
}

export class ProbeWorkspaceFactory {
  private readonly baseDir: string;
  private readonly io: NonNullable<ProbeWorkspaceFactoryDeps['fs']>;

  constructor(deps: ProbeWorkspaceFactoryDeps = {}) {
    this.baseDir = path.resolve(deps.baseDir ?? path.join(os.tmpdir(), 'mafw-probes'));
    this.io = deps.fs ?? fs;
  }

  /**
   * 创建隔离工作区。目录已存在时由 `mkdtemp` 保证唯一；创建后再次校验它在主项目外，
   * 校验失败立即清理空目录并抛错（绝不留半个工作区）。
   */
  async prepare(projectDir: string, goalId: string, probeId: string): Promise<ProbeWorkspace> {
    if (typeof projectDir !== 'string' || !projectDir.trim()) {
      throw new Error('probe workspace projectDir is required');
    }
    const goal = safeSegment(goalId, 'goalId');
    const probe = safeSegment(probeId, 'probeId');
    const project = resolveReal(projectDir);
    // Canonicalize the base too (it may not exist yet): a short-name base would
    // otherwise look "outside" the long-name project and bypass the guard.
    const base = resolveRealLoose(this.baseDir);

    if (isPathInside(base, project) || samePath(base, project)) {
      throw new Error('probe workspace base directory must be outside the main project');
    }

    this.io.mkdirSync(base, { recursive: true });
    const dir = this.io.mkdtempSync(path.join(base, dirPrefix(project, goal, probe)));

    if (isPathInside(dir, project)) {
      this.io.rmSync(dir, { recursive: true, force: true });
      throw new Error('probe workspace must be outside the main project');
    }

    return { dir, projectDir: project, goalId: goal, probeId: probe };
  }

  /**
   * 删除隔离工作区。幂等；拒绝删除主项目、主项目内部，或工厂 baseDir 之外的任何路径
   * （伪造 workspace 对象 / 路径穿越都不能把 `rm -rf` 指向任意目录）。
   * realpath 解析符号链接后再判断：base 内的链接若指向 base 外，同样拒绝。
   */
  async dispose(workspace: ProbeWorkspace): Promise<void> {
    if (!workspace || typeof workspace.dir !== 'string' || !workspace.dir.trim()) return;
    const project = resolveRealLoose(workspace.projectDir);
    const dir = path.resolve(workspace.dir);
    const base = resolveRealLoose(this.baseDir);
    const target = resolveRealLoose(dir);

    if (samePath(target, project) || isPathInside(target, project)) {
      throw new Error(`refusing to dispose a probe workspace inside the main project: ${dir}`);
    }
    if (samePath(target, base) || !isPathInside(target, base)) {
      throw new Error(
        `refusing to dispose a probe workspace outside the factory base directory: ${dir}`,
      );
    }
    this.io.rmSync(dir, { recursive: true, force: true });
  }
}
