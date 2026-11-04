// gateway/src/mcp/handlers/pod-context-select.ts
// Task 17：Lead 唯一的「Worker 上下文选择」出口（MCP: mafw_pod_goal_context）。
//
// 语义（spec §10.1）：
// - 阶段必需的基础产物（goal.md / request.json / direction.json / waves.json / goal-eval.json）
//   由代码按阶段自动纳入，Lead 既不需要也不能漏选；
// - Lead 只能追加/移除**可选**补充与**跨 Goal** 引用；跨 Goal 还必须命中 Goal request 声明的
//   allowlist（`contextAllowlist`），未授权一律 `cross-goal reference not allowed`；
// - 任何引用都必须存在、可读、非敏感、且不逃逸归属根（fail-closed，绝不静默丢弃）；
// - 渲染出的清单是 Pod 文件产物：`<mafw>/goals/<goalId>/manifests/rev-<n>-<stage>.md`，
//   路径 + sha256 记入 `context-selection.json`，Session 恢复时复用同一份内容。
//
// 权限：只有绑定在该 Goal 所属 Pod 的 Lead 会话能调用（Tech Lead/Builder/Reviewer 不能
// 扩大自己的上下文）。
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolHandler } from '../../types';
import {
  buildContextManifest,
  renderContextManifest,
  normalizeContextStage,
  type ContextManifest,
  type ContextRefInput,
  type GoalContextNode,
} from '../../core/goal/context-manifest';
import {
  findGoalCharterPath,
  findGoalRequestPath,
  readGoalRequest,
} from '../../core/goal/goal-intake';
import { goalArtifactRoot, nodeArtifactPaths, goalEvalArtifactPath } from '../../core/goal/node-prompts';
import {
  PodError,
  isTerminalGoalRevisionStatus,
  type PodStore,
} from '../../core/pod/pod-store';

/** 选择文件的 schema 版本。 */
export const CONTEXT_SELECTION_VERSION = 1;
/** Goal 工作区内的选择文件（与 direction.json 同级）。 */
export const CONTEXT_SELECTION_FILE = 'context-selection.json';
/** 渲染后的清单产物目录（相对 Goal 工作区）。 */
export const CONTEXT_MANIFEST_DIR = 'manifests';

/** 节点 → 接收角色（清单里写明谁在读）。 */
const NODE_ROLE: Record<GoalContextNode | 'probe', string> = {
  plan: 'tech_lead',
  probe: 'builder',
  execute: 'builder',
  review: 'reviewer',
};

const SAFE_GOAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 与 goal-intake 的目录名约束同一形状：不放行 `..`、空段或路径分隔符。 */
function isSafeGoalId(value: unknown): boolean {
  const id = clean(value);
  return !!id && SAFE_GOAL_ID.test(id) && !id.includes('..');
}

/**
 * 阶段基线里「该阶段可能尚未产出」的文件：probe 在最终计划之前跑，waves.json 不存在是正常的
 * （仍然按真实路径列在清单里，供 Builder 知道最终产物会落在哪里）。
 * 其余基线的缺失一律 fail-closed——基线路径写错时不能靠「跳过检查」变得不可见。
 */
const DEFERRED_BASELINE: Record<string, string[]> = { probe: ['waves.json'] };

/**
 * 敏感引用（凭据/密钥/私钥/仓库内部状态）：永远不会被选进 worker 上下文。
 * 只做「整段命中」，避免把普通文件名（如 `environment.md`）误伤。
 */
const SENSITIVE_SEGMENTS = [
  /^\.env(\.|$)/i,
  /^\.git$/i,
  /^\.ssh$/i,
  /^\.npmrc$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.|$)/i,
  /\.(pem|key|pfx|p12|keystore|jks)$/i,
  /^secrets?(\.|$)/i,
  /^(credentials?|tokens?)(\.|$)/i,
  /^auth\.json$/i,
];

export interface PodContextSelectionDeps {
  store: Pick<
    PodStore,
    'getGoalByGoalId' | 'getGoalRevision' | 'getPod' | 'getMemberBySession'
  >;
  /** Goal 的 mafw 目录（组合根提供：state/request 两种布局都能解析）。 */
  resolveMafwDir(goalId: string): string | null;
  now?(): string;
  log?(message: string): void;
}

