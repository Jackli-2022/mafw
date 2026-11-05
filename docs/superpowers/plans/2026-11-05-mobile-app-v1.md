# Mobile App v1 Implementation Plan（Tailscale 直连 + Pod）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `mobile/` Flutter 客户端上交付 v1：B 配色 3-tab 壳、Tailscale 直连收尾、work.overview 看 goal 跑动、创建讨论 + Tech Lead 讨论、自由讨论 + 交给 Lead、需要你三形态应答。

**Architecture:** 移动端只消费 flat View DTO + canonical/flat 双形态事件（既有 parity 测试守卫）；所有 agent 交互=消息流复用现有 chat 管线；讨论发送硬走 `tech-lead/messages` 专用通道；「需要你」内嵌 Goal 详情。前置：`docs/superpowers/plans/2026-11-05-mobile-gateway-p0.md`（P0）先行合入。

**Tech Stack:** Flutter（CI 钉 3.47.0，Dart ^3.13）、http/web_socket_channel/hive_ce/riverpod-free（setState/InheritedWidget 现状）、flutter_test。

**Spec:** `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`（§6-§11）；调研证据 `docs/research/2026-11-05-mobile-tailscale-pod-research.md`。

## Global Constraints

- B 配色 token（spec §3）：bg `#000` / surface `#0D0D0F` / border `#232327` / text `#FAFAFA` / dim `#9CA3AF`；accent 紫 `#7C3AED` **仅** ①需要你 ②激活态 ③CTA ④进行中节点；FAB 纯白 `#FAFAFA`；阶段徽标中性（`#1C1C20` 底 + `#C9C9D4` 字）；无绿红 verdict
- 事件词汇 parity：`mafw_models.dart` 词汇表与 `packages/gateway-sdk/src/events.ts` 集合+顺序钉死（`vocabulary_parity_test.dart`）——改词表必须同步
- 历史唯一形状 `{data: MafwMessage[], nextCursor}`；全页解析失败抛「upgrade gateway」可操作错误（`gateway_client.dart:70-82` 既有模式）
- **发送路由纪律**：Goal 绑定的讨论视图绝不调 `sendEnriched`/`promptAsync`（丢 agent 绑定 + ContextManifest）
- loopback-only 端点（`/a2a`、terminal）不触碰；媒体走 `/api/mobile/media/*`
- 门禁：`flutter analyze` 零告警 + `flutter test` 全绿；每 task 一 commit
- 非目标（spec §9）：无 FCM/离线推送、无 serve 路径、无编辑器面、无语音增强、无 iOS

## Review Focus

1. WS 断线重连后丢事件 → 重连成功必须触发 work/goal 数据 refetch（Task 5 测试）
2. 终态 Goal 的 `GET tech-lead` 409 / `{sessionID:null}` → 「讨论已归档」+ transcript，不弹错误（Task 12 测试）
3. plan-approval 提交遇 409 `stale_plan` → 提示重拉计划，不静默失败（Task 9 测试）
4. 点跨项目 attention 条目 → 先切换 active 项目再开 Goal 详情（Task 8 测试）
5. baseUrl 为裸 `100.x` IP → 配对/设置页警告并建议 MagicDNS 主机名（Task 2 测试）

---

## Phase 1 · 连接收尾

### Task 1: B 配色 token 落地

**Files:**
- Modify: `mobile/lib/src/theme.dart`（全量重写 ColorScheme/组件色）
- Test: `mobile/test/theme_tokens_test.dart`

**Interfaces:**
- Produces: `theme.dart` 导出 `class MafwPalette { static const black, surface, border, text, dim, faint, accent, accentDim, badgeBg, badgeText }`（值 = Global Constraints 的 B token 表）；`kMafwPrimary` 保留为 `Color(0xFF7C3AED)`（语义=accent）

- [ ] **Step 1: 写失败测试** — 断言 11 个 token 常量与 spec §3 表逐值相等；断言 `ThemeData` 的 `scaffoldBackgroundColor == black`、`colorScheme.primary == accent`
- [ ] **Step 2: 跑测试确认失败** — `cd mobile && flutter test test/theme_tokens_test.dart` FAIL
- [ ] **Step 3: 实现** — 按 token 表重写 theme.dart；退役粉/青/琥珀 chrome 用法（theme 内不引用）
- [ ] **Step 4: 跑测试 + analyze** — PASS + `flutter analyze` 零告警
- [ ] **Step 5: Commit** — `feat(mobile): B-way monochrome theme tokens (Grok minimal)`

