// gateway/src/core/goal/plan-package.ts
// PlanPackage 的纯类型、校验与规范化哈希层（spec §7.1 / §7.3）。
//
// 不变量：
// - Plan（waves）与 Goal Eval 是同一份计划产物的两条腿，必须一起提交批准；
// - 校验只做浅层结构检查（waves 的形状由既有 WavePlan 消费者继续把关）；
// - 哈希基于排序后的稳定 JSON：对象键顺序不影响结果，内容或数组顺序变化必然改变哈希；
// - 顶层无关字段（status / taskType / revision …）不参与哈希，便于整份计划产物直接入参。
//
// 这里只做纯计算，不读写文件、不调用 LLM。
//
// Task 15（条件式整链批准）：整包可以额外携带 `approvalMode` 与 `continuation`：
// - `two_stage`（缺省）：探针 → 报告 → 重新规划 → 用户批准最终计划（Task 14 语义）；
// - `full_chain`：计划同时给出实施计划（waves + goalEval）与探针，用户**一次批准整条链**；
//   探针结论全部解析为 continue 才直接实施，任何 reapprove / 未覆盖结论 / 整包改动
//   都会让批准作废并回到规划。
// 规则解析一律 fail-closed：没有命中规则 = 未预期结果 = 需要重新批准，绝不默认放行。

import { createHash } from 'crypto';

import { GoalEval, validateGoalEval } from './goal-eval';
import type { ProbeConclusion } from './probe';

export type PlanStrategy = 'quick' | 'collaborative';

export interface PlanPackage {
  waves: unknown;
  /** Required for collaborative/legacy plans; quick plans may omit it. */
  goalEval?: GoalEval;
  /** Tech Lead execution choice; absent means legacy collaborative. */
  strategy?: PlanStrategy;
  /** Task 15：批准模式；缺省 = two_stage（存量零迁移）。 */
  approvalMode?: PlanApprovalMode;
  /** Task 15：探针结论 → 下一步。键是探针 id，`default` 是所有未点名探针的兜底。 */
  continuation?: ProbeContinuationRules;
}

export type PlanApprovalMode = 'two_stage' | 'full_chain';

/** 探针结论驱动的下一步：continue = 直接实施；reapprove = 批准作废、回到规划。 */
export type ProbeContinuation = 'continue' | 'reapprove';

export type ProbeContinuationRules = Record<string, Partial<Record<ProbeConclusion, ProbeContinuation>>>;

