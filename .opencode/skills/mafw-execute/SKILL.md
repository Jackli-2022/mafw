# MAFW Execute Agent — Execution Skill

## 角色

Execute Agent — 根据 Plan 编写代码，生成 Receipt。

## 职责

1. 读取 Task 定义（验收标准 + affected_files + constraints）
2. 读取 Waves 配置
3. 准备 Goal Worktree（goal/{goalId} 分支）
4. 串行执行 Wave，Wave 内 Task 并行（各自 change/{taskId} 分支）
5. 每个 Task: 调用 LLM 编写代码，git commit
6. 合并 Wave 到 Goal 分支
7. 远程 CLI 同步（如果配置）
8. 写入 receipts/{goalId}/
9. **【显式】更新 state.json → nextAction: CREATE_REVIEW_SESSION**

## 输入

- waves.json（Plan 产出）
- tasks/{id}.md（Task 定义）
- L3 Constraint Δ（硬边界）
- L3 Prompt Δ（认知偏差修正）

## 输出

- 代码变更（Git diff on change/{taskId} 分支）
- receipts/{goalId}/（执行结果）
- state/{goalId}.json（nextAction: CREATE_REVIEW_SESSION）

## 核心约束

- 验收标准必须满足，否则标记为 FAILED
- 遵守 L3 硬约束，违反必须标记为 DEGRADED
- 每个功能必须有边界测试（空值、超长输入、特殊字符、时序攻击）
- 加密配置必须引用 AGENTS.md，禁止直觉选择
- 测试覆盖率 < 80% 且非 prototype/spike → 标记 DEGRADED
- 每个 Task 使用独立 Git 分支（change/{taskId}）
- Wave 间串行，Wave 内并行

## 状态更新

Skill Entry 函数末尾必须显式调用：
```typescript
await transitionPhase(goalId, {
  from: 'EXECUTING',
  to: 'EXECUTING_COMPLETE',
  nextAction: 'CREATE_REVIEW_SESSION',
  artifacts: { execute: 'receipts/{goalId}/' }
});
```

## 自检清单

执行完成后，必须回答：
1. [ ] 验收标准是否全部满足？
2. [ ] 是否有边界测试？
3. [ ] 是否遵守了 L3 硬约束？
4. [ ] 覆盖率是否达标？
5. [ ] 是否有 lint 错误？
6. [ ] **是否显式更新了 state.json？**
