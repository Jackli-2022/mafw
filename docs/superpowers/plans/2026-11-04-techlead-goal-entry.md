# Tech Lead �?Goal 持久入口 + 班底焦点�?Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让用户在任何阶段都能找到并进入当�?Goal �?Tech Lead 讨论（Lead chat 持续邀请条 + Goal 详情常驻按钮 + 班底焦点行）�?
**Architecture:** 纯桌面渲染层改动。三个入口全部汇到既有通路：`requestPodTechLeadOpen(goalId, revision)` �?shell effect �?`openTechLead` �?`GET .../tech-lead` �?`ensureSession`。班底行经模块单例桥梁（`pod-result-store`）路由，不新�?props 穿透。gateway / SDK / 运行时契约零改动�?
**Tech Stack:** SolidJS（props �?getter，源码契约测试用正则钉扎）、`@mafw/ui/v2` 组件、node --test + `@mafw/test-shim`（测试命令必须带 `--conditions=browser`）�?
**Spec:** `docs/superpowers/specs/2026-11-04-techlead-goal-entry-design.md`

## Global Constraints

- 禁止新增原生 `<button>`/`<input>`/�?`title`——一�?`@mafw/ui/v2` 组件（ButtonV2 等）�?- 用户可见文案绝不出现 runtime session id（spec 2026-11-02 §3.2）�?- gateway / SDK / 运行时契约不改动；成员消息通道（邮�?+ A2A 默认）不动�?- 测试运行命令：`node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test <files>`（workdir `packages/desktop`）�?- 每个任务 TDD：失败测�?�?实现 �?聚焦�?�?全量门禁�?Task 5 收口�?
## Review Focus

1. **终�?Goal**：`endedAt` 非空时邀请条消失、入�?B 降只读文案、班�?Tech Lead 行回退 transcript 而非 ensure——测试钉�?Task 1/2/4�?2. **Tech Lead �?live 会话 + 存在非终�?Goal**：班底行 target 应为 `{kind:"techlead"}`（ensure 通路），不是 null——钉�?Task 1�?3. **�?Goal 竞争邀请位**：discussing 优先于任意非终态——钉�?Task 3�?4. **�?gateway �?stage/bucket 字段**：invite 判定�?`endedAt` 为权威，`stage: null` 不再一票否决——钉�?Task 1（改既有断言）�?5. **跨项目瞬时竞�?*：`requestPodTechLeadOpen` �?`openTechLead` �?`podStore.detail()`（当前项目）；goal 不在�?`podStore.techLead` 自行解析 podId——已有实现兜底，Task 4 只需保证不抛未处�?rejection�?
---

