# 用户侧个人 Agent 评估

- 日期：2026-11-13
- 状态：评估结论，未实现
- 主题：在项目级 Agent 工作台之上，增加用户侧、跨项目的个人 Agent
- 结论：**GO，但只做“薄编排层”**。先做跨项目只读注意力 + 意图/建议，再通过现有 Goal/StandingGoal 路径执行；不做第二个执行器，不代理人类评审、风险接受或验收。

## 1. 结论摘要

这个方向值得做，但必须把它定义为**用户级编排与注意力层**，而不是“更自动的 Goal 执行器”。

推荐的最小形态：

```text
用户长期意图
  → PersonalIntent（跨项目）
  → 授权 / tier / 预算检查
  → 选择项目并创建 StandingGoal 或普通 Goal
  → 项目 Lead / Tech Lead / Pod / NodeDriver（现有路径）
  → Reviewer + 人类验收（不可代理）
  → 跨项目 attention / 结果汇总
```

三条硬边界：

1. **不新增执行器**：个人 Agent 只能通过现有 `StandingGoal` / `Goal` / `PodTechLeadService` 路径工作。
2. **不代理人类专属动作**：review 解决、风险接受、验收、审批、权限回复都不做；这些仍要求 human/device 凭据。
3. **默认建议态**：新意图默认 Tier 1（suggest），不默认自动执行；升级到 T2/T3 必须人类显式授权。

## 2. 现有资产

| 资产 | 现状 | 可复用点 |
|---|---|---|
| StandingGoal | 项目级长期意图；`project_dir NOT NULL`；cron/event/manual 触发；预算/并发/冷却/审计 | 作为“项目内执行底座”，个人 Agent 为每个项目创建/复用它 |
| Goal / Pod / Lead / Tech Lead | 项目唯一入口、Plan/Execute/Review、worktree、人类验收 | 个人 Agent 不得绕过；只负责选项目、提意图、汇总 |
| Attention | 每项目 `deriveAttention()`；plan/review/decision/answer 等人优先 | 聚合为跨项目 inbox；需要新增 project 字段和全局路由 |
| Decision / Approval | 项目级 decisions、human-only 路由、审计 | 个人 Agent 只读汇总；确认仍由人做 |
| Auth | human / device / service / local 四类 principal；human-only 403 | 个人 Agent 用 service 身份运行；授权/验收用 human |
| Memory | 谐波记忆全局（不按项目分区）；pinned 用户画像 | 可提供跨项目用户偏好；但读权限与写权限要分开 |
| Presence / Push / Mobile | 项目级 presence、推送、移动端 work tab | 可做跨项目摘要/通知；需避免重复推送 |
| Scheduler / budgets / ledger | 统一调度、pipeline budget、SchedulerLedger | 个人 Agent 的全局/项目预算与审计可复用 |

## 3. 当前缺口

1. **没有用户级意图模型**：`StandingGoal` 的 `project_dir` 是必填且列表按项目查询（`standing-store.ts:104,200`）；没有“跨项目的长期意图”实体。
2. **跨项目事件被拒绝**：StandingGoal 的事件投递校验“事件线程所属项目 = Standing Goal 项目”（`docs/architecture/standing-goals.md:60`）；个人 Agent 需要自己的项目解析/路由，不能直接复用。
3. **Attention 是项目级**：`AttentionItem` 没有 project 字段，`/api/attention` 需要 `projectDir`（`core/lead/attention.ts:14`、`routes/attention.ts`）；没有全局收件箱。
4. **没有分级自动化模型**：现有 `approval: auto/plan/confirm` 是项目内 Goal 级策略，不是“用户级 tier + 项目授权 + 动作类别”的组合。
5. **没有跨项目授权**：现有 auth 只解决 principal；没有“人授权个人 Agent 在项目 X 做 Y 类动作，直到 Z 时间”的 grant 模型。
6. **没有全局预算/去重**：StandingGoal 预算是每目标/项目；个人 Agent 需要全局日预算 + 每项目上限 + 与现有 StandingGoal 的去重。
7. **没有个人 Agent 的审计面**：谁在何时因为哪条意图创建了哪个项目 Goal、花了多少、为什么升级 tier，需要一条统一审计链。
8. **没有注意力疲劳控制**：quiet hours、digest、coalesce、escalation、一次只问一个关键问题，都需要在聚合层做。
9. **没有用户级 UI**：当前 rail/工作台以项目为世界；个人 Agent 需要独立入口（home / inbox / intents），不能塞进项目级 Lead。