export interface PodContextSelectionInput {
  goalId: string;
  /** 缺省 = Goal 的 active revision。写选择只允许当前非终态 revision。 */
  revision?: number | null;
  /** 整组替换 Lead 的可选引用（`[]` = 清空）。 */
  refs?: ContextRefInput[] | null;
  /** 追加（按 path/displayPath 去重）。 */
  add?: ContextRefInput[] | null;
  /** 移除（path、`<goalId>/<path>` 或 displayPath 均可）。 */
  remove?: string[] | null;
}

export interface PodContextManifestRecord {
  path: string;
  hash: string;
  stage: string;
  at: string;
}

export interface PodContextSelectionEntry {
  refs: ContextRefInput[];
  updatedAt: string;
  updatedBy: string | null;
  manifest: PodContextManifestRecord | null;
}

export interface PodContextSelectionFile {
  version: number;
  goalId: string;
  revisions: Record<string, PodContextSelectionEntry>;
}

export interface PodContextSelectionResult {
  podId: string;
  goalId: string;
  revision: number;
  stage: string;
  refs: ContextRefInput[];
  manifest: ContextManifest;
  block: string;
  manifestPath: string;
  manifestHash: string;
}

interface GoalContext {
  podId: string;
  goalId: string;
  revision: number;
  mafwDir: string;
  goalDir: string;
  projectDir: string | null;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isSensitivePath(value: unknown): boolean {
  const segments = String(value ?? '').replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.some((segment) => SENSITIVE_SEGMENTS.some((re) => re.test(segment)));
}

function refKey(ref: ContextRefInput): string {
  const goalId = clean(ref?.goalId);
  const scope = clean(ref?.scope);
  const path = String(ref?.path ?? '').replace(/\\/g, '/').trim();
  return [scope, goalId, path].filter(Boolean).join('|');
}

function refAliases(ref: ContextRefInput, goalId: string): string[] {
  const raw = String(ref?.path ?? '').replace(/\\/g, '/').trim();
  const aliases = new Set<string>([raw]);
  if (clean(ref?.goalId)) aliases.add(`${clean(ref?.goalId)}/${raw}`);
  aliases.add(`${goalId}/${raw}`);
  return [...aliases];
}

/** 组合根注入的 store 只保证这四件事；其余状态在文件里。 */
export class PodContextSelectionService {
  constructor(private readonly deps: PodContextSelectionDeps) {}

  /** 读取某个 revision 的选择（坏文件 fail-open 空表；读取本身不写盘）。 */
  selection(goalId: string, revision: number): PodContextSelectionEntry | null {
    const found = this.resolveGoal(goalId);
    if (!found) return null;
    const doc = this.readSelection(found);
    return doc.revisions[String(revision)] ?? null;
  }

  /**
   * Lead 改写当前 revision 的可选上下文。
   * `refs` 整组替换；`add`/`remove` 增量修改；三者都不给 = 只重新校验并刷新清单产物。
   */
  async select(
    input: PodContextSelectionInput,
    actorSessionID: string,
  ): Promise<PodContextSelectionResult> {
    const goalId = clean(input?.goalId);
    if (!goalId) throw new PodError(400, 'goalId is required');
    const goal = this.deps.store.getGoalByGoalId(goalId);
    if (!goal) throw new PodError(404, `goal not found: ${goalId}`);
    const actor = clean(actorSessionID);
    const member = actor ? this.deps.store.getMemberBySession(actor) : null;
    // 只有绑定在该 Pod 的 Lead 能改上下文；Tech Lead/Builder/Reviewer 不能扩大自己的上下文。
    if (!member || member.role !== 'lead' || member.podId !== goal.podId) {
      throw new PodError(403, `only the project Lead can change the context of goal ${goalId}`);
    }

    const activeRevision = Number(goal.activeRevision ?? 1);
    const revision = input?.revision === undefined || input?.revision === null
      ? activeRevision
      : Number(input.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      throw new PodError(400, `invalid revision: ${String(input?.revision)}`);
    }
    const row = this.deps.store.getGoalRevision(goal.podId, goalId, revision);
    if (revision !== activeRevision) {
      throw new PodError(409, `revision ${revision} is not the active revision (${activeRevision})`);
    }
    if (!row) throw new PodError(404, `goal revision not found: ${goalId}#${revision}`);
    if (isTerminalGoalRevisionStatus(row.status)) {
      throw new PodError(409, `revision ${revision} is terminal (${row.status})`);
    }

    const found = this.resolveGoal(goalId);
    if (!found) throw new PodError(400, `goal workspace is unavailable for ${goalId}`);
    const context = { ...found, revision, podId: goal.podId };

    const current = this.readSelection(context).revisions[String(revision)]?.refs ?? [];
    const refs = this.normalizeSelectedRefs(context, this.mergeRefs(current, input));
    this.assertRefsSafe(refs);

    return this.buildAndPersist(context, refs, {
      updateRefs: true,
      actor,
    });
  }

