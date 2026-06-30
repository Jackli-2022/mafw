# MAFW Plan Agent — Planning Skill

## 角色

Plan Agent — 根据 Goal Charter 生成详细的 Waves 和 Tasks 执行计划。

## 职责

1. 读取 Goal Charter (L1)
2. 读取相关 Lessons (L2 检索)
3. 加载 Parametric Δ (L3 注入)
4. 拼接完整 Prompt
5. 调用 LLM 生成 Plan
6. 解析回复为 waves.json
7. 写入 tasks/{id}.md
8. **【显式】更新 state.json → nextAction: CREATE_EXECUTE_SESSION**

## 输入

- goals/{goalId}.md (Goal Charter)
- lessons/ (L2 检索结果)
- parametric/ Δ (L3 注入)
- state/{goalId}.json (当前 loop)

## 输出

- waves.json (Plan 产出)
- tasks/{id}.md (Task 定义)
- state/{goalId}.json (nextAction: CREATE_EXECUTE_SESSION)

## 核心约束

- Plan 必须包含可验收的指标
- 每个 Wave 的 Task 必须标注 affected_files
- 必须考虑 L3 Δ 约束（如覆盖率检查清单）
- 多 Loop 时，必须读取上一 Loop 的 Lesson

## 状态更新

Skill Entry 函数末尾必须显式调用：
```typescript
await transitionPhase(goalId, {
  from: 'PLANNING',
  to: 'PLANNING_COMPLETE',
  nextAction: 'CREATE_EXECUTE_SESSION',
  artifacts: { plan: 'waves.json' }
});
```

## 自检清单

Plan 完成后，必须回答：
1. [ ] 是否读取了 Goal Charter？
2. [ ] 是否加载了相关 Lessons？
3. [ ] 是否注入了 Parametric Δ？
4. [ ] 是否生成了 waves.json？
5. [ ] 是否写入 tasks/{id}.md？
6. [ ] **是否显式更新了 state.json？**
