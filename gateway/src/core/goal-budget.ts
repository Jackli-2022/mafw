import * as fs from 'fs';

/**
 * 把 goal request 文件里的 budget.{maxTurns,maxCostUsd} 并入 policySnapshot。
 * fail-open：文件缺失/坏 JSON/无 budget → 原样返回。
 * 消费方：handleValidate（state 初始化）与 onGoalCreated（policySnapshot 补写），
 * BudgetGuard（core/budget-guard.ts 挂载链）读 policySnapshot.maxTurns/maxCostUsd 硬停。
 */
export function mergeBudgetIntoSnapshot<T extends object>(
  snapshot: T,
  requestFile: string,
): T {
  try {
    if (!fs.existsSync(requestFile)) return snapshot;
    const request = JSON.parse(fs.readFileSync(requestFile, 'utf-8'));
    const budget = request?.budget;
    const maxTurns = typeof budget?.maxTurns === 'number' ? budget.maxTurns : undefined;
    const maxCostUsd = typeof budget?.maxCostUsd === 'number' ? budget.maxCostUsd : undefined;
    if (maxTurns === undefined && maxCostUsd === undefined) return snapshot;
    return {
      ...snapshot,
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
    };
  } catch {
    return snapshot;
  }
}
