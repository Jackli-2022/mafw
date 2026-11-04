# Tech Lead 按 Goal 持久入口 + 班底焦点行 · 设计

日期：2026-11-04 · 状态：已批（brainstorm 视觉伴侣逐屏点选 + 终端确认）
调研：`docs/research/2026-11-04-techlead-entry-industry-research.html`（Devin / Claude Code / Cursor / AutoGen / Windsurf / Naive / aweb / Jira-Elixion 对照）

## 1. 背景与问题

Lead 建完 Goal 说「交给 Tech Lead 了」之后，用户找不到与 Tech Lead 的对话入口：

- Lead chat 邀请条（`techLeadInvite`）只在 `stage.kind === "discussing"` 时渲染——阶段一推进就永久消失；
- 资源页「班底」行打开该成员**最新 live 会话**（`memberOpenTarget`），不按 Goal 区分，可能是别的 Goal 或 plan 节点会话（发送被门禁拦）；
- `GoalDetailOverlay` 头部没有任何 Tech Lead 按钮。

后端通路本身是通的：`GET /api/pods/:podId/goals/:goalId/tech-lead` → `ensureSession` 对任何非终态 revision 恢复/重建讨论会话。断链只在桌面入口层（spec 2026-11-02 §15 验收 #2）。

## 2. 已批决策（视觉伴侣 3 屏点选记录 + 用户终端确认）

> 用户原话：「直接建，lead 不讨论，tech lead 才讨论，可以直接建议用户，然后建 goal，甚至可以在 chat 页拉 tech lead，用户点击后就可以进入 tech lead 页讨论」

1. **入口 A**：Lead chat 邀请条持续化——Goal 非终态即显示（不再只在 discussing），带阶段标签；
2. **入口 B**：`GoalDetailOverlay` 头部常驻「与 Tech Lead 讨论」按钮（Devin「每一步一键可达」/ 任务为中心）；
3. **班底焦点行**（roster-focus）：行 = 目录 + 当前焦点（哪个 Goal 的讨论/实施/评审），点击打开该成员在 focus Goal 上的会话；
4. **否决**：roster-expand（展开跨 Goal 会话清单——班底变会话浏览器，与「Goal 才是承重面」有张力）；AutoGen 式共享群聊（spec 已拒绝 Goal 隔离例外）。

业界共识（三家一致）：持久 UI 表面 > 聊天内嵌链接；任务挂人（Jira/Elixion），班底行报焦点（aweb/Naive/Claude Code）。

## 3. 设计

### 3.1 入口 A：`techLeadInvite` 非终态化（`pod-store.ts`）

- 判定从「`stage.kind === "discussing" && stage.role === "tech_lead"`」放宽为「Goal 非终态」；终态权威信号 = `goal.endedAt` 非空（`PodGoal.endedAt`，SDK types.ts:1194）。`stage` 缺失不再返回 null（老 gateway 兼容：`endedAt` 是核心字段）。
- 邀请条增加阶段标签（`podStageLabel(goal.stage)`），让用户知道这个 Goal 现在在哪一步。
- `activeLeadGoalInvite`（MafwShell:2078）选择顺序：discussing 阶段优先，其次任意非终态——避免任意 Goal 抢占「刚建完」的引导位。

### 3.2 入口 B：Goal 详情头部按钮（`GoalDetailOverlay.tsx`）

- 位置：meta chips 行（现有「计划」按钮旁），`ButtonV2 variant="outline"`。
- 非终态：文案「与 Tech Lead 讨论」；终态（`podGoal().endedAt`）：「查看 Tech Lead 讨论」。
- 点击分两支（`techLeadEntryMode` 纯函数）：
  - 非终态 → `requestPodTechLeadOpen(goalId, activeRevision())` + `props.onClose()`——复用既有 shell effect（MafwShell:2106）→ `openTechLead` → `ensureSession`；
  - 终态 → 从 Pod detail 找该 Goal 已归档的 Tech Lead discussion 会话（`endedAt && transcriptRef`）→ `props.onOpenSession(sessionId)` 打开 transcript；无快照给「讨论已归档（无快照）」提示。**不走 ensure**——`GET tech-lead` 对终态 revision 返回 409（revision is terminal，复审 C1 实证）。
- **gateway / SDK 零改动。**

### 3.3 班底焦点行：`memberFocus`（新纯函数，`pod-model.ts`）

```
memberFocus(detail, memberId) → {
  focusText: string | null,          // "讨论「导出限流」" / "实施「导出限流」" / null=待命
  target:
    | { kind: "session" | "transcript"; sessionId: string }   // 现有 openSessionTab 通路
    | { kind: "techlead"; goalId: string }                    // requestPodTechLeadOpen 通路
    | null
}
```

- 节点词表：`discussion→讨论、plan→规划、execute→实施、review→评审、probe→探针、coordination→协调`（兜底「工作」）。
- **tech_lead**：goalId = 最新 live 会话的 goalId（无 live 会话时 = 第一个非终态 Goal）→ 恒走 `{kind:"techlead"}`（`openTechLead` 打开的是讨论 tab，可发送、标题正确）；全部终态时回退 `memberOpenTarget`（ended discussion transcript）。
- **lead**：维持 `memberOpenTarget`（`sessionId:""` → shell ensureLead）；focusText「协调中」。
- **builder/reviewer**：维持 `memberOpenTarget`；focusText 取最新 live 会话的节点 + Goal 标题，无 live → null（UI 显示待命）。
- 渲染面：`ProjectResources`（LeftDock 挂载）+ `PodDock` 团队 tab（ExecutionView 挂载）行内显示 focusText（替代现在的「打开会话/查看快照」文字；右侧开火钮保留），`techlead` 目标点击 → `requestPodTechLeadOpen(goalId, null)`——复用既有模块单例桥梁，不新增 props 穿透。

## 4. 非目标

- gateway / SDK / 运行时契约零改动（通路已具备）；
- 成员消息通道不动（邮箱 + A2A 默认、REST 回退，维持现状）；
- 不做 roster-expand 展开清单、不做群聊、不做 chat 消息内嵌链接入口。

## 5. 验收

1. Goal 处于 planning/implementing 等非终态阶段时，Lead chat 邀请条仍在（带阶段标签）；
2. Goal 详情头部按钮点击 → 关闭浮层 + 打开该 Goal 的 Tech Lead 讨论 tab（无 Session 选择）；
3. Tech Lead 班底行显示「讨论「X」」并点击进入该 Goal 讨论；Builder 行显示「实施「X」」点击看节点快照；无 live 会话显示待命不可点；
4. 终态 Goal：入口 A 消失；入口 B 降级为只读；班底 Tech Lead 行回退 transcript；
5. desktop 全量测试 + `tsgo -p` + `electron-vite build` 全绿，TDD（失败测试先行）。
