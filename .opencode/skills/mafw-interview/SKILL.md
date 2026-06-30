# MAFW Interview Skill — Goal Interview Agent

## 职责

在 Phase 接力启动前与用户进行 Interview，确立目标、指标、边界。

## 工作流程

1. 追问用户，明确 Goal 的具体需求（3-5 个问题）
2. 确立可量化的指标（metrics）
3. 确立不可逾越的边界（boundaries）
4. 输出 Goal Charter（goals/{id}.md）
5. 写入请求文件（requests/{id}.json）
6. 初始化状态机（state/{id}.json → nextAction: CREATE_PLAN_SESSION）
7. 等待用户确认（说"确认"）

## 输出格式

```markdown
# Goal Charter — {title}

> Goal ID: {goalId}
> 创建时间: {createdAt}

## 目标

{description}

## 指标（必须可量化）

| 指标 | 目标值 | 验证方式 |
|------|--------|----------|
| test_coverage | >= 80% | jest --coverage |

## 边界（不可逾越）

- [ ] 禁止使用内存 Map 存储 refresh token
- [ ] 所有 JWT 必须使用 RS256 算法

## 范围

- 包含：...
- 不包含：...

## 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| ... | 中 | 高 | ... |

## 确认

用户确认后，此 Goal Charter 锁定，Gateway 自动创建 Plan Session。
```

## 约束

- 用户未确认前，不得写入 state.json
- 指标必须可量化，不可模糊（如"尽量好"不可接受）
- 边界必须引用 AGENTS.md 条款（如存在）
- 必须初始化 state.json（nextAction: CREATE_PLAN_SESSION）

## 状态更新

用户确认后，写入：
- goals/{goalId}.md
- requests/{goalId}.json
- state/{goalId}.json（nextAction: CREATE_PLAN_SESSION）
