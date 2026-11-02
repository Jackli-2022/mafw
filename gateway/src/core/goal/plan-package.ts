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

import { createHash } from 'crypto';

import { GoalEval, validateGoalEval } from './goal-eval';

export interface PlanPackage {
  waves: unknown;
  goalEval: GoalEval;
}

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

/**
 * 校验并规范化 PlanPackage（waves 与 GoalEval 必须同时合法）。
 * 返回 `{ waves, goalEval }`：waves 原样携带（由既有消费者继续深入校验），
 * goalEval 已规范化（trim / 去重 / mapping 按条件顺序重建）。
 */
export function validatePlanPackage(input: unknown): PlanPackage {
  if (!isPlainObject(input)) throw new Error('plan package must be an object');
  const waves = normalizeWaves(input.waves);
  const goalEval = validateGoalEval(input.goalEval);
  return { waves, goalEval };
}

/** waves 部分的规范化哈希（planApproval.planHash 用）。 */
export function computeWavesHash(waves: unknown): string {
  return sha256({ kind: 'plan-waves', waves });
}

/** GoalEval 部分的规范化哈希（planApproval.evalHash 用）。 */
export function computeGoalEvalHash(goalEval: GoalEval | unknown): string {
  return sha256({ kind: 'goal-eval', goalEval });
}

/**
 * 整包哈希：只取 `waves` 与 `goalEval` 两个字段，其余顶层字段（status / taskType /
 * revision …）不参与——计划产物整体可以原样传入。
 */
export function computePlanPackageHash(pkg: PlanPackage | Record<string, unknown>): string {
  const source = (pkg ?? {}) as Record<string, unknown>;
  return sha256({ kind: 'plan-package', waves: source.waves, goalEval: source.goalEval });
}