### Task 2: 连接配置收尾（URL 校验 + 缺省清理 + Android 配置）

**Files:**
- Modify: `mobile/lib/src/config/connection_config.dart`（新增 `validateBaseUrl`）、`mobile/lib/src/services/secure_config_store.dart:21`（缺省改空）、`mobile/lib/src/pages/connection_settings_page.dart` 与 `pairing_page.dart`（接入校验/提示文案）、`mobile/android/app/src/main/AndroidManifest.xml`（`mafw://` intent-filter）、`mobile/android/app/src/main/res/xml/network_security_config.xml`（ts.net 域放行）
- Test: `mobile/test/connection_url_test.dart`

**Interfaces:**
- Produces: `enum UrlCheck { ok, bareIpWarn, plaintextLanWarn, invalid }` + `UrlCheck checkBaseUrl(String url)` — `http://*.ts.net` → ok；`http://100.64/10.…` 或裸 IP → bareIpWarn（提示改 MagicDNS 主机名）；`http://192.168./10./172.16.` → plaintextLanWarn（既有警告保留）；非 http(s) → invalid
- network_security_config：`<domain-config cleartextTrafficPermitted="true"><domain>ts.net</domain></domain-config>`（base 保持 false）；Manifest 增加 `<data android:scheme="mafw"/>` intent-filter

- [ ] **Step 1: 写失败测试** — checkBaseUrl 五形态断言；SecureConfigStore 无配置时 `load()` 返回空 baseUrl（非 `http://127.0.0.1:3000`）
- [ ] **Step 2: 确认失败** — `flutter test test/connection_url_test.dart` FAIL
- [ ] **Step 3: 实现** — 纯函数 + 存储缺省改空 + 两个页面对 warn/invalid 的提示文案（主机名建议含在文案里）+ `mobile/README.md` 连接章节更新（`MAFW_SERVER_API_TOKEN` 必设、MagicDNS 主机名优先与 Tailscale DNS 默认开启【V2】、`mobile.tailscaleUrl`/env 配置法）
- [ ] **Step 4: 跑测试 + Commit** — PASS；`git commit -m "feat(mobile): url form check (ts.net first), empty default, mafw:// intent-filter, ts.net cleartext domain"`

### Task 3: WS 层 v2 接线 + SmartReconnect 修复

**Files:**
- Modify: `mobile/lib/main.dart:120-121`（`WsClient` → `WsClientV2`）、`mobile/lib/src/network/ws_client_v2.dart`（升级支持 header 鉴权）、`mobile/lib/src/services/smart_reconnect.dart:182-183`（`toString()` → `jsonEncode`）
- Test: `mobile/test/smart_reconnect_test.dart`（新增）、`mobile/test/ws_auth_test.dart`（新增）

**Interfaces:**
- Produces: `WsClientV2.connect()` 时 headers 携带 `Authorization: Bearer <apiToken>`（非空才带）；`?deviceId=` 保留 query；`SmartReconnectManager.saveState/loadState` JSON 往返

- [ ] **Step 1: 写失败测试** — ① SmartReconnect `saveState`→`loadState` 往返保真（先写该 RED 用例钉 bug）；② WsClientV2 的 URL/headers 构造断言（token 非空带 header、空 token 不带）
- [ ] **Step 2: 确认失败** — `flutter test test/smart_reconnect_test.dart test/ws_auth_test.dart` FAIL
- [ ] **Step 3: 实现** — jsonEncode 修复 + v2 接线 + header 鉴权；移除 main.dart 中 v1 引用
- [ ] **Step 4: 跑全量 + Commit** — `flutter test` 全绿；`git commit -m "fix(mobile): wire WsClientV2, header auth, persist SmartReconnect state"`

## Phase 2 · 看 goal 跑动

### Task 4: 模型层 batch 1（work/presence/pod）

