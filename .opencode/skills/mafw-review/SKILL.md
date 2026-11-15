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

## 报告格式（必需）

Review 报告 `.md` 的**第一段**必须是一个机器可读的 `mafw-review` 围栏块，然后才是人读分析。  
块放在末尾时，长报告可能被输出上限截断而丢失。  
**没有这个块、JSON 非法、漏 taskId、漏必需 Goal 条件 = 评审无效（artifact_invalid），不要只写 markdown 表格。**

````markdown
```mafw-review
{
  "verdict": "PASS" | "FAIL",
  "tasks": [
    { "taskId": "w1-t1", "result": "pass | fail | skipped", "evidence": "命令 + 结果或文件路径" }
  ],
  "goalResults": [
    { "conditionId": "g1", "result": "pass | fail | skipped", "evidence": "可核对证据" }
  ],
  "feedback": "FAIL 时给具体修复指引；PASS 可空字符串"
}
```

# Review Report — loop {n}

（人读的分析叙述）
````

规则：

- `verdict` 只接受 `PASS` / `FAIL`；只要有一个 task fail，verdict 必须是 `FAIL`。
- `tasks` 必须覆盖 `waves.json` 里的**每一个** taskId；缺一个即无效。
- `goalResults` 必须覆盖**每一条必需的** Goal 条件；缺一条即无效。
- `evidence` 必须是可复现的证据（命令 + 结果摘要或文件路径），不能写“看起来没问题”。
- 没有 required Goal 条件时，`goalResults` 写 `[]`。
- 这个块是 gateway 的唯一解析来源；human-readable 分析再多也不能替代它。

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
