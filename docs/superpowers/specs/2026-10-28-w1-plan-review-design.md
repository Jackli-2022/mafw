# W1 Plan 审阅工作流 Design（2026-10-28）

> Roadmap：`docs/superpowers/plans/2026-10-27-frontend-gap-roadmap.md` W1。
> 已拍板决策（2026-10-27 用户）：**批准门默认 auto、可选 manual**（`planReview` 配置）；**面板走 goal 泳道下钻**，不动两级 dock IA。

## 1. 目标与动机

plan 节点的产出（waves.json）目前是机器产物：用户在 goal 泳道只能看到 outcome 字符串（`waves=3 taskType=feature`），看不到计划内容，更无法在计划上批注、批准、驳回。对标 Claude VS Code 计划批注（v2.1.70+）与 DSH plan review（批准/拒绝/忽略）。

**闭环**：plan 完成 → 用户看计划 → 满意批准进 execute；不满意批注 + 驳回，plan 带反馈重规划。

## 2. 非目标（v1 明确不做）

- 不改 plan 节点 prompt 产物契约（waves.json 不变；不新增 LLM Markdown 产物——确定性渲染替代）。
- **不做 per-loop 计划历史**（builder check 裁决）：waves.json 是覆盖式单份产物，v1 只有「最新计划」可看；历史 plan 格子不提供计划视图（保留 outcome 明细）。
- 不做桌面 goal 创建 UI / planReview 切换 UI（创建时经 MCP 参数声明，缺省 auto）。
- 不做「忽略」动作（manual 门只有批准/驳回）。
- 不动两级 dock IA（面板是 goal 详情的下钻浮层）。
- **批注驳回专用**（2026-10-28 用户拍板）：批注草稿只在驳回时打包进反馈；auto 模式提供「复制批注文本」（用户自行粘贴到任意会话）。**不做**「发送到当前节点会话」——向 goal 内部节点会话 mid-run 注入用户消息（steer 语义）无先例未验证，留 W5 steer 立项后重估。
- **TUI descope**（2026-10-28 用户拍板）：manual goal 批准/驳回只走桌面 GoalDetailOverlay + HTTP API；TUI 用户可看状态不能批（已知限制，记 AGENTS.md）。

## 3. 数据模型（gateway）

### 3.1 GoalStateV3 新增字段

```typescript
planReview?: 'auto' | 'manual';   // 创建时声明，缺省 'auto'；存 request.json 与 state 双处
planApproval?: {
  status: 'pending' | 'approved' | 'rejected';
  feedback?: string;              // 驳回反馈（批注打包文本 + 可选补充）
  decidedAt?: string;
  round: number;                  // 判定时的 loop
};
planFeedback?: string;            // 最近一次驳回反馈，注入下一轮 plan prompt
```

- `planReview` 写入点：`mafw_create_goal` / `mafw_set_goal` 接受 `planReview` 参数（校验枚举，非法忽略）→ request.json → starter 建立的 state v3 携带。
- 存量 goal 无字段 → 读侧 `planReviewOf(state) = state.planReview ?? 'auto'`（零迁移）。
- **planFeedback 清除点（builder check 裁决）**：plan 成功兑现时（completeNode plan ready 分支）置 `null`——反馈只属于「上一版计划」；need_clarification 与 attempt 失败重试不清（未兑现），防 review-FAIL 触发的下一轮 plan 被上一轮驳回意见污染。

### 3.2 路由（routing.ts）

`RouteState` 增 `planReviewGate: boolean`（driver 组装：manual && 上一 plan 成功且无 pendingQuestion）：

```typescript
routeAfterPlan(s): pendingQuestion → askUser；planReviewGate → 'await_plan_approval'；否则 execute
```

`await_plan_approval` **不是新节点**（无 session、无 node_run 行）：落在 state 上 `nextAction='AWAIT_PLAN_APPROVAL'`、`nextNode='execute'`、`planApproval={status:'pending', round}`，**不 advance**（合法驻留态）。

### 3.3 driver（completeNode plan 分支 + 审批入口）

- plan 成功（status ready）且 manual → 写 `planApproval pending`、parked（见上）；`goal_node` 事件照发（transition `finished`），另发一条 `phase_transition`（phase=`PLANNING_AWAIT_APPROVAL`，desktop 可 badge）。**该 phase 加入 `MILESTONE_PHASES` 白名单**（milestone-push.ts，ASKING_USER 先例）——manager 收到「计划待批」推送并转告用户，否则 manual goal 落入门后用户无主动信号。
- **advance 防御纵深（builder check 裁决）**：`advanceInner` 首行加守卫——`nextAction==='AWAIT_PLAN_APPROVAL'` 直接 return；仅 `approvePlan/rejectPlan` 显式改写后才可继续。测试钉「stray advance（legacy state_change 唤醒、幂等重放、examineStaleNode 的 `!ns → advance` 分支）不越门」。
- **终态冲突（builder check 裁决）**：`approvePlan/rejectPlan` 首查 `isTerminalState` → 409（防已取消 goal 被批准复活）；ABORT 控制流归档时顺带置 `planApproval: null`（取消语义 = 门也取消）。
- **attempt 推导修正（builder check 裁决）**：executeNode 的 attempt = 同 (goal, loop, node) 既有行存在（不论状态）即 max+1——修掉「驳回重跑得到第二个 attempt=1」的数据契约破绽；泳道 ×N 徽标/排序依赖此值。
- **watchdog/recovery**：`examineStaleNode` 与启动恢复遇 `nextAction==='AWAIT_PLAN_APPROVAL'` 直接 return（合法驻留，不判 stale、不重试）。
- `approvePlan(goalId)`：state 校验 pending 且非终态 → `planApproval={status:'approved', decidedAt, round}`、`nextAction='NEXT_execute'` → `advance()`。
- `rejectPlan(goalId, feedback)`：`planApproval={status:'rejected', feedback, decidedAt, round}`、`planFeedback=feedback`、`nextNode='plan'`（同 round 重跑；node_run 新行 attempt+1）→ `advance()`。
- **plan prompt 注入**（node-prompts.ts）：`ctx.planFeedback` 存在时加段「上一版计划被驳回，用户意见：…（本轮计划必须消化）」。
- 批准/驳回幂等：非 pending 状态调用返回 false（HTTP 409）。