**Files:**
- Create: `mobile/lib/src/models/pod_models.dart`、Modify: `mobile/lib/src/network/gateway_client.dart`
- Test: `mobile/test/pod_models_test.dart`

**Interfaces:**
- Produces（模型）: `ProjectInfo{dir}`、`PodGoalView{goalId,title,status,bucket,revision,verdict,resultReady,strategy,stageOwner,stageKind}`、`WorkOverview{groups:Map<String,List<PodGoalView>>,counts:Map<String,int>}`、`PresenceInfo{running:List<String>,attention:List<AttentionItem>,unreadResultsCount:int}`、`AttentionItem{id,goalId,projectId,podId,kind,title}`
- Produces（client 方法，全带 Bearer）: `Future<List<ProjectInfo>> projects()`、`Future<WorkOverview> workOverview(String projectDir)`（路径 `Uri.encodeComponent`）、`Future<PresenceInfo> presence()`、`Future<List<PodGoalView>> listPodGoals(String podId)`（`GET /api/pods/:id/goals` → `items`）、`Future<PodInfo?> podLookup(String projectDir)`（404→null）、`Future<void> podEnsure(String projectDir)`、`Future<String> ensureLeadSessionId(String podId)`（取 `sessionId`）
- 删除: `listGoals()`/`getGoal()`（`/api/goals` 降级形状退役，调用方在 Task 6-8 迁移）

- [ ] **Step 1: 写失败测试** — 五桶 JSON → WorkOverview 解析（含空桶）；presence 聚合解析；404→null；半缺字段容错（verdict 可空）
- [ ] **Step 2: 确认失败** — `flutter test test/pod_models_test.dart` FAIL
- [ ] **Step 3: 实现** — 模型 + client 方法（JSON 源：spec §4.1 载荷；`GET /api/projects` 返回形状实读 `routes` 校准）
- [ ] **Step 4: 跑测试 + Commit** — PASS；`git commit -m "feat(mobile): work.overview/presence/pod client + models"`

### Task 5: 事件层（flat 帧分支 + 效果表扩展 + 重连 refetch）

**Files:**
- Modify: `mobile/lib/src/models/mafw_models.dart`（flat 帧解析：保留自身 type，`innerType==''` 现状不变，新增 flat 载荷字段直读）、`mobile/lib/src/models/event_effects.dart`（效果表）、`mobile/lib/src/network/ws_client_v2.dart`（重连成功回调）
- Test: `mobile/test/event_envelope_test.dart`（追加 flat 载荷用例）、`mobile/test/event_effects_test.dart`（追加效果用例）、`mobile/test/ws_reconnect_refetch_test.dart`（新增）

**Interfaces:**
- Produces: flat 帧 `MafwEvent` 直读字段 `goalId/loop/node/revision/transition/phase/verdict/error/attempt`（goal_node/phase_transition/state_change/user_question 四类）；效果表新增：`goal_node/phase_transition/state_change → refreshWork`、`user_question → refreshWork`、`pod.updated/pod.event → refreshWork`、`run.updated → refreshWork`；`WsClientV2` 增加 `onReconnected` 回调（重连成功触发一次）
- Consumes: 词汇表新增四类 flat 词必须在 `mafw_models.dart` 词表登记（parity 测试自动守卫，SDK events.ts 的 FLAT_EVENT_TYPES 已含）

- [ ] **Step 1: 写失败测试** — ① flat 帧解析：`goal_node` 原文 JSON → `innerType==''` 且 `goalId/node/transition` 直读命中；② 效果表对新增词全部 `refreshWork`（表驱动用例照抄现有钉死风格）；③ fake 断线→重连序列断言 onReconnected 恰好一次
- [ ] **Step 2: 确认失败** — 三文件 FAIL
- [ ] **Step 3: 实现** — 词表 + 解析 + 效果 + 回调；chat_page 对 flat 帧仍忽略（保持现状，讨论页不消费它们）
- [ ] **Step 4: 跑全量（parity 守卫自动过）+ Commit** — `flutter test`；`git commit -m "feat(mobile): flat-frame events, refreshWork effects, reconnect refetch hook"`

### Task 6: 3-tab 壳重构