  /**
   * 每个节点/探针 prompt 的清单块（driver 的 `contextBlock` 实现）。
   * revision 由在飞节点决定（可能是被驳回前的旧 revision），不做 active-revision 限制。
   */
  async renderForNode(input: {
    goalId: string;
    node: GoalContextNode | 'probe';
    revision: number;
  }): Promise<string> {
    const goalId = clean(input?.goalId);
    if (!goalId) throw new PodError(400, 'goalId is required');
    const revision = Number(input?.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      throw new PodError(400, `invalid revision: ${String(input?.revision)}`);
    }
    const goal = this.deps.store.getGoalByGoalId(goalId);
    if (!goal) throw new PodError(404, `goal not found: ${goalId}`);
    const found = this.resolveGoal(goalId);
    if (!found) throw new PodError(400, `goal workspace is unavailable for ${goalId}`);
    const context = { ...found, revision, podId: goal.podId };
    const stored = this.readSelection(context).revisions[String(revision)]?.refs ?? [];
    const refs = this.normalizeSelectedRefs(context, stored);
    this.assertRefsSafe(refs);
    const result = this.buildAndPersist(context, refs, {
      updateRefs: false,
      actor: null,
      stage: input.node,
    });
    return result.block;
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  private resolveGoal(goalId: string): GoalContext | null {
    if (!SAFE_GOAL_ID.test(goalId) || goalId.includes('..')) return null;
    const mafwDir = this.deps.resolveMafwDir(goalId);
    if (!mafwDir) return null;
    const goal = this.deps.store.getGoalByGoalId(goalId);
    const pod = goal ? this.deps.store.getPod(goal.podId) : null;
    return {
      podId: goal?.podId ?? '',
      goalId,
      revision: Number(goal?.activeRevision ?? 1),
      mafwDir,
      goalDir: path.join(mafwDir, 'goals', goalId),
      projectDir: pod?.projectDir ?? null,
    };
  }

  private mergeRefs(current: ContextRefInput[], input: PodContextSelectionInput): ContextRefInput[] {
    let refs: ContextRefInput[];
    if (Array.isArray(input?.refs)) {
      refs = [...input.refs];
    } else {
      refs = [...current];
    }
    for (const extra of input?.add ?? []) {
      const key = refKey(extra);
      if (!refs.some((ref) => refKey(ref) === key)) refs.push(extra);
    }
    const removals = (input?.remove ?? []).map((value) => clean(value)).filter(Boolean);
    if (removals.length > 0) {
      refs = refs.filter((ref) => {
        const aliases = refAliases(ref, clean(input?.goalId));
        return !removals.some((value) => aliases.includes(value));
      });
    }
    return refs;
  }

  private assertRefsSafe(refs: ContextRefInput[]): void {
    for (const ref of refs) {
      const declaredGoal = clean(ref?.goalId);
      if (declaredGoal && !isSafeGoalId(declaredGoal)) {
        throw new PodError(400, `invalid cross-goal goal id: ${declaredGoal}`);
      }
      const display = declaredGoal
        ? `${declaredGoal}/${String(ref?.path ?? '')}`
        : String(ref?.path ?? '');
      if (isSensitivePath(display)) {
        throw new PodError(400, `sensitive context reference rejected: ${display}`);
      }
    }
  }

  /**
   * Lead 选择的作用域推断（只在 Lead 没显式声明时生效）：
   * - 首段 = 当前 Goal → 本 Goal；
   * - 首段 = 另一个**真实存在**的 Goal 目录 → 跨 Goal（必须过 allowlist）；
   * - 其它多段路径 → 本 Goal 内的嵌套文件（Lead 选的是 Goal 工作区里的相对路径）。
   * 显式 `scope`/`goalId`/`crossGoal` 一律尊重，不被推断覆盖。
   */
  private normalizeSelectedRefs(context: GoalContext, refs: ContextRefInput[]): ContextRefInput[] {
    return refs.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      if (raw.scope != null || clean(raw.goalId) || raw.crossGoal === true) return raw;
      const segments = String(raw.path ?? '').replace(/\\/g, '/').trim().split('/').filter(Boolean);
      if (segments.length <= 1) return raw;
      const first = segments[0];
      if (first === context.goalId) return raw;
      let otherGoalDir = false;
      try {
        otherGoalDir = fs.statSync(path.join(context.mafwDir, 'goals', first)).isDirectory();
      } catch { otherGoalDir = false; }
      if (otherGoalDir) return raw; // 跨 Goal 推断交给 buildContextManifest（含 allowlist 校验）
      return { ...raw, scope: 'goal' as const };
    });
  }

