// gateway/src/core/goal/context-manifest.ts
// Worker 上下文的确定性装配与校验层（spec §10.1）。
//
// 不变量：
// - 阶段必需的基础文件由代码自动纳入，Lead 不能漏选；
// - 可选文件与跨 Goal 引用必须存在、可读且通过同一范围校验；
// - 跨 Goal 引用只有 Lead 显式 allowlist 才允许，未授权一律抛错；
// - 清单只列文件，不混入长期记忆、任务板状态或其它 Goal 的讨论；
// - 同一输入渲染出同一字符串（可持久化、可用于 Session 恢复）。

/** 当前 manifest 的 schema 版本。 */
export const CONTEXT_MANIFEST_VERSION = 1;

export type GoalContextStage =
  | 'discussing'
  | 'direction_review'
  | 'planning'
  | 'plan_review'
  | 'implementing'
  | 'reviewing'
  | 'probe';

/** NodeDriver 节点名（Task 17 直接传节点名也能得到同一基线）。 */
export type GoalContextNode = 'plan' | 'execute' | 'review';

export type ContextRefScope = 'goal' | 'project' | 'cross-goal';

export interface ContextRefInput {
  /** Goal 内（或项目内）相对路径；不允许绝对路径、`..` 与 NUL。 */
  path: string;
  scope?: ContextRefScope | null;
  /** 跨 Goal 引用的归属 Goal id（显式写法）。 */
  goalId?: string | null;
  revision?: number | null;
  label?: string | null;
  required?: boolean | null;
  /** 显式标记跨 Goal（等价于 `scope: 'cross-goal'`）。 */
  crossGoal?: boolean | null;
}

export interface ContextManifestRef {
  /** 归属范围内的相对路径。 */
  path: string;
  /** 渲染/审计用的完整路径：`<goalId>/<path>`、`project:<path>`。 */
  displayPath: string;
  goalId: string | null;
  scope: ContextRefScope;
  crossGoal: boolean;
  required: boolean;
  /** 由阶段基线自动纳入（不可被 Lead 漏选）。 */
  baseline: boolean;
  revision: number | null;
  label: string | null;
  key: string;
}

export interface ContextManifest {
  version: number;
  goalId: string;
  revision: number | null;
  stage: GoalContextStage;
  role: string | null;
  required: ContextManifestRef[];
  optional: ContextManifestRef[];
  crossGoal: ContextManifestRef[];
}

export interface ContextManifestInput {
  goalId?: string | null;
  revision?: number | null;
  stage?: GoalContextStage | GoalContextNode | null;
  role?: string | null;
  required?: ContextRefInput[] | null;
  optional?: ContextRefInput[] | null;
  allowedCrossGoalRefs?: Array<string | ContextRefInput> | null;
  /** 接线层（Task 17）注入的存在性/可读性检查；纯测试可省略。 */
  exists?: ((ref: ContextManifestRef) => boolean) | null;
}

const STAGE_BASELINE: Record<GoalContextStage, readonly string[]> = {
  discussing: ['goal.md', 'request.json'],
  direction_review: ['goal.md', 'request.json', 'direction.json'],
  planning: ['goal.md', 'request.json', 'direction.json'],
  plan_review: ['goal.md', 'request.json', 'direction.json', 'waves.json', 'goal-eval.json'],
  implementing: ['goal.md', 'request.json', 'direction.json', 'waves.json', 'goal-eval.json'],
  reviewing: ['goal.md', 'request.json', 'direction.json', 'waves.json', 'goal-eval.json'],
  probe: ['goal.md', 'direction.json', 'waves.json'],
};

const NODE_STAGE: Record<GoalContextNode, GoalContextStage> = {
  plan: 'planning',
  execute: 'implementing',
  review: 'reviewing',
};

const STAGES = new Set<string>(Object.keys(STAGE_BASELINE));

export function normalizeContextStage(
  stage: GoalContextStage | GoalContextNode | null | undefined,
): GoalContextStage {
  const value = typeof stage === 'string' ? stage.trim() : '';
  if (!value) return 'planning';
  if (value in NODE_STAGE) return NODE_STAGE[value as GoalContextNode];
  if (STAGES.has(value)) return value as GoalContextStage;
  throw new Error(`unknown context stage: ${value}`);
}

/** 阶段基线（只读副本，供接线层解析真实文件位置）。 */
export function stageBaseline(stage: GoalContextStage | GoalContextNode): string[] {
  return [...STAGE_BASELINE[normalizeContextStage(stage)]];
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringOrNull(value: unknown): string | null {
  const text = clean(value);
  return text ? text : null;
}

function normalizeRevision(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`invalid context revision: ${String(value)}`);
  }
  return value;
}