**Files:**
- Modify: `mobile/lib/src/pages/sessions_page.dart`（NavigationBar 改 3 tab：工作/聊天/我的；Goal tab 移除；记忆 Tab 内容迁「我的」） 、`mobile/lib/main.dart`（home 路由配合）
- Test: `mobile/test/tab_shell_test.dart`

**Interfaces:**
- Produces: `SessionsPage` 的 tab 枚举 `{work, chat, me}`；`WorkTab` 为占位 Widget（Task 7 填充）；记忆检索/连接设置/扫码入口落「我的」
- Consumes: Task 1 的 palette

- [ ] **Step 1: 写失败测试** — 底部导航三枚；「聊天」与「我的」内容存在（记忆搜索框在「我的」）；Goal tab 不存在
- [ ] **Step 2: 确认失败** — FAIL
- [ ] **Step 3: 实现** — 重构（goal_detail_page 旧代码暂留，Task 8 重写）
- [ ] **Step 4: 跑全量（既有 sessions/widget 用例同步迁移）+ Commit** — `git commit -m "feat(mobile): 3-tab shell (work/chat/me)"`

### Task 7: 工作 tab（项目切换 + 需要你置顶 + 五桶 + FAB）

**Files:**
- Create: `mobile/lib/src/pages/work_tab.dart`、`mobile/lib/src/services/active_project.dart`
- Modify: `mobile/lib/src/pages/sessions_page.dart`（挂 WorkTab）
- Test: `mobile/test/work_tab_test.dart`

**Interfaces:**
- Produces: `ActiveProjectStore`（InheritedWidget 或顶层单例：`current(): String?` / `set(String dir)`，SharedPreferences 持久）；`WorkTab` 布局 = 项目切换器（`projects()` → 底部弹层）→ 需要你区（presence.attention 条目卡）→ Lead 入口条（占位，Task 14 接通）→ 五桶分组（needs_you/queued/in_progress/result_ready/ended，counts 徽标）→ FAB（占位回调，Task 11 接 composer）
- 刷新：15s Timer + `onReconnected` + `refreshWork` 效果（局部：按 goalId 更新对应卡片，不整页 setState 全拉）；attention 条目点击 → `onOpenGoal(projectId, goalId)`（跨项目先 `ActiveProjectStore.set`）

- [ ] **Step 1: 写失败测试** — ① 五桶渲染（feed WorkOverview fixture）；② 跨项目 attention 点击后 ActiveProjectStore.current == 条目 projectId 且 onOpenGoal 收到 goalId；③ refreshWork 事件只触发数据 refetch 不重建 tab（fake client 计数）
- [ ] **Step 2: 确认失败** — FAIL
- [ ] **Step 3: 实现** — 页面 + store；无项目/无 Pod/未连接三空态（spec §7.3）
- [ ] **Step 4: 跑测试 + Commit** — `git commit -m "feat(mobile): work tab (buckets, attention, active project)"`

### Task 8: Goal 详情页（重写）

**Files:**
- Rewrite: `mobile/lib/src/pages/goal_detail_page.dart`
- Test: `mobile/test/goal_detail_page_test.dart`

**Interfaces:**
- Consumes: Task 4 的 `PodGoalView`；本任务自带四个 client 方法与模型（放进 `pod_models.dart`）：`goalTimeline(String goalId)`（`{goal,nodes,artifacts,outcome}`）、`goalRevisions(podId, goalId)`（`List<RevisionInfo{revision,status,verdict}>`）、`goalResult(podId, goalId)`（`GoalResultInfo{verdict,acceptance,evidence,feedback}`）、`rejectGoal(podId, goalId, feedback)`（POST `/api/pods/:podId/goals/:goalId/reject`）
- Produces: `GoalDetailPage(podId, goalId, {initial: PodGoalView?})` — 头部（title/stage 徽标中性/revision/strategy）+ 需要你操作区（Task 9/13 填充组件位）+ 节点时间线（done=白实心✓/active=紫环/pend=灰空心，节点展开 attempt/耗时/verdict）+ 当前行动条 + **版本历史区**（revisions 列表渲染）+ **结果区**（终态：verdict/acceptance/证据列表 + 打回按钮 → 反馈输入 → `rejectGoal`，成功提示「已开启 revision N+1」并刷新）+ 底部「与 Tech Lead 讨论」按钮（占位回调，Task 12 接通）

