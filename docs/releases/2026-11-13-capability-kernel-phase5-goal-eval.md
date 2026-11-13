# Capability Kernel Phase 5 / GoalEval Hook 交付记录

- 日期：2026-11-13
- 版本：5.1.0（未 bump、未发布）
- 范围：GoalEval provider hook（不开放新节点、不改状态机/人类验收）
- 相关：`docs/research/2026-11-13-phase5-remaining-scope.md`

## 交付内容

### GoalEvalProvider

新增 `gateway/src/core/goal/goal-eval-provider.ts`：

```ts
interface GoalEvalProviderInput {
  goalEval: GoalEval;
  plan: unknown;
  taskResults: ReviewTaskResult[];
  reviewFeedback?: string;
}

interface GoalEvalProvider {
  id: string;
  evaluate(input): Promise<GoalEvalConditionResult[]> | GoalEvalConditionResult[];
  health?(): 'healthy' | 'degraded' | 'failed';
  dispose?(): void;
}
```

`applyGoalEvalResults()` 是 core 的强制校验层：

- provider 只能逐 condition 返回 `pass | fail | skipped` + evidence，不能决定整体 verdict。
- unknown / duplicate condition id、非法 result → `ok:false`，保留 reviewer rubric，不自动 PASS。
- required condition 缺失 / skipped / fail → 强制 `FAIL`，写 `missingGoalConditions` / omissions。
- pass 但没有 evidence → 降级为 fail + omission。
- provider 抛错 / 非法输出 → 保留 reviewer rubric；不会把 review 变成 PASS。
- `inconsistent` 标记保留：PASS + required 未通过会降级并标记。

### NodeDriver hook

- `NodeDriver.setGoalEvalProvider(provider | null)`。
- review 节点解析 reviewer rubric 后调用 provider；用 `applyGoalEvalResults` 合并。
- 无 provider 时行为与之前完全一致。
- `planHash` / `evalHash`、routing、NodeDriver 状态机、artifact 校验、人类验收均未改。

## 明确不做

- 不开放新 Goal 节点名。
- 不做 GoalNodeExecutor。
- 不提供默认 provider / 第三方 provider loader。
- 不把 GoalEval 变成自动验收；人类 accept 仍是唯一验收入口。
- 不改变 reviewer rubric 的 task 逐项校验。

## 验证

- 本计划新增 **6 个测试**：
  - provider 结果替换 reviewer goalResults
  - required fail / missing required 强制 FAIL
  - unknown / duplicate id 保留 reviewer verdict
  - pass 无 evidence 降级
  - driver source wiring pin
- gateway 全量：**7159 passed / 1 skipped / 7160 total**（915 suites，`--testTimeout=20000`）。
- gateway typecheck：`npx tsc --noEmit -p tsconfig.json` 退出 0。

## Rollback

- 删除 `NodeDriver.setGoalEvalProvider` 调用 → reviewer rubric 回到原行为。
- 删除 provider 实现 → 无 provider，review 逻辑不变。
- 不涉及数据迁移；GoalEval 产物格式未变。

## 关键 commit

- `99268482` feat(goal): add goal eval provider hook

## Next

Phase 5 全部收口：memory 固定为产品能力；embedding/reranker、automation、storage cleanup、GoalEval hook 已交付。后续进入 Phase 6（信任与运维硬化）或按需补 provider 实现。
