# 2026-11-16 · Goal 失败路由：Lead attention / 用户面 / Tech Lead handoff

- **版本**：`v5.1.0`（行为修复，不升版本号）
- **提交**：`926bd092`（路由 / 用户面）+ `109be83a`（事件层）
- **范围**：gateway attention 投影 + desktop Goal 用户面 + Tech Lead 失败 handoff
- **前置**：`docs/releases/2026-11-16-review-artifact-double-encoding.md`

## 问题

终态失败的 Goal 在三个地方被当成“正常结果”：

- `deriveAttention` 先判断 `resultReady && !accepted`，所以 `FAIL/ERROR/MAX_RETRIES`
  进入 `review`（待验收），`failed` 分支基本不可达；
- `buildPodAttention` 只收 `stage.owner === 'person'`，终态 `ended` 不进 Pod detail
  attention（rail / 需要你处理）；
- Deskop `LeadGoalStatusCard` 过滤 `endedAt`，Lead chat 里失败 Goal 直接消失；
- `goal-user-view` 对已结束 Goal 统一显示“已结束”，不区分失败；
- `archiveGoal` 会 `destroyAllSessions`，Tech Lead 没有持久失败通知路径。

## 现在的规则

| 终态 | 事件层 | attention | 用户面 | Tech Lead |
|---|---|---|---|---|
| `PASS` / `UNREVIEWED` + resultReady | `goal.result` p1 / human | `review`（待验收，`open_result`） | 结果待验收 | 不需要 |
| `FAIL` / `MAX_RETRIES` / `ERROR` + 未验收 | `goal.failed` p1 / lead | `failed`（`open_result`，priority 85） | 红色「失败 / 异常 / 重试耗尽」，`needsPerson=true`，「查看失败原因」 | 归档前写 durable handoff |
| `CANCELLED` | `goal.ended` p3 / none | 不打扰 | 已结束 | 不需要 |

- 失败首先进入事件层：`goal.failed` 是 p1 / audience=lead，`PodEventWake` 直接唤醒 Lead；
  event summary 带 `lastError` / `reviewFeedback`；
- `goal.failed` 与 `goal.result` 的 dedupe key 都带 kind，互不顶账；
- `failed` 同时进入 Pod detail attention（rail / 需要你处理）与 `/api/attention`；
- Lead 状态卡保留终态失败（PASS 历史不占位），并显示失败原因；
- `context/tech-lead-failure.md` 写入 `<mafwDir>/goals/<goalId>/context/`，下一次
  Tech Lead 会话的 ContextManifest 自动带上（归档销毁实时会话，所以不能只 prompt）。

## 实现

- `gateway/src/core/pod/pod-event-model.ts`
  - `classifyGoalArchive`：PASS/UNREVIEWED → `goal.result` p1/human；FAIL/MAX_RETRIES/ERROR →
    `goal.failed` p1/lead；`goalDedupeKey` 增加 kind 维度。
- `gateway/src/kernel.ts`
  - 归档事件写 `summary`（lastError / reviewFeedback）并按 kind 生成 dedupe key；
  - `archiveGoal` 在销毁会话前调用 `notifyFailure`（仅失败 verdict，fail-open）。
- `gateway/src/core/pod/pod-stage.ts`
  - 新增 `isFailedVerdict`；`projectPodAttention` 支持 `failed` 输入并输出 `failed` 项。
- `gateway/src/core/pod/pod-view.ts`
  - `buildPodAttention` 对 `endedAt && !accepted && isFailedVerdict(verdict)` 生成 failed。
- `gateway/src/core/lead/attention.ts`
  - 终态失败先于 `review` 判定；`failed` priority 85；`detail` 带 `lastError`。
- `gateway/src/core/pod/pod-tech-lead-service.ts`
  - 新增 `notifyFailure`：写 durable failure handoff；`withManifest` 自动附加。
- `packages/desktop/src/renderer/mafw/work-overview-model.ts`
  - 终态失败进入 attention list，优先于 unseen result；failed priority 85。
- `packages/desktop/src/renderer/mafw/lead-goal-status.ts`
  - 包含终态失败、排在 person 之后、team 之前；显示「失败 / 异常 / 重试耗尽」。
- `packages/desktop/src/renderer/mafw/goal-user-view.ts`
  - 失败终态显示红色 badge、`needsPerson=true`、下一动作「查看失败原因」；
  - 失败 Goal 如果有结果证据，face 为 `result`（否则 history）。

## 验证

- gateway 全量：**986 / 986 suites**，**7880 passed / 2 skipped / 0 failed**
- desktop 全量：**740 / 740 suites**，**3909 / 3909 passed**
- gateway `tsc`：rc=0
- desktop `tsgo`：rc=0
- `gateway npm run build` / `desktop electron-vite build`：通过
- 新增/更新测试：attention 失败路由、Pod detail failed attention、Lead 失败卡、
  goal-user-view 失败标签、Tech Lead durable handoff（含 ContextManifest 附加）
- 未 push、未合并远端

## 边界

- 已经归档的 `goal-20261115-122201-8a45c4` 会在重启后以 `failed` 出现在 attention，
  但不会自动恢复；其代码仍在 `mafw/goal-20261115-122201-8a45c4-r2` @ `2979667f`。
- 失败 handoff 只对本次修复后归档的 Goal 生成；历史 Goal 没有该文件。
- 归档报告 `COMPLETED` 的硬编码与失败归档的 merge 文案是独立问题，本次未改。