/** 归一化引用路径：拒绝绝对路径、NUL、`..` 越界；`\` 统一成 `/`。 */
function normalizeContextPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('context reference path is required');
  }
  if (raw.includes('\0')) {
    throw new Error('context reference contains invalid characters');
  }
  const unified = raw.trim().replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[A-Za-z]:\//.test(unified)) {
    throw new Error(`context reference must be relative: ${raw}`);
  }
  const segments: string[] = [];
  for (const segment of unified.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      throw new Error(`context reference escapes goal root: ${raw}`);
    }
    segments.push(segment);
  }
  if (segments.length === 0) throw new Error('context reference path is required');
  return segments.join('/');
}

interface RefBuildContext {
  goalId: string;
  required: boolean;
  baseline: boolean;
}

function makeRef(
  path: string,
  ctx: RefBuildContext,
  opts: {
    goalId?: string | null;
    scope: ContextRefScope;
    revision?: number | null;
    label?: string | null;
    crossGoal?: boolean;
    baseline?: boolean;
    required?: boolean;
  },
): ContextManifestRef {
  const goalId = opts.goalId ?? null;
  const crossGoal = !!opts.crossGoal;
  const baseline = !!opts.baseline;
  const required = !!opts.required;
  const scope = opts.scope;
  const displayPath = scope === 'project'
    ? `project:${path}`
    : goalId
      ? `${goalId}/${path}`
      : path;
  const key = `${scope}|${goalId ?? ''}|${path}`;
  return {
    path,
    displayPath,
    goalId,
    scope,
    crossGoal,
    required,
    baseline,
    revision: opts.revision ?? null,
    label: opts.label ?? null,
    key,
  };
}

/**
 * 解析单条引用。
 *
 * 约定（fail-closed）：
 * - 单段路径（`goal.md`）或显式 `scope: 'goal'` = 当前 Goal 内文件；
 * - `<goalId>/<path>` 且首段不是当前 Goal = 跨 Goal 引用（必须 allowlist）；
 * - `scope: 'project'` = 项目根内文件（不需要跨 Goal 授权）；
 * - 未知的作用范围一律按跨 Goal 处理，绝不放行到其它 Goal 的讨论。
 */
function buildRef(
  raw: ContextRefInput,
  ctx: RefBuildContext,
  declaredScope: boolean,
): ContextManifestRef {
  const path = normalizeContextPath(raw?.path);
  const segments = path.split('/');
  const declaredGoal = stringOrNull(raw?.goalId);

  const base = {
    revision: normalizeRevision(raw?.revision),
    label: stringOrNull(raw?.label),
    baseline: ctx.baseline,
  };

  if (raw?.scope === 'project') {
    return makeRef(path, ctx, {
      ...base,
      scope: 'project',
      goalId: null,
      required: ctx.required || !!raw?.required,
    });
  }

  let crossGoal = raw?.crossGoal === true || raw?.scope === 'cross-goal';
  if (declaredGoal && ctx.goalId && declaredGoal !== ctx.goalId) crossGoal = true;

  if (!crossGoal && !declaredScope && !declaredGoal) {
    // 无显式声明时按路径形状推断：单段=本 Goal，`<current>/...`=本 Goal，其它首段=跨 Goal。
    if (segments.length > 1 && (!ctx.goalId || segments[0] !== ctx.goalId)) {
      crossGoal = true;
    }
  }

  const stripPrefix = (goalId: string): string => (
    segments.length > 1 && segments[0] === goalId ? segments.slice(1).join('/') : path
  );

  if (crossGoal) {
    const goalId = declaredGoal
      ?? (segments.length > 1 ? segments[0] : null);
    if (!goalId) throw new Error(`cross-goal reference requires a goal id: ${path}`);
    const relative = stripPrefix(goalId);
    if (ctx.goalId && goalId === ctx.goalId) {
      // 显式写成本 Goal 前缀的「跨 Goal」引用其实是本 Goal 文件。
      return makeRef(relative, ctx, {
        ...base,
        scope: 'goal',
        goalId: ctx.goalId,
        required: ctx.required || !!raw?.required,
      });
    }
    return makeRef(relative, ctx, {
      ...base,
      scope: 'cross-goal',
      goalId,
      crossGoal: true,
      required: ctx.required || !!raw?.required,
    });
  }

  const goalId = ctx.goalId || declaredGoal || null;
  const relative = goalId ? stripPrefix(goalId) : path;
  return makeRef(relative, ctx, {
    ...base,
    scope: 'goal',
    goalId,
    required: ctx.required || !!raw?.required,
  });
}

interface CrossGoalAllowlist {
  goals: Set<string>;
  paths: Set<string>;
}

function buildAllowlist(
  entries: Array<string | ContextRefInput> | null | undefined,
): CrossGoalAllowlist {
  const goals = new Set<string>();
  const paths = new Set<string>();
  for (const entry of entries ?? []) {
    if (typeof entry === 'string') {
      const text = entry.trim();
      if (!text) throw new Error('cross-goal allowlist entry is required');
      const slash = text.indexOf('/');
      const goalId = clean(slash === -1 ? text : text.slice(0, slash));
      const rest = slash === -1 ? null : text.slice(slash + 1);
      if (!goalId) throw new Error(`invalid cross-goal allowlist entry: ${text}`);
      if (rest === null || rest.trim() === '*' || rest.trim() === '') {
        goals.add(goalId);
      } else {
        paths.add(`${goalId}/${normalizeContextPath(rest)}`);
      }
      continue;
    }
    if (entry && typeof entry === 'object') {
      const goalId = clean(entry.goalId);
      if (!goalId) throw new Error('cross-goal allowlist entry requires a goal id');
      const path = entry.path === '*' || entry.path === undefined || entry.path === null
        ? null
        : normalizeContextPath(entry.path);
      if (path === null) goals.add(goalId);
      else paths.add(`${goalId}/${path}`);
    }
  }
  return { goals, paths };
}