- [ ] **Step 1: 写失败测试** — timeline fixture 渲染（三态节点）；`GET /api/goals/:id` 旧形状不再被请求（fake client 断言未调用）；stage 徽标中性色（palette.badgeBg）
- [ ] **Step 2: 确认失败** — FAIL
- [ ] **Step 3: 实现** — 页面重写 + `goalTimeline` client 方法 + timeline 模型
- [ ] **Step 4: 跑测试 + Commit** — `git commit -m "feat(mobile): goal detail rewrite (timeline, stages, B-way)"`

### Task 9: Plan 批准（需要你形态一）

**Files:**
- Create: `mobile/lib/src/widgets/plan_approval_card.dart`
- Modify: `mobile/lib/src/network/gateway_client.dart`（`goalPlan`/`planApproval`）、`goal_detail_page.dart`（挂卡）
- Test: `mobile/test/plan_approval_test.dart`

**Interfaces:**
- Produces: `GoalPlanInfo{approvalId, planHash, evalHash, waves:List<WaveInfo>, goalEval:List<String>}`（`GET /api/goals/:id/plan`）；`Future<void> planApproval(String goalId, {required bool approve, required String approvalId, required String planHash, required String evalHash, String? planFeedback})`（POST `/api/goals/:id/plan-approval`）；`PlanApprovalCard(plan, onApproved, onRejected)` — waves 摘要 + 批准（accent CTA）/驳回（描边）+ 驳回反馈输入
- 错误约定：响应 409 `stale_plan` → 抛 `StalePlanException`，UI 提示「计划已更新，请重拉」并触发 onRefresh

- [ ] **Step 1: 写失败测试** — ① plan fixture 解析；② 批准请求体四字段断言；③ 409 stale_plan → StalePlanException + UI 提示重拉（fake client 返回 409）
- [ ] **Step 2: 确认失败** — FAIL
- [ ] **Step 3: 实现** — 模型 + client + 卡片组件
- [ ] **Step 4: 跑测试 + Commit** — `git commit -m "feat(mobile): plan approval card with stale-plan handling"`

## Phase 3 · 创建讨论 + Tech Lead 讨论

### Task 10: 模型层 batch 2（pod 协作面）

**Files:**
- Modify: `mobile/lib/src/models/pod_models.dart`、`gateway_client.dart`
- Test: `mobile/test/pod_collab_test.dart`

**Interfaces:**
- Produces（全部带 Bearer，错误透传 `ApiException(status, body)`）:
  `createGoal(podId, {required String title, String? objective, List<String>? acceptance})` → `CreateGoalResult{goalId,revision,sessionID,status}`（`POST /api/pods/:podId/goals`，`source:'mobile'`）
  `openTechLead(podId, goalId, {int limit=50})` → `TechLeadHistory{sessionID?, messages:List<MafwMessage>}`（409/空租约 → sessionID=null）
  `sendTechLeadMessage(podId, goalId, String text)`（POST `tech-lead/messages`）
  `goalResult(podId, goalId)` → `GoalResultInfo{verdict, acceptance, evidence, feedback}`；`goalRevisions(podId, goalId)` → `List<RevisionInfo{revision,status,verdict}>`
  `directionDecision(podId, goalId, {required String mode, String? optionId, String? userWords})`、`answerQuestion(goalId, questionId, {String? answer, bool cancel=false})`
  `podEvents(podId, {String state='unread'})` → `List<PodEventItem>`；`markPodEventSeen(podId, eventId)`；`podTranscript(podId, sessionId)` → `List<MafwMessage>`

- [ ] **Step 1: 写失败测试** — 每方法一解析/请求断言用例（约 12 个）；`openTechLead` 的 409→`sessionID:null`、`messages:[]` 两分支
- [ ] **Step 2: 确认失败** — FAIL
- [ ] **Step 3: 实现** — 模型 + 方法
- [ ] **Step 4: 跑测试 + Commit** — `git commit -m "feat(mobile): pod collaboration client (createGoal/techLead/attention forms)"`

### Task 11: 新建讨论 composer

