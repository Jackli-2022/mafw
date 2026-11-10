# 2026-11-10 · Lead / Tech Lead P2：调度器与 COW fork

- **分支**：`feat/p2-main-merge`（从 main 重接 P2；不含并行 D3 内核拆分）
- **基础**：`main`（P0/P0.5/P1 已合入）
- **Spec**：`docs/superpowers/specs/2026-11-10-lead-techlead-p2-scheduler-design.md`
- **Plan**：`docs/superpowers/plans/2026-11-10-lead-techlead-p2-scheduler.md`

## 交付内容

- **Attention v2**：`deriveAttention`（person-first、review/failed、coalesceKey）+ `GET /api/attention`。
- **调度**：`planPromotions` 多 Goal 槽位 + 固定 1 个人类介入槽；`PodGoalService.promote` 填槽，
  `MAFW_POD_MAX_GOALS`（默认 1）；`GET /api/scheduler/status` 诊断。`createGoal` / `startPlanning`
  统一走 `canAdmitGoal` / `admitReadyGoal`，槽位不足时保持 queued。
- **控制面**：`POST /api/goals/:id/{pause,resume,stop,retry}`；pause 持久化
  `_resumePhase/_resumeNextAction`，resume 恢复后继续；retry 仅限 active revision 的 failed run。
- **COW fork**：`lead_topic` fork 字段 + `topic_fork` 表；`mafw_create_goal.forkFromTopicId`；
  `LeadHandoffService.buildForkForGoal` 只写 `<forked-topic>` 引用 + summary + 用户原话；
  fork 失败回退 P0 handoff，源 topic 必须同项目，新 topic 写 summary/index。
- **边界**：`topic_boundary` + `detectBoundary`；accept 是真正 split（新 topic 从源尾开始、源转 cold），
  merge/undo 只改状态；宿主插件异步 observe，带 semantic/idle/goal_closed 信号与 10 分钟去重。
- **跨 topic 记忆**：Goal 终态把 source topic summary 写成 semantic memory（幂等）。
- **桌面**：attention-first「需要你处理」面板；Topic map 分叉 / 边界操作。

## 开关

- `MAFW_LEAD_SCHEDULER` 默认 **关**（关闭时强制单 active）。
- `MAFW_LEAD_AUTO_BOUNDARY` 默认 **observe**（`off` / `observe` / `on`）。
- `MAFW_LEAD_COW_FORK` 默认 **开**；关闭时回退 P0 当前话题 handoff。
- `MAFW_POD_MAX_GOALS` 默认 1，灰度时再调高。

## 门禁

- gateway：**5833/5833**（752 suites，`--testTimeout=30000`；本分支不含 D3）
- SDK **203/203**
- desktop **3201/3201**
- root plugin **112/112**
- gateway `tsc` / desktop `tsgo` / `electron-vite build` rc=0
- `api-contract` / `legacy-route-inventory` 绿

## Review 修复（2026-11-10）

- Critical：scheduler 准入统一；review/failed attention 可达；pause 可 resume。
- Important：多 active archive 补槽；失败回滚不清无关指针；retry 限定 active revision；
  fork 回退/项目归属/当前 session/summary+index；boundary 真正 split、信号可达与去重；
  记忆剔除 transcript 段；桌面只显示 proposed；控制/边界路由 404/409。
- 新增/改写测试：attention 真实 view fixture、Lead Goal 准入、pause/resume driver、
  retry selector、fork fallback/ownership/index、boundary split/dedupe、memory 过滤、路由错误映射。

## 暂缓

- 自动边界语义信号仍是 token 近似，不引入 embedding rerank。
- 跨 topic 记忆只提升 summary，不写 Tech Lead 原始日志。
- 边界/调度的事件只落 `topic.boundary.proposed` / `lead.compaction` 等最小集合，完整事件层归 P2.4。
- P2.4（事件层）、P2.5（Standing Goals）未开工。