## 4. 方案对比

### A. 不做个人 Agent，只做跨项目 dashboard

- 风险最低，但只是“看板”，不能把长期意图变成行动。
- 适合作为过渡，不满足“持续驱动普通 Goal”的目标。

### B. 薄编排层（推荐）

- 用户级 `PersonalIntent` + 跨项目 attention + 授权/tier + 现有 Goal 路径。
- 个人 Agent 不直接执行，只决定“是否值得创建一个项目 Goal / StandingGoal”。
- 价值明确，风险可控，能逐步放开自动化。

### C. 全自动跨项目 Agent

- 自己持有 scheduler、直接调工具、跨项目执行。
- 与现有 Lead/Tech Lead/Goal 状态机重复，权限面过大，审计困难；容易绕过人类验收。
- 拒绝作为 v1。

### D. 独立个人 Agent 进程/服务

- 需要独立会话、独立存储、独立 SSE/权限；与 gateway 的 scheduler/ledger/presence 重复。
- 现阶段不划算；个人 Agent 应是 gateway 内的用户级服务，不是第二个 gateway。

## 5. 推荐架构（v1）

### 5.1 数据模型

`gateway.db` 新增（名称暂定）：

```text
personal_intents
  id, objective, status(active|paused|stopped),
  project_selector(all|explicit|tag),
  project_dirs_json,
  trigger_json(cron|event|manual|continuous),
  autonomy_tier(0..3),
  action_classes_json,
  budget_json(global/perProject/perRun),
  quiet_hours_json,
  created_by, created_at, updated_at, last_run_at, next_run_at

personal_grants
  id, intent_id, project_dir, tier, action_classes_json,
  granted_by(human principal), granted_at, expires_at, revoked_at

personal_attention
  id, intent_id, project_dir, goal_id, kind, priority,
  coalesce_key, title, detail, created_at, seen_at, resolved_at

personal_audit
  id, intent_id, project_dir, goal_id, run_id, action,
  tier, decision, reason, cost_usd, at
```

- `PersonalIntent` 不是 `StandingGoal` 的替代品；它是“跨项目意图”，解析后可在多个项目创建/复用 StandingGoal。
- 不建议把 `StandingGoal.project_dir` 改成 `'*'`：会让现有项目级预算、事件过滤、列表查询语义变混。

### 5.2 PersonalAgentService

职责只做四件事：

1. **解析意图**：把 `PersonalIntent` 映射到一个或多个项目（显式列表 / 标签 / 当前活跃项目）。
2. **决策**：判断 observe / suggest / act-with-approval / act-within-policy；永远先查 grant、tier、预算、去重。
3. **编排**：通过 `PodTechLeadService.createGoal` 或 `StandingGoalService.createGoal` 创建项目内工作；不直接调 NodeDriver。
4. **汇总**：把项目 attention / goal 结果映射到 `personal_attention`，做优先级、coalesce、quiet hours、digest。

不负责：review 结论、风险接受、验收、merge、权限回复、人类问题代答。

### 5.3 分级自动化

| Tier | 行为 | 默认 |
|---|---|---|
| **T0 observe** | 只读、只记录、不产生 Goal | 可用于试运行 |
| **T1 suggest** | 产生建议/待确认项，人类一键创建 | **默认** |
| **T2 act-with-approval** | 自动创建项目 Goal，但计划/动作需人类确认 | 显式授权 |
| **T3 act-within-policy** | 在 grant 的 action class 内自动执行低风险动作 | 显式授权 + 到期 |

T3 允许的动作必须白名单化：

- 允许：`report`、`notify`、只读调研、创建普通 Goal（仍走计划/评审）。
- 不允许：验收、review 解决、风险接受、merge、close、delete、protected branch、权限变更、审批代答。

### 5.4 授权模型

- grant 只能由 **human principal** 创建/升级/撤销；service/local 403。
- grant 维度：intent、project、tier、action classes、expiry。
- 默认拒绝：没有 grant 时 T1；没有 T2/T3 grant 不自动创建 Goal。
- 撤销立即生效；执行前每次重新读取 grant（不要缓存成长期权限）。
- 审计：grant 创建/撤销、每次 tier 使用、每次自动创建 Goal、每次被拒绝。