  /** Goal request 声明的跨 Goal allowlist（未声明 = 任何跨 Goal 引用都被拒绝）。 */
  private crossGoalAllowlist(context: GoalContext): Array<string | ContextRefInput> {
    const request = readGoalRequest(context.mafwDir, context.goalId) ?? {};
    const raw = (request as any).contextAllowlist ?? (request as any).crossGoalRefs;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => {
        if (typeof entry === 'string') {
          const text = entry.trim();
          if (!text) throw new PodError(400, 'cross-goal allowlist entry is required');
          // `goalId` / `goalId/*` / `goalId/<path>`：首段必须是安全的 Goal id。
          const goalId = text.split('/')[0];
          if (!isSafeGoalId(goalId)) {
            throw new PodError(400, `invalid cross-goal allowlist goal id: ${goalId}`);
          }
          return text;
        }
        if (entry && typeof entry === 'object') {
          const ref = entry as ContextRefInput;
          if (!isSafeGoalId(ref.goalId)) {
            throw new PodError(400, `invalid cross-goal allowlist goal id: ${String(ref.goalId ?? '')}`);
          }
          return ref;
        }
        return null;
      })
      .filter((entry): entry is string | ContextRefInput => entry !== null);
  }

  private buildManifest(
    context: GoalContext,
    refs: ContextRefInput[],
    stage: string,
  ): ContextManifest {
    let normalizedStage: ReturnType<typeof normalizeContextStage>;
    try {
      normalizedStage = normalizeContextStage(stage as any);
    } catch (err: any) {
      throw new PodError(400, String(err?.message ?? err));
    }
    let manifest: ContextManifest;
    try {
      manifest = buildContextManifest({
        goalId: context.goalId,
        revision: context.revision,
        stage: normalizedStage,
        role: NODE_ROLE[(stage as GoalContextNode | 'probe')] ?? null,
        optional: refs,
        allowedCrossGoalRefs: this.crossGoalAllowlist(context),
        // 基线在下面单独按真实路径校验/改写（buildContextManifest 只认识逻辑名）。
        exists: (ref) => ref.baseline || this.refExists(ref, context),
      });
    } catch (err: any) {
      throw new PodError(400, String(err?.message ?? err));
    }
    // 跨 Goal 的 goalId 也可能是从路径首段推断出来的：统一再校验一次，绝不 join 到 goals 外。
    for (const ref of [...manifest.optional, ...manifest.crossGoal]) {
      if (ref.crossGoal && !isSafeGoalId(ref.goalId)) {
        throw new PodError(400, `invalid cross-goal goal id: ${String(ref.goalId ?? '')}`);
      }
    }
    return this.resolveBaselinePaths(manifest, context, normalizedStage);
  }

  /**
   * 基线的逻辑名 → 真实文件路径（并在渲染前校验存在性）。
   *
   * 布局差异（Task 12/13 的产物隔离）：
   * - `goal.md` / `request.json` / `direction.json` → `<mafw>/goals/<goalId>/`
   * - `waves.json`：rev1 在 `<mafw>/waves.json`，rev≥2 在 `<mafw>/revisions/<goalId>/rev-N/waves.json`
   * - `goal-eval.json`：rev1 在 `<mafw>/goals/<goalId>/`，rev≥2 与 waves 同目录
   * 只在 `DEFERRED_BASELINE` 列出的阶段允许「尚未产出」，其它缺失直接拒绝。
   */
  private resolveBaselinePaths(
    manifest: ContextManifest,
    context: GoalContext,
    stage: string,
  ): ContextManifest {
    const deferred = [...(DEFERRED_BASELINE[stage] ?? [])];
    // quick 计划包允许不带 goalEval（validatePlanPackage 的契约），所以 implementing /
    // reviewing 阶段在 waves.strategy === 'quick' 时不得把 goal-eval.json 当硬前置。
    if ((stage === 'implementing' || stage === 'reviewing') && this.isQuickPlan(context)) {
      deferred.push('goal-eval.json');
    }
    const missing: string[] = [];
    const required = manifest.required.map((ref) => {
      if (!ref.baseline) return ref;
      const file = this.baselinePath(context, ref.path);
      const displayPath = this.displayBaselinePath(context, file);
      const readable = this.isReadableFile(file);
      if (!readable && !deferred.includes(ref.path)) missing.push(displayPath);
      return { ...ref, displayPath };
    });
    if (missing.length > 0) {
      throw new PodError(400, `required context missing: ${missing[0]}`);
    }
    return { ...manifest, required };
  }

  private isQuickPlan(context: GoalContext): boolean {
    try {
      const waves = nodeArtifactPaths(context.mafwDir, context.goalId, 1, { revision: context.revision }).waves;
      if (!this.isReadableFile(waves)) return false;
      const raw = JSON.parse(fs.readFileSync(waves, 'utf-8'));
      return raw?.strategy === 'quick';
    } catch {
      return false;
    }
  }

  private baselinePath(context: GoalContext, name: string): string {
    switch (name) {
      case 'goal.md':
        return findGoalCharterPath(context.mafwDir, context.goalId)
          ?? path.join(context.goalDir, 'goal.md');
      case 'request.json':
        return findGoalRequestPath(context.mafwDir, context.goalId)
          ?? path.join(context.goalDir, 'request.json');
      case 'direction.json':
        return path.join(context.goalDir, 'direction.json');
      case 'waves.json':
        return nodeArtifactPaths(context.mafwDir, context.goalId, 1, { revision: context.revision }).waves;
      case 'goal-eval.json':
        return goalEvalArtifactPath(context.mafwDir, context.goalId, context.revision);
      default:
        return path.join(context.goalDir, name);
    }
  }

  /** 渲染用路径：mafw 根内用相对路径（与 OS 无关、可持久化），根外用绝对路径。 */
  private displayBaselinePath(context: GoalContext, file: string): string {
    const relative = path.relative(context.mafwDir, file);
    const inside = !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    return (inside ? relative : file).replace(/\\/g, '/');
  }

  private isReadableFile(file: string): boolean {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }

  /** 引用是否真实存在且可读（相对归属根解析；越界路径 build 阶段已被拒）。 */
  private refExists(ref: ContextManifest['required'][number], context: GoalContext): boolean {
    const candidates: string[] = [];
    if (ref.scope === 'project') {
      if (context.projectDir) candidates.push(path.join(context.projectDir, ref.path));
    } else if (ref.scope === 'cross-goal' && ref.goalId) {
      if (!isSafeGoalId(ref.goalId)) return false;
      candidates.push(path.join(context.mafwDir, 'goals', ref.goalId, ref.path));
    } else {
      candidates.push(path.join(context.goalDir, ref.path));
      // revision 1 的 waves 等仍落在 mafw 根（legacy 布局），rev ≥2 落在 revisions/ 下。
      candidates.push(path.join(goalArtifactRoot(context.mafwDir, context.goalId, context.revision), ref.path));
    }
    for (const candidate of candidates) {
      if (this.isReadableFile(candidate)) return true;
    }
    return false;
  }

  private buildAndPersist(
    context: GoalContext,
    refs: ContextRefInput[],
    opts: { updateRefs: boolean; actor: string | null; stage?: string },
  ): PodContextSelectionResult {
    const stage = opts.stage
      ? normalizeContextStage(opts.stage as any)
      : normalizeContextStage('discussing');
    const manifest = this.buildManifest(context, refs, stage);
    const block = renderContextManifest(manifest);
    const now = this.now();
    const doc = this.readSelection(context);
    const key = String(context.revision);
    const entry: PodContextSelectionEntry = doc.revisions[key] ?? {
      refs: [], updatedAt: now, updatedBy: null, manifest: null,
    };
    if (opts.updateRefs) {
      entry.refs = refs;
      entry.updatedAt = now;
      entry.updatedBy = opts.actor;
    }
    const manifestDir = path.join(context.goalDir, CONTEXT_MANIFEST_DIR);
    fs.mkdirSync(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, `rev-${context.revision}-${stage}.md`);
    fs.writeFileSync(manifestPath, block, 'utf-8');
    const manifestHash = `sha256:${crypto.createHash('sha256').update(block, 'utf8').digest('hex')}`;
    entry.manifest = { path: manifestPath, hash: manifestHash, stage, at: now };
    doc.revisions[key] = entry;
    this.writeSelection(context, doc);
    return {
      podId: context.podId,
      goalId: context.goalId,
      revision: context.revision,
      stage,
      refs: entry.refs,
      manifest,
      block,
      manifestPath,
      manifestHash,
    };
  }

  private selectionPath(context: GoalContext): string {
    return path.join(context.goalDir, CONTEXT_SELECTION_FILE);
  }

  private readSelection(context: GoalContext): PodContextSelectionFile {
    const target = this.selectionPath(context);
    if (!fs.existsSync(target)) {
      return { version: CONTEXT_SELECTION_VERSION, goalId: context.goalId, revisions: {} };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
      const revisions = parsed && typeof parsed.revisions === 'object' && parsed.revisions
        ? parsed.revisions as Record<string, PodContextSelectionEntry>
        : {};
      for (const [key, entry] of Object.entries(revisions)) {
        if (!entry || typeof entry !== 'object') {
          delete revisions[key];
          continue;
        }
        if (!Array.isArray(entry.refs)) entry.refs = [];
      }
      return {
        version: CONTEXT_SELECTION_VERSION,
        goalId: context.goalId,
        revisions,
      };
    } catch (err: any) {
      // 坏文件不阻断节点（fail-open 空选择）；下一次 Lead 选择会整体重写。
      this.deps.log?.(`[Pod] context selection unreadable for ${context.goalId}: ${err?.message ?? err}`);
      return { version: CONTEXT_SELECTION_VERSION, goalId: context.goalId, revisions: {} };
    }
  }

  private writeSelection(context: GoalContext, doc: PodContextSelectionFile): void {
    const target = this.selectionPath(context);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
    fs.renameSync(tmp, target);
  }

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }
}