export const APPROVAL_MODES: readonly PlanApprovalMode[] = ['two_stage', 'full_chain'];
export const PROBE_CONTINUATIONS: readonly ProbeContinuation[] = ['continue', 'reapprove'];
export const PROBE_CONCLUSIONS: readonly ProbeConclusion[] = ['supports', 'refutes', 'inconclusive'];
/** 未点名探针的兜底规则键（具体探针 id 优先）。 */
export const DEFAULT_CONTINUATION_KEY = 'default';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 稳定 JSON：对象键排序、跳过 undefined，数组保持原顺序（顺序是语义）。 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((key) => obj[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function normalizeWaves(raw: unknown): unknown {
  if (raw === undefined || raw === null) throw new Error('plan package requires waves');
  if (!Array.isArray(raw)) throw new Error('plan package waves must be an array');
  if (raw.length === 0) throw new Error('plan package requires at least one wave');
  const seen = new Set<string>();
  for (const wave of raw) {
    if (!isPlainObject(wave)) throw new Error('plan package wave must be an object');
    const id = clean(wave.id);
    if (!id) throw new Error('plan package wave id is required');
    if (seen.has(id)) throw new Error(`duplicate plan wave id: ${id}`);
    seen.add(id);
  }
  return raw;
}

function normalizeStrategy(raw: unknown): PlanStrategy | undefined {
  if (raw === undefined || raw === null) return undefined;
  const strategy = clean(raw);
  if (strategy !== 'quick' && strategy !== 'collaborative') {
    throw new Error(`plan package strategy must be quick|collaborative (got ${JSON.stringify(raw)})`);
  }
  return strategy;
}

function normalizeApprovalMode(raw: unknown): PlanApprovalMode | undefined {
  if (raw === undefined || raw === null) return undefined;
  const mode = clean(raw);
  if (!(APPROVAL_MODES as readonly string[]).includes(mode)) {
    throw new Error(`plan package approvalMode must be two_stage|full_chain (got ${JSON.stringify(raw)})`);
  }
  return mode as PlanApprovalMode;
}

/**
 * 校验并规范化 continuation 规则（Task 15）。
 * - 键：探针 id 或 `default`（去空白后非空）；
 * - 值：`supports|refutes|inconclusive` → `continue|reapprove`；
 * - 空规则对象 / 空表 → undefined（等于"没有规则"：full_chain 会被 driver 拒绝）。
 */
export function validateContinuationRules(input: unknown): ProbeContinuationRules | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isPlainObject(input)) throw new Error('plan package continuation must be an object');
  const out: ProbeContinuationRules = {};
  for (const [rawKey, rawRule] of Object.entries(input)) {
    const key = clean(rawKey);
    if (!key) throw new Error('plan package continuation keys must be non-empty');
    if (!isPlainObject(rawRule)) {
      throw new Error(`plan package continuation[${key}] must be an object`);
    }
    const rule: Partial<Record<ProbeConclusion, ProbeContinuation>> = {};
    for (const [rawConclusion, rawDecision] of Object.entries(rawRule)) {
      const conclusion = clean(rawConclusion);
      if (!(PROBE_CONCLUSIONS as readonly string[]).includes(conclusion)) {
        throw new Error(`plan package continuation[${key}] has an unknown conclusion: ${rawConclusion}`);
      }
      const decision = clean(rawDecision);
      if (!(PROBE_CONTINUATIONS as readonly string[]).includes(decision)) {
        throw new Error(`plan package continuation[${key}].${conclusion} must be continue|reapprove`);
      }
      rule[conclusion as ProbeConclusion] = decision as ProbeContinuation;
    }
    if (Object.keys(rule).length) out[key] = rule;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * 校验并规范化 PlanPackage（waves 与 GoalEval 必须同时合法）。
 * 返回 `{ waves, goalEval, approvalMode?, continuation? }`：waves 原样携带（由既有消费者
 * 继续深入校验），goalEval 已规范化（trim / 去重 / mapping 按条件顺序重建）。
 */
export function validatePlanPackage(input: unknown): PlanPackage {
  if (!isPlainObject(input)) throw new Error('plan package must be an object');
  const waves = normalizeWaves(input.waves);
  const strategy = normalizeStrategy(input.strategy);
  const approvalMode = normalizeApprovalMode(input.approvalMode);
  const continuation = validateContinuationRules(input.continuation);
  if (strategy === 'quick' && (approvalMode || continuation)) {
    throw new Error('quick plan package cannot carry full-chain approval or continuation rules');
  }
  const goalEval = strategy === 'quick' && input.goalEval === undefined
    ? undefined
    : validateGoalEval(input.goalEval);
  return {
    waves,
    ...(goalEval ? { goalEval } : {}),
    ...(strategy ? { strategy } : {}),
    ...(approvalMode ? { approvalMode } : {}),
    ...(continuation ? { continuation } : {}),
  };
}

/**
 * waves 部分的规范化哈希（planApproval.planHash 用）。
 * 规范化边界：先过 `normalizeWaves`，因此哈希只取决于合法 waves 的内容。
 */
export function computeWavesHash(waves: unknown): string {
  return sha256({ kind: 'plan-waves', waves: normalizeWaves(waves) });
}

/**
 * GoalEval 部分的规范化哈希（planApproval.evalHash 用）。
 * 规范化边界：先过 `validateGoalEval`（trim / 去重 / mapping 按条件顺序重建），
 * 因此 `computeGoalEvalHash(raw)` === `computeGoalEvalHash(validateGoalEval(raw))`；
 * 非法 eval 直接抛错，绝不把「未规范化」的形态算进权威哈希。
 */
export function computeGoalEvalHash(goalEval: GoalEval | unknown): string {
  return sha256({ kind: 'goal-eval', goalEval: validateGoalEval(goalEval) });
}

/**
 * 整包哈希：只取 `waves` 与 `goalEval` 两个字段，其余顶层字段（status / taskType /
 * revision …）不参与——计划产物整体可以原样传入。
 *
 * Task 15：`full_chain` 的整包哈希额外覆盖 `approvalMode` 与 `continuation`——用户批准的
 * 是"哪条链"（实施计划 + 探针规则），规则改了就是另一个包。two_stage 的哈希保持原样，
 * 存量批准不会因为本次改动变 stale。
 *
 * 规范化边界：内部走 `validatePlanPackage`，所以
 * `computePlanPackageHash(raw)` === `computePlanPackageHash(validatePlanPackage(raw))`。
 * 批准绑定用同一个边界重算，就不会因为「存的是规范化产物、算的是原始输入」而误判 stale。
 */
export function computePlanPackageHash(pkg: PlanPackage | Record<string, unknown>): string {
  const normalized = validatePlanPackage(pkg);
  const fullChain = normalized.approvalMode === 'full_chain';
  return sha256({
    kind: 'plan-package',
    waves: normalized.waves,
    ...(normalized.goalEval ? { goalEval: normalized.goalEval } : {}),
    ...(normalized.strategy ? { strategy: normalized.strategy } : {}),
    ...(fullChain ? {
      approvalMode: 'full_chain' as const,
      continuation: normalized.continuation ?? {},
    } : {}),
  });
}

/**
 * 解析一条探针结论的下一步（Task 15）：具体探针 id 优先，其次 `default` 兜底。
 * 返回 null = 没有规则覆盖（未预期结果）——调用方必须按"需要重新批准"处理。
 */
export function probeContinuationRules(
  rules: ProbeContinuationRules | undefined | null,
  probeId: string,
  conclusion: ProbeConclusion,
): ProbeContinuation | null {
  if (!rules) return null;
  const id = clean(probeId);
  const exact = id ? rules[id]?.[conclusion] : undefined;
  if (exact) return exact;
  return rules[DEFAULT_CONTINUATION_KEY]?.[conclusion] ?? null;
}

export interface ProbeContinuationResult {
  probeId: string;
  conclusion: ProbeConclusion;
}

/** 整链判定结果：continue = 所有结论都允许直接实施；reapprove = 批准作废、回规划。 */
export type ContinuationVerdict =
  | { status: 'continue' }
  | {
    status: 'reapprove';
    reason: string;
    probeId?: string;
    /** 命中的规则值；null = 没有任何规则覆盖该结论（未预期结果）。 */
    decision?: ProbeContinuation | null;
  };

/**
 * 整链判定（Task 15 的 invalidation result）：全部结论都解析为 continue 才继续实施。
 * 以下任一情况都判 reapprove（fail-closed）：
 * - 整包哈希与批准时不一致（计划/规则被改写 = 范围变化）；
 * - 任一结论显式 reapprove；
 * - 任一结论没有规则覆盖（未预期结果）。
 */
export function evaluateProbeContinuation(input: {
  rules?: ProbeContinuationRules | null;
  results: ProbeContinuationResult[];
  packageHash?: string | null;
  currentPackageHash?: string | null;
}): ContinuationVerdict {
  if (input.packageHash != null && input.packageHash !== (input.currentPackageHash ?? null)) {
    return {
      status: 'reapprove',
      reason: 'approved plan package changed (waves, goal eval, approval mode or continuation rules)',
    };
  }
  for (const result of input.results) {
    const decision = probeContinuationRules(input.rules, result.probeId, result.conclusion);
    if (decision === 'continue') continue;
    const probeId = clean(result.probeId);
    if (decision === 'reapprove') {
      return {
        status: 'reapprove',
        probeId,
        decision,
        reason: `probe ${probeId} (${result.conclusion}) requires re-approval`,
      };
    }
    return {
      status: 'reapprove',
      probeId,
      decision: null,
      reason: `probe ${probeId} (${result.conclusion}) has no continuation rule`,
    };
  }
  return { status: 'continue' };
}