**Files:**
- Create: `mobile/lib/src/pages/goal_composer_page.dart`
- Modify: `work_tab.dart`（FAB → composer；无 Pod 时 `podLookup` 404 → `podEnsure`）
- Test: `mobile/test/goal_composer_test.dart`

**Interfaces:**
- Produces: `GoalComposerPage(podId, onCreated(CreateGoalResult))` — title（必填）+ objective（可选，与 title 至少其一的校验同服务端）+ 提交后 `createGoal` → 直接 `onCreated`（调用方跳 Goal 详情并进入讨论占位）；无 Pod 流：WorkTab FAB 先 `podLookup(dir)`，404 → `podEnsure(dir)` 后再进 composer

- [ ] **Step 1: 写失败测试** — 提交载荷断言（source:'mobile'）；空 title 空 objective 拒提交；创建成功回调带 sessionID/revision
- [ ] **Step 2: 确认失败** — FAIL
- [ ] **Step 3: 实现** — 页面 + WorkTab 接线
- [ ] **Step 4: 跑测试 + Commit** — `git commit -m "feat(mobile): goal composer (create discussion goal)"`

### Task 12: Tech Lead 讨论页

**Files:**
- Create: `mobile/lib/src/pages/tech_lead_discussion_page.dart`、`mobile/lib/src/services/send_router.dart`
- Modify: `goal_detail_page.dart`（「与 Tech Lead 讨论」→ 本页；终态走 transcript）
- Test: `mobile/test/tech_lead_discussion_test.dart`、`mobile/test/send_router_test.dart`

**Interfaces:**
- Produces: `SendRouter` — `resolve(view: {sessionID, goalBound: bool})`：`goalBound==true` → `sendTechLeadMessage`，否则 → `sendEnriched`（仿桌面 use-send-message.ts:407-416 分流）；`TechLeadDiscussionPage(podId, goalId)` — `openTechLead` 历史渲染（复用 chat 消息组件）+ `sessionID` 订阅 WS canonical 流（复用 event_effects 阶段指示）+ composer text-only + 终态分支：`sessionID==null` 或 409 → 「讨论已归档」横幅 + `podTranscript` 只读流
- 契约：`SendRouter` 对 `goalBound` 视图**永不**返回 enriched 通道

- [ ] **Step 1: 写失败测试** — ① SendRouter 契约：goalBound → techLead 通道（含「绝不调 sendEnriched」的负断言）；② 终态 409 → 横幅 + transcript 只读；③ 发送经 router 后 fake client 收到 `tech-lead/messages` 载荷
- [ ] **Step 2: 确认失败** — FAIL
- [ ] **Step 3: 实现** — router + 页面（复用 `MafwMessage` 渲染与 WS 订阅逻辑，与 chat_page 同源抽公共 widget 可选）
- [ ] **Step 4: 跑测试 + Commit** — `git commit -m "feat(mobile): tech-lead discussion page with send routing discipline"`

### Task 13: 方向裁定面板 + 问答卡

**Files:**
- Create: `mobile/lib/src/widgets/direction_panel.dart`、`mobile/lib/src/widgets/question_card.dart`
- Modify: `goal_detail_page.dart`（attention kind 分发挂卡）
- Test: `mobile/test/direction_question_test.dart`

**Interfaces:**
- Produces: `DirectionPanel(podId, goalId, {onDecided})` — 候选卡（选用态 accent 边）+ 自由文本裁定（`userWords`）→ `directionDecision(mode:'decided', optionId?, userWords?)`；`QuestionCard(goalId, questionId, question, {onAnswered})` — 回答输入 → `answerQuestion(answer:)` / `cancel` 按钮。两个组件 + Task 9 的 `PlanApprovalCard` 完成动作后调 `markPodEventSeen(podId, eventId)`（attention 条目自带 eventId 时），回写工作角标
- Consumes: Task 10 的 client 方法；attention 条目 kind ∈ {plan_approval, direction_review, question} 在 Goal 详情分发到 Task 9/13 组件；presence 是工作 tab 聚合源，pods events 的 seen 回写在本任务表单完成时落

