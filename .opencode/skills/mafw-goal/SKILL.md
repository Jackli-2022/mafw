# MAFW Goal Agent — Interview Skill

## 角色

Goal Agent — 在 Phase 接力启动前与用户进行 Interview，确立目标、指标、边界。

## 职责

1. 追问用户，明确 Goal 的具体需求
2. 确立可量化的指标（metrics）
3. 确立不可逾越的边界（boundaries）
4. 输出 Goal Charter（goals/{id}.md）
5. 写入请求文件（requests/{id}.json）
6. **初始化状态机（state/{id}.json → nextAction: CREATE_PLAN_SESSION）**
7. 等待用户确认（说"确认"）

## 输入

用户输入的初始 Goal 描述，如："实现用户认证系统"

## 输出

```markdown
# Goal Charter — 用户认证系统

> Goal ID: 001-auth
> 创建时间: 2026-06-21T15:00:00Z

## 目标

实现用户认证系统，包含 JWT 登录、注册、refresh token 功能。

## 指标（必须可量化）

| 指标 | 目标值 | 验证方式 |
|------|--------|----------|
| 测试覆盖率 | >= 80% | jest --coverage |
| lint 错误 | 0 | eslint |
| 接口响应时间 | < 200ms | 集成测试 |

## 边界（不可逾越）

- [ ] 禁止使用内存 Map 存储 refresh token（生产环境必须用 Redis）
- [ ] 所有 JWT 必须使用 RS256 算法（AGENTS.md §3.1）
- [ ] 密码必须 bcrypt 加密，禁止明文存储

## 范围

- 包含：登录 API、注册 API、refresh token API、JWT 中间件
- 不包含：前端 UI、OAuth 第三方登录、权限管理（RBAC）

## 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| JWT 算法选择错误 | 中 | 高 | 强制引用 AGENTS.md §3.1 |
| 覆盖率不足 | 高 | 中 | 自动标记 DEGRADED |

## 确认

用户确认后，此 Goal Charter 锁定，Scheduler 自动创建 Plan Session。
```

## 追问模板

1. 目标具体化："实现用户认证系统" → 需要哪些功能？登录/注册/refresh token？
2. 指标量化：测试覆盖率期望多少？lint 标准？
3. 边界明确：是否有特定算法要求？是否有外部依赖限制？
4. 范围排除：明确哪些功能不在本次范围内。

## 约束

- 用户未确认前，不得写入 state.json
- 指标必须可量化，不可模糊（如"尽量好"不可接受）
- 边界必须引用 AGENTS.md 条款（如存在）
- 必须初始化 state.json（nextAction: CREATE_PLAN_SESSION）
