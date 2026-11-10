# 2026-11-10 · Lead / Tech Lead P0 + P0.5 交付

- **分支**：`feat/lead-techlead-p0`
- **合并**：`d50f4f18`（`feat/gateway-kernel-d1-batch2` ← `b4d20575`）
- **后续**：`6bee9da0`（D1 迁移后重锚 history 出口守卫）
- **Plan**：`docs/superpowers/plans/2026-11-10-lead-techlead-p0-handoff.md`
- **Spec**：`docs/superpowers/specs/2026-11-10-lead-techlead-thread-handoff-design.md`、`2026-11-10-lead-techlead-p0-kernel-objects-design.md`、`2026-11-10-goal-shapes-quick-goals-design.md`

## 交付内容

- **当前话题 handoff**：`GoalSourceRef.topicId/messageRange`、`lead_topic` 表、`buildLeadHandoff` 纯函数、两阶段 `prepareForGoal → Goal/revision 落库 → commit`、`<goalDir>/context/lead-handoff.md` 全文、opening prompt `<lead-handoff>` 注入、ContextManifest 可选 ref。
- **入口**：`mafw_create_goal` 支持 `handoff/sourceRef/topicId`；桌面邀请条与 Goal 详情展示「来自 Lead 话题」，详情可读全文（`GET /api/goals/:id/source`）。
- **Lead 状态**：`mafw_lead_goal_status` 投影（stage / progress / blockers / pendingAttention）+ 桌面按需状态卡。
- **Goal 模式**：`goal_mode` 落在 `pod_goal_revisions`（默认 `standard`）；`mafw_pod_goal_direction.goalMode` 选择 quick/standard（standing 501）；quick 复用现有 `PlanStrategy='quick'`，plan prompt + validator 强制单 task、无 probe；`planReview:'manual'` 与 `requiresApproval` 拒绝 quick；Goal 详情显示模式徽标。
- **开关**：`MAFW_LEAD_HANDOFF=0`、`MAFW_GOAL_MODES=0`。

## Review 修复

- 路径穿越：`isSafeGoalDirId` + goalDir basename 守卫。
- 重复/并发创建覆盖 handoff：两阶段提交、已有 Goal 目录 409、失败不删赢家文件。
- handoff 排除 synthetic recall 与未完成 assistant 文本；`blocked` stage 进入 blockers；`topicId` 生效。
- 高风险 quick 拒绝；`goals.source` 进统一 route registry，legacy route inventory 恢复。

## 门禁

- 新增测试 **40**（gateway 32 / desktop 8）。
- 定向套件 **161/161**；desktop **3189/3189**。
- gateway 全量 **5561 passed / 3 failed**：`architecture-boundaries`（2，D1 路由迁移后的源码扫描漂移）、`agents-list`（1，D1 H1 同类漂移）。均非本计划引入。
- gateway `tsc` rc=0；desktop `tsgo` rc=0；`electron-vite build` rc=0。
- 未 push。

## 后续收口（2026-11-10）

- `3f79446f`：重锚 D1 迁移后的权限 / agents 源码守卫。
- `06f395d8`：补 `docs/architecture/{pod,goal,desktop}.md` 与 `docs/reference/tools.md` 现状段。
- `e52ffc4a`：`mafw_lead_goal_status` 进 Lead / Manager allowlist，Lead prompt 指向该工具。
- `4d504f2f`：P0 minors 收口——WorkOverview mode chip、Lead 卡 `pendingAttention`、`views()` 改为一次 revision 查询、`created_at` tie-breaker 测试、旧库 `goal_mode` migration / rollback / `untilMessageId` 测试、driver quick 计划不匹配拒绝。
- 收口后门禁：gateway **5606/5606**、desktop **3192/3192**、gateway `tsc` rc=0、desktop `tsgo` rc=0、`electron-vite build` rc=0。
- P1 计划已排：`docs/superpowers/plans/2026-11-10-lead-techlead-p1-working-set.md`（12 tasks）。

## 暂缓 / 未做

- P1（工作集 / 缺页）、P2（调度器 / COW fork）、P2.4（事件层）、P2.5（Standing Goals）未开工。
- LongMemEval / 自建多话题评测未执行。