### Task 1: 纯函数层——`techLeadInvite` 非终态化 + `memberFocus`

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pod-store.ts:22-38`（`techLeadInvite`�?- Modify: `packages/desktop/src/renderer/mafw/pod-model.ts`（新�?`memberFocus` + 节点词表，放 `memberOpenTarget` 附近�?- Test: `packages/desktop/src/renderer/mafw/pod-tech-lead-invite.test.ts`（改既有断言 + 新增�?- Test: `packages/desktop/src/renderer/mafw/pod-member-focus.test.ts`（新建）

**Interfaces:**
- Produces: `techLeadInvite(goal: { stage?: { kind?: string; role?: string } | null; endedAt?: string | null } | null, goalID: string): { goalId: string; label: string } | null`——仅 `endedAt` 非空或空 goalID 返回 null�?- Produces: `memberFocus(detail: PodDetail | null, memberId: string): { focusText: string | null; target: { kind: "session" | "transcript"; sessionId: string } | { kind: "techlead"; goalId: string } | null }`（`PodDetail` �?`@mafw/sdk` 导入，同文件已有）�?
- [x] **Step 1: 写失败测试（invite�?*

`pod-tech-lead-invite.test.ts` 更新：非终态各阶段（`planning` / `plan_approval` / `working` / `discussing`）都返回 invite；`{ stage: null }` �?`{}` 返回 invite（endedAt 缺失 = 非终态）；`{ endedAt: "2026-11-04T00:00:00Z" }` 返回 null；`""` goalID 返回 null。删除「`plan_approval` �?null」「`stage: null` �?null」旧断言（行为已�?spec §3.1 变更）�?
- [x] **Step 2: 写失败测试（memberFocus�?*

`pod-member-focus.test.ts` 新建，覆盖：�?tech_lead �?live discussion 会话 �?`{kind:"techlead", goalId}` �?focusText 含「讨论�?goal 标题>」」；�?tech_lead �?live 会话 + 存在非终�?Goal �?`{kind:"techlead", goalId: 该Goal}`；③ tech_lead 全部会话已结束且�?transcriptRef �?`{kind:"transcript"}`；④ lead �?`{kind:"session", sessionId:""}` + focusText「协调中」；�?builder live execute 会话 �?`{kind:"session"}` + focusText 含「实施」；�?成员无任何会�?�?target null + focusText null�?
- [x] **Step 3: 跑测试确认失�?*

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-tech-lead-invite.test.ts src/renderer/mafw/pod-member-focus.test.ts`
Expected: FAIL（invite 旧断言反转 + `memberFocus` 未定义）�?
- [x] **Step 4: 实现**

`techLeadInvite`：删�?stage kind/role 判定，改�?`if (!goalID || goal?.endedAt) return null`。`memberFocus`：`memberSessions` 复用（pod-model 内已有）；tech_lead goalId = 最�?live 会话�?goalId ?? `goals.find(g => !g.endedAt)?.goalId`；节点词�?`{discussion:"讨论", plan:"规划", execute:"实施", review:"评审", probe:"探针", coordination:"协调"}`，兜底「工作」�?
- [x] **Step 5: 跑测试确认通过 + 提交**

Run: �?Step 3。Expected: PASS�?Commit: `feat(desktop): widen techlead invite and add member focus`