### 5.5 注意力模型

- 跨项目聚合 `deriveAttention()` + `appendReviewAttention()` + `appendDecisionAttention()`。
- 新增 project 元数据（projectId/projectDir/title），用于深链。
- 排序：阻塞人类 > 计划批准 > 方向确认 > 决策 > 问题 > 评审项 > 失败 > 阻塞。
- 控制：coalesce（同 Goal+kind）、quiet hours、digest、escalation（超时升级）、每日最多 N 条主动打扰。
- 每个建议必须显示“为什么现在”：触发了哪个 intent、哪个项目、哪条证据。

## 6. 分阶段

| 阶段 | 内容 | 估算 | 退出标准 |
|---|---|---|---|
| **P0 只读** | `PersonalIntent` + 跨项目 attention + 建议生成；不创建 Goal | 1–2 周 | 用户能在一个 inbox 看到跨项目建议；无写操作 |
| **P1 人工确认执行** | T2：一键创建项目 Goal/StandingGoal；grant + 审计 | 2–3 周 | 建议 → 人工确认 → 项目 Lead 接手；人类验收不变 |
| **P2 低风险策略** | T3：report/notify/只读调研；quiet hours/digest/mobile | 2–3 周 | 自动动作可撤销、可审计、可 kill switch |
| **P3 完整个人 Agent** | 多意图、跨项目优先级、长期学习 | 另立 spec | 只有在 P0–P2 指标达标后才做 |

**v1 总估算：4–6 周**（P0+P1），完整到 P3 约 8–12 周。

## 7. 评估指标

- **注意力精度**：建议中被人类采纳/拒绝的比例；误报率。
- **时间到决策**：从建议出现到人处理的时间。
- **重复工作率**：个人 Agent 创建的 Goal 与现有 StandingGoal/人工 Goal 的重复率。
- **成本**：全局/项目日成本；单位有效建议成本。
- **信任**：T2/T3 的撤销率、越权拒绝数、审计缺口数。
- **疲劳**：每日打扰数、quiet hours 内触发数、digest 打开率。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 跨项目权限蔓延 | grant 按项目 + action class + expiry；默认拒绝；每次执行重读 |
| 重复 Goal / 双花 | 创建前按 project + intent + goal signature 去重；与 StandingGoal 共享 trigger_key 语义 |
| 注意力疲劳 | coalesce、quiet hours、digest、每日打扰上限、只问一个关键问题 |
| 意图漂移 | intent 有 expiry/review；每次 tier 升级需人确认；审计原因 |
| 绕过人类验收 | 人类专属动作在路由层 hard deny；个人 Agent 无 human token |
| 数据泄漏 | 读权限与写权限分开；跨项目读取需显式 project grant；日志脱敏 |
| 审计缺口 | 所有个人 Agent 决策写 `personal_audit`，关联 project/goal/run |
| 与项目 Agent 冲突 | 个人 Agent 只创建 Goal/StandingGoal，不直接操作 worktree/merge |

## 9. 必须保持的硬不变量

- 人类验收、review 解决、风险接受、审批、权限回复：**不可代理**。
- 不新增第二个 Goal 执行器；NodeDriver 仍是唯一状态机。
- 不绕过项目 Lead / Tech Lead；个人 Agent 不直接调 runtime session。
- 不自动 merge / close / delete / protected branch / schema 变更。
- 默认 T1；T2/T3 必须 human grant；grant 可撤销、可过期。
- 所有自动动作可 kill switch、可回滚、可审计。
- memory 仍是产品能力；个人 Agent 不改变 memory schema/T1/100ms 语义。

## 10. 结论

**建议做，但先做 P0 只读 + P1 人工确认执行。**

理由：

- 现有 Goal/StandingGoal/attention/auth 已经提供了足够底座；个人 Agent 的增量主要是“跨项目意图 + 授权 + 注意力”，不是执行器。
- 直接做全自动跨项目 Agent 会把权限、审计、重复调度、人类验收四个风险叠加，收益不成比例。
- P0/P1 能以较低成本验证“用户是否真的需要跨项目主动 Agent”，再决定是否投入 T3。

**下一步**：先写 `PersonalIntent` + 跨项目 attention 的设计/数据模型，再做 P0 原型；不要先动 NodeDriver 或新增执行器。
