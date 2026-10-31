# Pod 硬化三件事：路线图

- 日期：2026-10-31
- 来源：`docs/research/2026-10-31-pod-vs-industry.md` §5「值得借的三件事」
- 状态：待批准（批准后按 `writing-plans` 出正式实现计划并 native 执行）

## 0. 排序与理由

| 顺序 | 事项 | 一句话 | 体量 | 风险 |
|---|---|---|---|---|
| **1** | **Review 结构化 rubric** | 把「验收」从自由文本变成逐任务 pass/fail + 证据，并让任务板按结果收口 | 中（gateway + desktop） | 低（只收紧契约，不改编排拓扑） |
| 2 | **成员 readiness** | 
`pod_members.status` 从「只用于显示」变成投递/UI 的前置条件 | 小（gateway 投递 + desktop 面） | 低 |
| 3 | **已读回执** | 成员 `markRead` 后给发送方一条回执/已读态 | 小（gateway + inbox UI） | 低（噪音风险，需定去重） |

排序理由：① 它同时解决「待审可判」「评审可复核」「任务板能按任务收口」三个问题，收益最直接；② 它不依赖前两项；③ 后两项都是投递层的增量，做完 ① 的契约后更容易测。

---

## 1. Review 结构化 rubric（先做这个）

### 1.1 现状（实读）

- plan 产出 `waves.json`：`{taskType, waves:[{id,title,tasks:string[],riskNote}], status}`
- execute 产出回执：`{goalId,timestamp,receipts:[{taskId,status:'done|failed|skipped',summary,files}]}`
- review 产出 `reviews/<goal>-loop<N>.md`，文件末尾 fenced JSON：`{"verdict":"PASS|FAIL","feedback":"..."}`；schema 只有 `verdict` + `feedback`
- 下游：`PodTaskService.applyReceipt` 把回执写进 `pod_tasks`（done → `review`），Reviewer FAIL → 整个 goal 的任务 `reopened`；**没有 per-task 的评审结果**

### 1.2 目标契约

review 的 fenced JSON 增加 `tasks[]`：

```json
{
  "verdict": "PASS|FAIL",
  "tasks": [{ "taskId": "w1-t1", "result": "pass|fail|skipped", "evidence": "跑了什么命令/看了哪个文件" }],
  "feedback": "FAIL 时给具体修复指引"
}
```

规则（gateway 侧强校验，避免模型糊弄）：

1. `tasks[]` 必须覆盖 `waves.json` 里的**每一个** taskId；缺一个 → 该节点 `artifact_invalid`（沿用现有失败路径）
2. 只要有一个 `result=fail` 而 `verdict=PASS` → 判定为不一致，降为 FAIL 并把原因写进 feedback
3. 全部 `pass` 而 `verdict=FAIL` → 允许（保留人/评审的保守权），但 feedback 必填
4. 下游：`pod_tasks` 按 `result` 收口——`pass → done`、`fail → reopened`、`skipped → failed`；goal 归档的 `reconcileArchive` 仍是兜底

### 1.3 任务拆分（批准后展开成正式计划）

| # | 任务 | 文件（预期） | 测试 |
|---|---|---|---|
| 1 | 定义 rubric 类型 + 纯解析/校验函数 `parseReviewRubric()`（覆盖缺口/矛盾/全 pass 但 FAIL） | `gateway/src/core/goal/review-rubric.ts` | 单测：合法、缺任务、fail+PASS、PASS 无 feedback |
| 2 | review 节点 schema 与 prompt 扩展（要求 `tasks[]` 与证据） | `node-prompts.ts`（`REVIEW_OUTPUT_SCHEMA`、review 段落） | 单测：prompt 含 tasks 契约、schema 必填 |
| 3 | 完成判定接入 rubric（`completeNode` 读 reviews/*.md 后过 `parseReviewRubric`，失败即 `artifact_invalid`） | `driver.ts` / `completion.ts` | 单测 + 现有 completion 用例回归 |
| 4 | 任务板按 rubric 收口（`PodTaskService.applyReviewResults`） | `pod-task-service.ts` | 单测：pass/fail/skipped 三种映射；幂等 |
| 5 | 时间线/API 暴露 rubric（`GET /goals/:id/timeline` 带 `review.tasks`） | `routes/goal-timeline.ts` + SDK 类型 | 路由测试 + SDK 契约 |
| 6 | 桌面展示（Goal 详情里每条任务一个 pass/fail 徽标 + 证据 tooltip） | `GoalDetailOverlay` / `goal-timeline.ts` | 纯函数测试 + 接线契约 |
| 7 | 文档（AGENTS + spec 回写）与全量门禁 | `AGENTS.md` | 全量测试 |

**验收**：一次真实 goal 的 review 必须产出逐任务结果；任务板不再「全有或全无」地 `reopened`；缺失/矛盾 rubric 会让节点失败而不是静默 PASS。

---

## 2. 成员 readiness（第二）

- 现状：`pod_members.status` 有 `available|working|waiting|sleeping|retired`，但只有 UI 在用
- 目标：`PodMessageDelivery.deliver()` 在 `sleeping`/`retired` 时不强制 push（返回 `pending` 并写明原因）；`PodRailFace` 的「立即提醒」禁用条件从「有活跃会话」升级为「有活跃会话 **且** 成员不是 sleeping/retired」
- 体量：gateway 1 个判定 + desktop 1 处条件 + 测试
- 风险：状态由谁更新？目前 `pod_members.status` 变化源不清晰（需先查：是否有自动写 `working` 的地方）。**这也是它排第二的原因——先确认状态写入方，否则 readiness 是空信号。**

## 3. 已读回执（第三）

- 现状：`readAt` / `deliveredAt` 已记录，但发送方看不到
- 方案 A（轻）：右栏邮箱里「我发的消息」显示 `已读/未读` 徽标（只读本地数据，零写入）
- 方案 B（重）：成员 `markRead` 时给发送方写一条 `note` 级回执（会被 `[POD HANDOFF]` 注入，有噪音）
- **建议 A**，B 只在明确需要「跨会话确认」时再做
- 体量：A 是 1 个 UI 徽标 + 1 个纯函数

---

## 4. 不做的

- 动态增删成员、群聊广播、LLM 判完成（理由见 research §6）
- 把 rubric 结果回写成 execute 的 acceptance（当前 waves 只有 `tasks: string[]`，没有 acceptance 字段；要做的话是另一件事：给 waves 加 `acceptance[]`）

## 5. 下一步

批准这份路线图后：先按 `writing-plans` 出 **第 1 项** 的正式实现计划（7 个任务、每步 TDD 门禁），确认后 native 执行；第 2、3 项等第 1 项落地再各自立项。