// ── MCP tool ─────────────────────────────────────────────────────────────

export interface PodGoalContextArgs {
  goalId: string;
  revision?: number;
  refs?: ContextRefInput[];
  add?: ContextRefInput[];
  remove?: string[];
  /** MCP 不携带调用者身份，故显式传会话 id（缺省时取 handler 上下文）。 */
  sessionID?: string;
}

export interface PodGoalContextToolContext {
  sessionID?: string;
}

function ok(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function createPodGoalContextTool(service: PodContextSelectionService) {
  return {
    async execute(args: PodGoalContextArgs, ctx: PodGoalContextToolContext = {}) {
      const goalId = clean(args?.goalId);
      if (!goalId) throw new PodError(400, 'goalId is required');
      const sessionID = clean(args?.sessionID) || clean(ctx?.sessionID);
      if (!sessionID) {
        throw new PodError(403, `only the project Lead can change the context of goal ${goalId}`);
      }
      const result = await service.select({
        goalId,
        revision: args?.revision ?? null,
        refs: Array.isArray(args?.refs) ? args.refs : null,
        add: Array.isArray(args?.add) ? args.add : null,
        remove: Array.isArray(args?.remove) ? args.remove : null,
      }, sessionID);
      const display = (refs: ContextManifest['optional']) => refs.map((ref) => ref.displayPath);
      return ok({
        success: true,
        podId: result.podId,
        goalId: result.goalId,
        revision: result.revision,
        stage: result.stage,
        required: display(result.manifest.required),
        optional: display(result.manifest.optional),
        crossGoal: display(result.manifest.crossGoal),
        manifestPath: result.manifestPath,
        manifestHash: result.manifestHash,
        block: result.block,
      });
    },
  };
}

function errorPayload(error: unknown) {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : undefined;
  const payload = {
    success: false,
    ...(status ? { status } : {}),
    error: String((error as any)?.message ?? error),
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: true,
    structuredContent: payload,
  };
}

/** MCP handler：组合根把 PodContextSelectionService 放进 services。 */
export const handlePodGoalContext: ToolHandler = async (args, services) => {
  const candidate: any = (services as any)?.podContextSelect
    ?? (services as any)?.podCollaboration?.contextSelect
    ?? null;
  const service: PodContextSelectionService | null = candidate && typeof candidate.select === 'function'
    ? candidate as PodContextSelectionService
    : candidate?.service ?? null;
  if (!service) return errorPayload(new PodError(503, 'pod goal context is unavailable'));
  const tool = createPodGoalContextTool(service);
  try {
    return await tool.execute(args as unknown as PodGoalContextArgs, {
      sessionID: typeof args?.sessionID === 'string'
        ? args.sessionID
        : (typeof (services as any)?.sessionID === 'string' ? (services as any).sessionID : undefined),
    });
  } catch (error) {
    return errorPayload(error);
  }
};
