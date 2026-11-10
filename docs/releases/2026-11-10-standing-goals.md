# 2026-11-10 · P2.5 Standing Goals

- **版本**：`v5.1.0` 基础上交付（不新打 tag；合入 `main` 后由发布记录补充 merge hash）
- **分支**：独立 worktree（detached HEAD）
- **基础**：`main` `7ee50700`（P2.4 合并后的发布记录）
- **Spec**：`docs/superpowers/specs/2026-11-10-standing-goals-design.md`
- **Plan**：`docs/superpowers/plans/2026-11-10-standing-goals.md`
- **Head**：`8fac9c8e`（Tasks 1–10 + review fix pass）
- **Merge**：待合入 `main`

## 交付

- `StandingGoal` / `GoalRun` / `GoalRunEvent` 三张表（`ensureStandingSchema` 幂等建表）。
- 触发器：cron / event / manual；稳定 `triggerKey` 去重；并发、日预算、冷却准入。
- 生命周期：create / update / pause / resume / stop / reconcile；cron 注册到 automation engine
  （`standing_goal:tick`），启动时自修复。
- 运行分流：`goal` / `report` / `action` / `skip`；`goal` 与 `report` 复用
  `PodTechLeadService.createGoal → setGoalRevisionStatus('planning') →
  PodGoalService.admitReadyGoal`，**没有第二条执行路径**。
- 动作白名单：仅 comment / label / notify；`waiting_person` + `POST /api/goal-runs/:id/approve`
  人工批准，MCP 不提供 approve。
- P2.4 集成：`standing_goal` 使用 wildcard `work` 订阅；事件层关闭时 cron/manual 仍可用。
- 9 条 HTTP 路由（RouteRegistry + OpenAPI contract）、4 个 MCP 工具、桌面
  `StandingGoalsPanel`（状态 / 上次 / 下次 / 成功率 / 运行记录 / 暂停恢复停止 / 立即运行 / 批准）。
- 文档：`docs/architecture/standing-goals.md`；gateway 子系统表与 AGENTS 索引已登记。

## 开关

- `MAFW_STANDING_GOALS=1`：启用服务、路由与 MCP；默认关闭（路由 503）。
- `MAFW_EVENT_LAYER=1`：事件触发依赖；默认关闭。

## 门禁（2026-11-11）

- gateway：**6065 passed / 1 skipped / 6066 total**（新增 36）
- SDK：**205/205**
- desktop：**3204/3204**（新增 2）
- root：**112/112**
- gateway `tsc --noEmit` rc=0
- desktop `tsgo --noEmit` rc=0
- desktop `electron-vite build` rc=0

## Review fix pass

- **Windows cron**：automation rule 文件名对 `:` 等字符做安全转义（逻辑 id 保留在 JSON 内），
  新增 Windows-safe 文件名 + reload 回归测试。
- **动作注册**：`standing_goal:tick` / `event:github_poll` / `event:cron_tick` 全部改由
  `setActionsProvider` 注册，automation reload 不再清空。
- **成本核算**：`onGoalArchived` 汇总 Goal sessions 的 trajectory cost/tokens；triage 成本写入
  run；`onGoalFinished` 累加；日预算按 Standing Goal 聚合；`MAX_RETRIES` 计为失败。
- **审批门**：`approval='confirm'` 同时拦截 `goal` / `report`；`approval='plan'` 映射
  `planReview:'manual'`；批准先原子 `claimWaitingRun`，并发批准只有一个成功。
- **事件隔离**：wildcard 订阅在 evaluate 与 deliver 两处校验项目；关闭 `MAFW_STANDING_GOALS`
  时忽略残留订阅；事件 `filter` 保留并匹配；多 event trigger 各自去重。
- **生命周期**：stopped 为终态；startRun 校验 active；pause/stop 清理 `nextRunAt`；
  create/update/resume 注册失败回滚为 paused；reconcile 逐目标容错并回收 24h 悬挂 run。
- **triade 安全**：triage 会话改用 `plan` agent + `maxTurns`，payload 标记为不可信数据。
- **输入校验**：projectDir 必须为已注册绝对路径；approval/budget/数字/模板/cron/timezone 校验。
- **UI/MCP**：503 视为功能关闭；MCP list 受 flag 约束；Lead 工具 allowlist 与提示词补齐。
- `comment` / `label` 在 v1 仍显式失败（notify-only），文档已改为如实描述。

## 设计裁定

- `runNow` 同步 await 分流，调用方能看到 `running` / `failed`。
- cron 规则键 `standing-goal:<goalId>:<triggerId>`；`GoalRun` 去重键
  `<goalId>:cron:<scheduledAt>` / `<goalId>:event:<eventId>` / `<goalId>:manual:<id>`。
- 日预算耗尽：暂停目标并广播 `goal_run.budget_exhausted`，不创建运行。
- 动作审批：`requiresApproval` 或目标 `approval='confirm'` → `waiting_person`；
  高风险动作不在白名单内，永远走人工。
- 普通 Goal 结束回调携带 verdict；`FAIL` / `CANCELLED` / `ERROR` 映射为运行 `failed`。

## 暂缓

- triage 使用内部临时会话，尚未做专门的轻量 triage runtime。
- `comment` / `label` 在 v1 显式失败（notify-only）；动作传输接入后另行启用。
- 桌面端仅展示与操作 Standing Goals，不提供新建表单（创建走 API/MCP/Lead）。
- 未自动合并、未绕过 Goal 人工验收；P2.5 不改变验收权限模型。
