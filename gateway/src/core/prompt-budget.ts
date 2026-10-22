/**
 * Per-prompt 预算裁决（P0-2，2026-10-22 契约缺口研究接线修复）。
 *
 * 背景：`SessionPromptOpts.maxTurns/maxCostUsd` 契约字段长期存在，但
 * HTTP `/api/session/:id/promptAsync` 面不接收、BudgetGuard 只对 goal
 * 会话挂载（attachBudgetGuardForGoal 读 policySnapshot）——普通会话的
 * 预算只在纸面（调研报告 docs/superpowers/specs/2026-10-22-contract-gap-research/
 * 06-gap-synthesis.md §5.1）。本模块把 per-prompt 挂载决策收敛为纯函数。
 */

export type PromptBudgetExisting = 'none' | 'goal' | 'prompt';

/**
 * 裁决本次 prompt 的预算要不要挂/换 guard：
 * - 两字段都缺或非法（≤0/NaN）→ `skip-empty`（无预算意图）
 * - 既有 goal guard → `skip-goal`（goal 生命周期预算优先于单次显式值，防顶掉）
 * - 既有 per-prompt guard → `replace`（上次 prompt 的预算不泄漏到本次）
 * - 无 guard → `attach`
 */
export function resolvePromptBudget(
  existing: PromptBudgetExisting,
  maxTurns?: number,
  maxCostUsd?: number,
): 'skip-empty' | 'skip-goal' | 'attach' | 'replace' {
  const valid = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!valid(maxTurns) && !valid(maxCostUsd)) return 'skip-empty';
  if (existing === 'goal') return 'skip-goal';
  return existing === 'prompt' ? 'replace' : 'attach';
}