### Task 2: 入口 B——GoalDetailOverlay 头部按钮

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailOverlay.tsx`（meta chips 行，「计划」按钮旁，约 563-567 行区域）
- Test: `packages/desktop/tests/goal-detail-unified.test.ts`（新增用例）

**Interfaces:**
- Consumes: `requestPodTechLeadOpen(goalId, revision|null)`（已 import，line 24）；`props.onClose`（已有，line 60）�?- Produces: 头部按钮——非终态文案「与 Tech Lead 讨论」，终态（`podGoal()?.endedAt`）「查�?Tech Lead 讨论」；点击 `requestPodTechLeadOpen(props.goalId, activeRevision ?? revision ?? null)` + `props.onClose()`�?
- [x] **Step 1: 写失败测�?*——源码契约：断言 GoalDetailOverlay 匹配 `�?Tech Lead 讨论`、`查看 Tech Lead 讨论`、`requestPodTechLeadOpen(props.goalId` �?`revision: goal?.activeRevision ?? goal?.revision` 一�?revision 回退链、以及点击后调用 `props.onClose()`�?- [x] **Step 2: 跑测试确认失�?*（Run �?Task 1 命令换文件；Expected FAIL）�?- [x] **Step 3: 实现**——`ButtonV2 variant="outline" size="small"`，`Show when={podGoal()}`；revision 用与 `goalSessionIdentity` 相同�?`activeRevision ?? revision` 回退�?- [x] **Step 4: 跑测试确认通过**�?- [x] **Step 5: Commit** `feat(desktop): goal detail techlead entry button`

### Task 3: 入口 A——Lead chat 邀请条持续�?+ 阶段标签

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:2078-2083`（`activeLeadGoalInvite` 排序 + stageLabel�?- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:203-210`（prop 类型�?`stageLabel?: string`）与 2146-2153（透传�?- Modify: `packages/desktop/src/renderer/mafw/components/PodTechLeadInvite.tsx`（`stageLabel?: string` prop，邀请条标题区显示）
- Test: `packages/desktop/src/renderer/mafw/pod-tech-lead-invite.test.ts` + `packages/desktop/tests/` 下覆�?invite 接线的契约测试（若无则在该文件加源码断言�?
**Interfaces:**
- Consumes: Task 1 的非终�?`techLeadInvite`；`podStageLabel`（pod-model，已有）�?- Produces: `activeLeadGoalInvite(): { goalId: string; title: string; stageLabel: string } | null`——discussing 阶段优先，其次第一个非终态；ChatPane prop �?`PodTechLeadInvite` props 增加 `stageLabel?: string`�?
- [x] **Step 1: 写失败测�?*——① 排序逻辑（可用提取的小纯函数测：discussing 优先�?working）；�?源码断言：ChatPane 透传 stageLabel、PodTechLeadInvite 渲染 stageLabel、shell �?`podStageLabel(goal.stage)`�?- [x] **Step 2: 跑测试确认失�?*�?- [x] **Step 3: 实现**——优先级选取：`goals.find(g => g.stage?.kind === "discussing" && invite(g)) ?? goals.find(g => invite(g))`；`stageLabel: podStageLabel(goal.stage)`�?- [x] **Step 4: 跑测试确认通过**�?- [x] **Step 5: Commit** `feat(desktop): persistent lead chat techlead invite`

### Task 4: 班底焦点行——ProjectResources + PodDock

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectResources.tsx:141-194`（班底行�?- Modify: `packages/desktop/src/renderer/mafw/components/PodDock.tsx`（团�?tab 成员行，�?183-244 行区域）
- Test: `packages/desktop/tests/project-resources-work.test.ts` + `packages/desktop/tests/pod-dock-wiring.test.ts`

**Interfaces:**
- Consumes: Task 1 �?`memberFocus`；`requestPodTechLeadOpen`（pod-result-store，模块级导入）�?- Produces: 行内焦点文字（`focusText ?? "待命"`）；点击路由——`target.kind === "techlead"` �?`requestPodTechLeadOpen(target.goalId, null)`，其�?�?既有 `props.onOpenSession(target.sessionId)`；`target === null` 时行不可点（保持现状样式）。可访问性：aria-label 用焦点文字（`打开 <成员> · <焦点>`），不含 session id�?
- [x] **Step 1: 写失败测�?*——源码断言两个组件都匹�?`memberFocus(`、`requestPodTechLeadOpen(`、`待命`；不再把「打开会话/查看快照」当行内唯一文字（保留在 aria/按钮 affordance 可）�?- [x] **Step 2: 跑测试确认失�?*�?- [x] **Step 3: 实现**——两处行渲染换成 memberFocus；techlead 分支点击�?requestPodTechLeadOpen；无 target �?`role`/`tabIndex` 不设置�?- [x] **Step 4: 跑测试确认通过**�?- [x] **Step 5: Commit** `feat(desktop): goal-aware roster focus rows`

### Task 5: 全量门禁 + 交付记录

**Files:**
- Modify: `AGENTS.md`（�?.27 末尾追加交付记录：commit 列表、测试数、门禁结果）

- [x] **Step 1: 全量测试**——`npm test`（workdir `packages/desktop`），Expected 全绿，记录总数与新增数�?- [x] **Step 2: 类型检�?*——`npx tsgo --noEmit -p tsconfig.json`，rc=0�?- [x] **Step 3: 构建**——`npx electron-vite build`，rc=0�?- [x] **Step 4: Commit** `docs: record techlead goal entry delivery`（含 AGENTS.md；若 spec/plan 尚未提交一并纳入）�?- [x] **Step 5: 汇报**——向用户汇报 commit 哈希、新增测试数、全量通过数（含聚焦与全量两层数字）�?