function isAllowed(ref: ContextManifestRef, allowlist: CrossGoalAllowlist): boolean {
  if (!ref.goalId) return false;
  if (allowlist.goals.has(ref.goalId)) return true;
  return allowlist.paths.has(`${ref.goalId}/${ref.path}`);
}

/**
 * 构造 ContextManifest。阶段基线永远先纳入；随后是显式 required / optional。
 * 跨 Goal 引用必须在 `allowedCrossGoalRefs` 中（精确路径、`goalId` 或 `goalId\/*`）。
 */
export function buildContextManifest(input: ContextManifestInput = {}): ContextManifest {
  const goalId = clean(input.goalId);
  const revision = normalizeRevision(input.revision);
  const stage = normalizeContextStage(input.stage);
  const role = stringOrNull(input.role);

  const refs = new Map<string, ContextManifestRef>();
  const order: string[] = [];
  const add = (ref: ContextManifestRef): void => {
    const existing = refs.get(ref.key);
    if (!existing) {
      refs.set(ref.key, ref);
      order.push(ref.key);
      return;
    }
    // 去重时「必需/基线」永远胜出：绝不能靠 optional 覆盖或降级基线。
    existing.required = existing.required || ref.required;
    existing.baseline = existing.baseline || ref.baseline;
  };

  for (const path of STAGE_BASELINE[stage]) {
    add(buildRef({ path, scope: 'goal' }, {
      goalId,
      required: true,
      baseline: true,
    }, true));
  }

  for (const raw of input.required ?? []) {
    add(buildRef(raw, { goalId, required: true, baseline: false }, raw?.scope != null || raw?.goalId != null));
  }
  for (const raw of input.optional ?? []) {
    add(buildRef(raw, { goalId, required: false, baseline: false }, raw?.scope != null || raw?.goalId != null));
  }

  const allowlist = buildAllowlist(input.allowedCrossGoalRefs);

  const all = order.map((key) => refs.get(key)!);
  for (const ref of all) {
    if (!ref.crossGoal) continue;
    if (!isAllowed(ref, allowlist)) {
      throw new Error(`cross-goal reference not allowed: ${ref.displayPath}`);
    }
  }

  if (input.exists) {
    for (const ref of all) {
      if (input.exists(ref)) continue;
      if (ref.required) throw new Error(`required context missing: ${ref.displayPath}`);
      throw new Error(`context reference not readable: ${ref.displayPath}`);
    }
  }

  return {
    version: CONTEXT_MANIFEST_VERSION,
    goalId,
    revision,
    stage,
    role,
    required: all.filter((ref) => !ref.crossGoal && ref.required),
    optional: all.filter((ref) => !ref.crossGoal && !ref.required),
    crossGoal: all.filter((ref) => ref.crossGoal),
  };
}

/** 确定性渲染：文件是唯一权威，禁止用记忆/任务板/其它 Goal 脑补。 */
export function renderContextManifest(manifest: ContextManifest): string {
  const lines: string[] = ['[CONTEXT MANIFEST]'];
  lines.push(`goal: ${manifest.goalId || '(unset)'}`);
  if (manifest.revision != null) lines.push(`revision: ${manifest.revision}`);
  lines.push(`stage: ${manifest.stage}`);
  if (manifest.role) lines.push(`role: ${manifest.role}`);
  lines.push('authority: these files are the only authoritative context; do not blend memory, task-board state, or other Goals\' discussions.');
  lines.push('');

  lines.push('Required (baseline included):');
  if (manifest.required.length === 0) lines.push('- (none)');
  for (const ref of manifest.required) {
    lines.push(`- ${ref.displayPath}${ref.baseline ? ' (baseline)' : ''}${ref.label ? ` — ${ref.label}` : ''}`);
  }

  if (manifest.optional.length > 0) {
    lines.push('');
    lines.push('Optional:');
    for (const ref of manifest.optional) {
      lines.push(`- ${ref.displayPath}${ref.label ? ` — ${ref.label}` : ''}`);
    }
  }

  if (manifest.crossGoal.length > 0) {
    lines.push('');
    lines.push('Cross-goal (explicitly allowed):');
    for (const ref of manifest.crossGoal) {
      lines.push(`- ${ref.displayPath}${ref.required ? ' (required)' : ''}${ref.label ? ` — ${ref.label}` : ''}`);
    }
  }

  return lines.join('\n');
}