### 3.4 HTTP API（能力无关，挂 goals 路由）

- `GET /api/goals/:id/plan`（无 loop 参数——只有最新计划，见非目标）→
  `{ planReview, planApproval, planFeedback, round, waves: <parsed waves.json | null>, wavePlanPath }`
  （读 `state.wavePlanPath`；文件缺失 → `waves:null`，不 500。）
- `POST /api/goals/:id/plan-approval` `{ approve: boolean, feedback?: string }`
  → approve: `{ok:true}`；reject 需 feedback 或批注文本非空，否则 400；非 pending 409；未知 goal 404。
- SDK/preload：`goals.plan(goalId, loop?)`、`goals.approvePlan(goalId)`、`goals.rejectPlan(goalId, feedback)`。

## 4. 桌面前端

### 4.1 计划渲染（纯函数，renderer）

`plan-render.ts`：`renderPlanMarkdown(waves)` —— waves.json → Markdown（`## Wave w1：标题` + tasks 列表 + `> riskNote`；`need_clarification` 状态渲染为「待澄清问题」清单）。单测钉扎。

### 4.2 PlanReviewOverlay（新组件）

入口：`GoalDetailOverlay` 泳道**最新 plan run** 的格子（历史 plan 格子不提供计划视图，保留 outcome 明细）——点击打开 overlay；manual + pending 的 plan 格子加「待批准」徽标 + 高亮。

内容（单浮层，Esc/点外关闭）：
- 头部：goal 标题 + loop 号 + 状态（待批准 / 已批准 / 已驳回 / auto 只读）。
- 正文：`renderPlanMarkdown` 输出经既有 Markdown 预览组件渲染（与聊天同款）。
- **批注（驳回专用，2026-10-28 拍板）**：正文划选 → 引文锚（复用 `annotation-anchor.ts` quote 锚 + `AnnotationSheet` 浮层，锚点定位复用 `annotation-placement.ts`）。批注草稿收集在 overlay 本地池：
  - manual + pending：驳回时全部打包进 feedback（引文块 + 意见）。
  - 其他状态：动作条提供「复制批注文本」（引文块 + 意见进剪贴板，用户自行粘贴）。
- 动作条（manual + pending 才显示）：
  - **批准** → `goals.approvePlan` → toast + 刷新泳道（goalsRev bump）。
  - **驳回并重新规划** → 反馈输入框（可空，批注草稿非空或输入非空至少其一）→ `goals.rejectPlan` → 刷新。
  - goal 已取消/终态：动作条隐藏，头部显示终态说明（approve 409 的 UI 前置防御）。

### 4.3 事件与刷新

- `phase_transition(PLANNING_AWAIT_APPROVAL)` / goal_node → 既有 `goalsRev` bump 链路自动刷新泳道与 overlay。
- timeline API（`GET /api/goals/:id/timeline`）响应增 `planReview` / `planApproval`（state 直读）。

## 5. 边界与失败

- 存量在飞 goal 无 planReview → auto 行为不变（读侧兜底）。
- gateway 重启时 parked（AWAIT_PLAN_APPROVAL）goal：恢复逻辑跳过（见 3.3）。
- 拒绝时 plan 会话已删除（completeNode 会删）——驳回重跑走 `advance('plan')` 建新会话，与既有重试同路。
- `need_clarification` 状态的计划：overlay 渲染问题清单；manual 门不拦（已有 askUser 通道）。
- 批注草稿不持久化（overlay 关闭即弃；electron-store 不进 goal 批注——拒绝状态污染）。

## 6. 测试要求（TDD）

- gateway 单测：routing 门（auto/manual/need_clarification 三态）、state v3 字段读写、driver park/approve/reject 幂等与终态校验、stray advance 不越门、watchdog 跳过、attempt 推导修正、prompt 注入 planFeedback 及其清除点、两个 HTTP 路由（deps 注入 harness）。
- desktop 单测：`renderPlanMarkdown`、overlay 视图模型（状态徽标/动作条显隐/终态防御）、批注草稿打包进 reject feedback、复制批注文本格式。
- 回归：desktop / gateway 全量绿；`planReview` 缺省路径零行为变化（auto 为默认，所有既有 goal 测试即回归）。

## 7. 交付切片（plan 阶段拆 Task 用）

1. gateway 数据模型 + routing + driver 门（park/approve/reject + 终态校验 + stray advance 守卫 + watchdog 跳过 + attempt 推导修正）。
2. node-prompts planFeedback 注入（含清除点）+ milestone 白名单 + HTTP 两路由 + SDK/preload。
3. desktop `plan-render.ts` + `PlanReviewOverlay` + 泳道入口/徽标。
4. 批注集成（quote 锚 + AnnotationSheet + 驳回打包/复制文本）。
5. 全量回归 + GUI 冒烟（manual goal 全流程：创建→park→看计划→批注→驳回→重规划→批准→execute）+ AGENTS.md 记录（含 TUI descope 已知限制）。