- [ ] **Step 1: 写失败测试** — 选用候选 → `directionDecision` 载荷（mode:'decided'+optionId）；自由文本 → userWords 载荷；回答/取消两动作载荷；组件完成后 `markPodEventSeen` 被调（条目带 eventId 时）
- [ ] **Step 2: 确认失败** — FAIL
- [ ] **Step 3: 实现** — 两组件 + 详情页分发
- [ ] **Step 4: 跑测试 + Commit** — `git commit -m "feat(mobile): direction decision panel + question card"`

## Phase 4 · 自由讨论 + 交接

### Task 14: Lead 入口 + isManager 修复 + 聊天项目过滤

**Files:**
- Modify: `mobile/lib/src/models/mafw_models.dart:36`（`isManager` → `isLead`：`role == 'lead'`，兼容读 'manager'）、`work_tab.dart`（Lead 入口条接通）、`sessions_page.dart` 聊天 tab（`listSessions(projectID: active)`）、`main.dart`（Lead 会话打开路径）
- Test: `mobile/test/lead_entry_test.dart`

**Interfaces:**
- Produces: WorkTab Lead 条 → `ensureLeadSessionId(podId)` → 以「按裸 sessionID 开会话」入口进 ChatPage（ChatPage 增加可选 `MafwSession? session` → 允许 `sessionByID` 构造，title=「Lead」）；聊天 tab 按 ActiveProjectStore 过滤（无 active 项目显示全部并提示）；聊天 tab 新增「新话题」入口 → `createSession(directory: active)` → 直接进 ChatPage（显式目录，spec §7.7）

- [ ] **Step 1: 写失败测试** — isLead 判定（lead=true、manager 兼容 true、其他 false）；Lead 条点击 → fake `ensureLeadSessionId` 被调且导航目标 sessionID 正确；聊天列表带 projectID 参数断言；新话题 → createSession 收到 active 目录
- [ ] **Step 2: 确认失败** — FAIL
- [ ] **Step 3: 实现** — 模型/入口/过滤
- [ ] **Step 4: 跑测试 + Commit** — `git commit -m "feat(mobile): lead entry, lead role badge, project-scoped chat list"`

### Task 15: 交给 Lead（handoff）

**Files:**
- Create: `mobile/lib/src/services/lead_handoff.dart`
- Modify: `sessions_page.dart`（会话长按菜单「交给 Lead」）
- Test: `mobile/test/lead_handoff_test.dart`

**Interfaces:**
- Produces: `buildLeadHandoff(List<MafwMessage> history)` → `HandoffInput{title(≤80), objective, sourceRef{sessionID, snapshot(≤4000), capturedAt}}`（快照 = 最后一条 user + assistant 文本拼接，照抄桌面 lead-handoff.ts:46-70 语义）；`Future<void> handoffGoal(podId, HandoffInput)`（POST `/api/pods/:podId/goals/handoff`）；无 Pod 时先 `podEnsure`

- [ ] **Step 1: 写失败测试** — 快照拼接/截断（4000/80）；请求载荷断言；无 Pod ensure 流
- [ ] **Step 2: 确认失败** — FAIL
- [ ] **Step 3: 实现** — 服务 + 菜单接线（成功 → 跳 Goal 详情）
- [ ] **Step 4: 跑测试 + Commit** — `git commit -m "feat(mobile): handoff session to lead"`

---

## 阶段末真机冒烟（每阶段完成后执行，记录进交付汇报）

- **P1**：真 Tailscale（手机与 PC 同 tailnet）扫码配对 → MagicDNS 主机名连接 → chat 收发 + WS 事件通；裸 IP 输入出现警告；杀 App 重进 SmartReconnect 状态恢复
- **P2**：工作 tab 五桶与桌面 work.overview 一致；goal 跑动事件（phase_transition/goal_node）驱动卡片变化；跨项目 attention 点击切换正确
- **P3**：手机建讨论 Goal → Tech Lead 流式回复可见 → 终态后重进显示归档 transcript；plan 批准在手机上完成一次（含 stale_plan 场景）
- **P4**：跟 Lead 聊一轮；普通会话长按交给 Lead → 桌面能看到新 Goal

## 交付汇报要求

每 Phase 汇报：新增测试数、`flutter test` 全量通过数、commit 哈希清单；v1 收尾汇总版本号（pubspec version bump）+ 最终 commit；真机冒烟四组结果。
