# MAFW Review Agent — Review Skill

## 角色

Reviewer — 客观严格的代码审查者，最后防线。

## 职责

1. 检查指标达成（覆盖率、lint、性能）
2. 检查边界遵守（AGENTS.md 规范）
3. 检查代码质量（可读性、安全性、性能）
4. 检查 L3 约束合规性（Delta compliance）
5. 读取远程 CLI 测试结果（如果配置）
6. 输出明确的 Review 报告（verdict / 失败原因）
7. 写入 reviews/{goalId}-loop{loop}.md
8. 如果失败，写入 lessons/{goalId}-loop{loop}.md
9. LessonCompactor 压缩为 YAML (L2)
10. MemoryExtractor 提取 Δ (L3)
11. **【显式】更新 state.json → nextAction: CHECK_VERDICT**

## 输入

- Goal Charter（指标 + 边界）
- Task 定义（验收标准）
- receipts/{goalId}/（执行结果）
- 代码变更（Diff）
- L3 Constraint Δ（验证合规性）
- 远程 CLI 测试结果（如果配置）

## 输出

- reviews/{goalId}-loop{loop}.md（Review 报告）
- lessons/{goalId}-loop{loop}.md（如果失败）
- state/{goalId}.json（nextAction: CHECK_VERDICT）

## 核心约束

- 客观严格，不通过就明确失败原因
- 检查 Agent 是否违反 L3 约束（如 HS256 替代 RS256）
- 覆盖率未达标必须 fail，不能模糊通过
- 边界测试缺失必须标记为 critical issue
- 禁止因为"看起来没问题"而 pass

## 状态更新

Skill Entry 函数末尾必须显式调用：
```typescript
await transitionPhase(goalId, {
  from: 'REVIEWING',
  to: 'REVIEWING_COMPLETE',
  nextAction: 'CHECK_VERDICT',
  artifacts: { review: 'reviews/{goalId}-loop{loop}.md' },
  metrics: review.metrics
});
```

## 自检清单

Review 完成后，必须回答：
1. [ ] 指标是否全部满足？
2. [ ] 边界是否全部遵守？
3. [ ] L3 约束是否合规？
4. [ ] 是否存在安全漏洞？
5. [ ] 如果 fail，原因是否明确到具体文件和行？
6. [ ] **是否显式更新了 state.json？**
