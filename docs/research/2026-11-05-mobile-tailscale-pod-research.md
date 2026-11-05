# Mobile + Tailscale + Pod 接入调研

日期：2026-11-05 ｜ 性质：纯研究，未改任何代码 ｜ HEAD：`d0752664`
调研人：主会话（gateway 网络面 / Tailscale 外部调研）+ 两个只读探索子代理（Pod/讨论链路 / mobile 应用现状），关键安全发现已由主会话独立复核。

## 0. 背景与三诉求

用户目标：做一个移动端 App，经 **Tailscale** 连到本地 gateway，能够：

1. **看 goal 跑动**——Pod 体系下 Goal 的执行状态、阶段、结果；
2. **点击创建讨论**——直接建讨论型 Goal，进入 Tech Lead 讨论；
3. **自由讨论**——与 Lead / Tech Lead 的自由聊天。

本文按组件逐节盘点现有资产与冲突点，给出方案矩阵与分阶段路线建议。所有结论均来自当日实读代码（文件+行号），外部事实附来源。

---

## 1. 一页结论

**连接层离目标很近，业务层是从 0 到 1，且有一个必须先修的安全洞。**

| 层 | 判断 |
|---|---|
| Tailscale 连通性 | ✅ 基本就绪。gateway 绑全部网卡、apiToken 三通道鉴权、配对深链（Tailscale IP 优先探测）、mDNS、`/api/ws` 事件管道全部现成 |
| 安全 | 🔴 **P0：registry dispatch 先于 token auth**（§2.1），Pod/协作面 40+ 路由远端无 token 可调；serve 反代路径还会整体绕过 apiToken（§6.2） |
| Pod 服务端 API | ✅ 讨论型 Goal 创建、Tech Lead 隐藏会话 + 专用消息通道、五桶/时间线/presence/事件流全部就绪（§4） |
| 移动端 App | ⚠️ 是一个契约对齐的聊天客户端（flat DTO + canonical 事件 + CI parity），但 **Goal Tab 因契约错位完全失效**、Pod 面为零、FCM 是占位符（§5） |
| 离线推送 | 🔴 服务端只存 FCM token 从不发送（全仓无 FCM send）——现状=只有前台 WS 实时性 |

---

## 2. Gateway 网络暴露面与鉴权

### 2.1 🔴 Critical：registry dispatch 顺序回归（已独立复核）

`gateway/src/index.ts`：

```
5258  const server = http.createServer(async (req, res) => {
5262    // P5 Wave 1: registry dispatch —— 注释声称「挂在鉴权之后」
5266    { const matched = this.routeRegistry.match(req.method, req.url);
5268      if (matched?.def.handler) { ... return; } }     ← 先 dispatch
...
5291    if (!authorizeRequest(...)) { 401; return; }        ← 后鉴权
```

- **实际顺序：dispatch（5266）→ auth（5291）**，与 5262-5265 注释相反。疑似顺序回归或注释失真。
- 后果：`/api/pods/*`、`/api/projects/:id/work`、`/api/pods/:id/goals/:goalId/tech-lead*`、`session.fork/config/switchAgent` 等全部 registry-attached 路由（route-catalog 登记 + handler 挂载，`routes/pod-handlers.ts:18-78`）**从 Tailscale IP 调用不需要 token**。
- 桌面/本地不可见此问题（loopback 本来就豁免）。**任何远端暴露（Tailscale 直连/serve/Funnel）之前必须先修**。
- 修复方向：dispatch 块移到 authorizeRequest 之后（注意保留「goals.sessions 先于 dashboard 兜底」等顺序教训，AGENTS.md §6.5）；或 registry dispatch 内部统一过 auth 门。

### 2.2 正常鉴权模型（内联链路由）

`gateway/src/core/auth.ts:40-48`：

- loopback（127.x / ::1）恒放行；非 loopback 必须匹配 `server.apiToken`（`MAFW_SERVER_API_TOKEN`）；
- 三通道：`Authorization: Bearer` / `X-API-Token` / `?token=` query；WS 升级同规则（`auth.ts:75-86`）；
- **空 token + 远端 = 全拒**（非宽松）——配 Tailscale 前必须设 token；
- 日志脱敏 `redactLog()`（auth.ts:120-124）。

监听：`server.listen(this.apiPort)` 无 host 参数 → **绑定全部网卡**（index.ts:8474），Tailscale 网卡（100.x）可直达，无需改动。

### 2.3 硬性 loopback-only（Tailscale 上不可用，移动端不需要）

- `/a2a`（A2A Media Agent，index.ts:5311）、terminal WS（index.ts:8588）、file-history（index.ts:5297-5300）。
- 移动端媒体走专用代理 `/api/mobile/media/tasks`（见 §3），TTS artifact 走 `/api/mobile/tts/artifacts/:id`（token 认证版，替代 loopback-only 的 /a2a/artifacts，index.ts:5630-5647）——**已经为移动端绕开了 loopback 限制**。

### 2.4 事件管道（单一广播漏斗）

`broadcast()`（index.ts:3727-3750）：每个事件同时发给 ① SSE `/api/events`（带 `event_log` 持久化 + `Last-Event-ID`/`?since` 回放）② WS `/api/ws`（同一 JSON 帧，连接即收 `{type:'connected', vocab:'v2'}`）③ PushGateway 在线移动设备。seq 单调递增（`id:` SSE 行）。

与 goal 跑动相关的事件（重要：**双形态**）：

| type | 形态 | 载荷要点 | 广播点 |
|---|---|---|---|
| `goal_node` | **扁平帧**（非信封） | goalId/loop/node/revision/transition/verdict/error/attempt/durationMs | driver.ts 多点 → index.ts:1129-1132 |
| `phase_transition` | 扁平帧 | goalId/phase/loop/projectDir/revision | flat-emit-registry.ts:20 |
| `state_change` | 扁平帧 | goalId/patch/projectDir | flat-emit-registry.ts:17 |
| `user_question` | 扁平帧 | goalId/questionId/question | flat-emit-registry.ts:18 |
| `goal_created` | 扁平帧 | goalId/projectDir（**讨论型 Goal 不发**） | flat-emit-registry.ts:16 |
| `pod.updated` | canonical 信封 | `properties:{podId, kind(goal/task/message/direction/result/probe), goalId?}` | index.ts 多点 |
| `pod.event` | canonical 信封 | `properties:{podId, eventId, goalId, revision, kind, severity}`（p1=归档 PASS/FAIL/…） | index.ts:8923-8938 等 |

移动端现有 `MafwEvent` 解析（mafw_models.dart:226-239）明确：扁平帧保留自身 type、`innerType==''`——**`goal_node`/`phase_transition` 需要单独的扁平帧分支**（当前 chat_page.dart:162 对非 canonical 直接 return）。

---

## 3. Gateway 移动基建（`gateway/src/mobile/`，6 模块）

| 模块 | 功能 | 关键事实 |
|---|---|---|
| `pairing.ts` | 单次配对码 | `mafw://pair?url=&token=&v=1&exp=&nonce=`；nonce sha256 存储、5min TTL、非 loopback 限速 5 次/min；`updateConfig` 支持热更（pairing.ts:118-122） |
| — 探测 | `detectReachableHost()`（index.ts:4699-4717） | **Tailscale 网卡名 > LAN > 首个 IPv4** 优先；`MAFW_MOBILE_TAILSCALE_URL` 环境变量覆盖 → serve/https 场景直接配 |
| `mdns-advertiser.ts` | `_mafw._tcp` LAN 发现 | TXT 带 port/ws/auth（bonjour-service） |
| `device-store.ts` | 设备表 | `~/.mafw/mobile-devices.json`，7 天未见 prune |
| `push-gateway.ts` | 在线 WS 设备 + 事件转发 | 只发 `onlineDevices`（WS 连接且带 `?deviceId=`）；全局 + 单设备 1 msg/s 限速、3 次指数退避 |
| `media-proxy.ts` / `tts-artifact.ts` | 移动媒体面 | `POST /api/mobile/media/tasks(+/ask)`、`GET /api/mobile/tts/artifacts/:id`（token 版） |

HTTP 面（index.ts）：`GET /api/mobile/pairing-code`（6905）→ `POST /api/mobile/pairing/verify`（6926，消费 nonce）闭环；`POST /api/devices`（6824）等 6 个设备管理端点。

🔴 **FCM 发送侧不存在**：全仓 grep 无 `fcm.googleapis.com`/firebase-admin——fcmToken 只入库不发送。「离线推送」= 在线 WS only；移动端 App 的 firebase.json/google-services.json 也是占位符（§5）。真做离线通知需要：服务端 FCM sender + 真实 Firebase 项目，或接受「打开 App 才看到」。

---

## 4. Pod / Goal / 讨论服务端 API 面（移动端要消费的全集）

### 4.1 「看 goal 跑动」读模型

- **`GET /api/projects/:projectId/work`**（routes/pod-work.ts:31-71）：work.overview 五桶 `{groups{needs_you,queued,in_progress,result_ready,ended}, counts, total}`；只读不建 Pod，无 Pod 404。`projectId` = **URL-encode 的项目绝对路径**。
- `GET /api/presence`（routes/presence.ts:10-16）：跨项目 `{running[], attention{count,items}, unreadResults{count,latest}}`。
- `GET /api/goals/:id/timeline`（routes/goal-timeline.ts:23-69）：节点级泳道 `{goal, nodes[], artifacts, outcome?}`，无 state 404。
- `GET /api/pods/:podId/goals`（pods.ts:367-390）：`{items: PodGoalView[]}`——`{goalId, status, title, phase, verdict, stage{owner,kind,action}, bucket, resultReady, strategy, activeRevision, revision, priority, …}`（pod-view.ts:67-94）。
- `GET /api/pods/:podId/events`（?state=unread）+ `POST .../events/:id/seen`（routes/pod-events.ts:26-41）：人侧事件收件箱。
- ⚠️ **`GET /api/goals` 与 `GET /api/goals/:id` 是 legacy 降级面**：都落 dashboard 兜底返回 `{goals:[{goalId, phase, loop, nextAction, error, updatedAt}]}` 列表形状（index.ts:9607-9619），**`:id` 没有单条语义**——移动端现有 Goal 页消费的就是这个失真形状（§5）。应改用 work.overview + pod.result + timeline + revisions。

### 4.2 「创建讨论」链路（服务端已完备）

`POST /api/pods/:podId/goals`（pods.ts:391-454）→ `PodTechLeadService.createGoal`（pod-tech-lead-service.ts:141-296）：

- 请求体：`{title*, objective?|charter?（至少其一）, acceptance?[], boundaries?[], metrics?, priority?, maxLoops?, budget?, taskType?, planReview?('manual'|'auto'), source?, sourceRef?, actorSessionID?}`；
- **`source` 白名单无 `mobile`**（pods.ts:605-617：desktop|lead|a2a|automation|user|tui|agent）——移动端传 `user` 过渡，或扩枚举；
- 响应（SDK types.ts:1319-1332）：`{podId, goalId, status:'discussing', revision:1, stage, sessionID(隐藏Tech Lead会话), goal:{PodGoalView}, sessionError?, promptError?}`；
- 链路：写 goal.md/request.json（`discussion:true, autoStart:false`，不发 goal_created）→ revision 1 discussing → `ensureScopedSession`（作用域 `(podId, tech_lead, goalId, revision, 'discussion')`）→ `registerInternalSession`（隐藏）→ 开场 prompt（带 `[CONTEXT MANIFEST]`，异步）；
- **人类不带 actorSessionID 直接放行**；带时校验 Lead（本地信任模型，pod-collaboration.ts:5 注释原文「审计提示而非认证边界」）。

配套：`GET /api/projects/:projectId/pod/lookup`（404=无 Pod）、`POST /api/pods/:podId/lead/ensure`（唯一显式 Lead 会话修复入口）、`POST .../direction-decision`（方向裁定，无 actor 人类放行）、`POST .../reject`（打回开 revision N+1，feedback 必填）、`GET .../revisions`（append-only 历史）。

### 4.3 「自由讨论」的本质与双形态

**结论：「自由讨论」不是独立实体**。桌面 §5.26 描述已被 §5.27 取代（WorkspaceHome 已删除，context-menu-wiring.test.ts:26 断言不存在）；「自由讨论」语义现存两处：

1. **WorkOverview 空态文案**「向 Lead 交代一件事，或用『新话题』先讨论」（WorkOverview.tsx:82）——「先讨论」= 直接开普通会话聊；
2. **「交给 Lead」handoff**（ChatPane 更多菜单）：普通会话（`isHandoffableRole`——`lead-handoff.ts:6-21`，排除内部角色）→ `buildLeadHandoff`（lead-handoff.ts:46-70：最后一条 user+assistant 文本、快照 4000 字、标题 80 字、`sourceRef:{sessionID, snapshot, capturedAt}`）→ `POST /api/pods/:podId/goals/handoff`（pods.ts:314-365，要求 sourceRef.snapshot，先 ensureLead）→ 打开 GoalDetail。源会话永不改动（MafwShell.tsx:464-467）。

**移动端消费「自由讨论」的两条路径**：

**A. Tech Lead 讨论（Goal 绑定）**——本质是**隐藏 opencode runtime 会话**（roles 含 `tech_lead`，core/session-visibility.ts:30-51，不出现在 `GET /api/sessions`）：

- 打开：`GET /api/pods/:podId/goals/:goalId/tech-lead?limit=`（pod-collaboration.ts:62-84）= **ensureSession + 返回 flat 历史数组 + sessionID**（`history()` 内部顺带重建死亡会话）；
- 发言：`POST .../tech-lead/messages {text}`（pod-collaboration.ts:45-60）→ `PodTechLeadService.prompt`（正文前拼当前 revision 的 ContextManifest + `agent:'mafw-tech-lead'` 绑定，pod-tech-lead-service.ts:308-320）；
- 🔴 **消息路由纪律：讨论 tab 绝不能直接 `promptAsync`/`chat/enriched` 发到该 sessionID**——会丢 Tech Lead agent 身份绑定 + ContextManifest（pod-store.ts:58-62 注释明示；桌面 use-send-message.ts:407-416 按视图分叉发送）；
- 实时流：订阅该 sessionID 的常规 SSE/WS canonical 事件（`message.updated`/`part.*`/`turn.*`）——**移动端现有 chat 渲染管线可直接复用**，只差发送按钮分流；
- 终态：revision 终态时 GET tech-lead 409（`requireActiveRevision`）；无存活租约 `history()` 返回 `{sessionID:null, messages:[]}`——回落 `GET /api/pods/:podId/sessions/:sessionId/transcript`（已归档快照，pods.ts:507-515）。

**B. Lead 普通聊天 / 新话题**——普通会话 API（全部内联链、受 token 保护）：

1. `POST /api/session {directory}`（index.ts:7489-7512，**建议显式传 directory**）；
2. `GET /api/sessions/:id/messages?limit=&before=`（flat DTO 唯一出口，routes/session-history.ts:37-64）；
3. 发送：`POST /api/chat/enriched`（记忆注入；⚠️ **不传 sessionID 会落到第一个注册项目**，index.ts:5928-5929——多项目必须先建会话）或 `POST /api/session/:id/promptAsync`；
4. 实时：SSE `GET /api/events?sessionID=` 或 WS `/api/ws`；
5. 交接：`POST /api/pods/:podId/goals/handoff`（sourceRef 自拼，照抄 lead-handoff.ts 逻辑）。

移动端 App 已有 1-4 的雏形（gateway_client.dart:85-112 + chat_page.dart），缺的只是入口组织与 handoff。

### 4.4 讨论会话的会话管理语义

- `PodSessionSupervisor` 按 `(podId, memberId, goalId, revision, kind)` 租约管理，跨重启 generation+1 重建；同 revision 讨论与 plan 复用会话，revision 终态 snapshot+retire（pod-session-lifecycle.ts）；
- 2026-11-04/05 已修的两个运行时缺口（运行中的 gateway 需 ≥ 对应 commit）：plan 复用讨论会话的结构化交卷收账（`4a6d6cbb`）；quick 路径 goal-eval 派生（`d0752664`）；grace 90s 时限（`15aeda0d`，已部署）。

---

## 5. Mobile Flutter 应用现状（`mobile/`，仓库根目录）

### 5.1 概况

- Flutter（CI 钉 3.47.0，`ci.yml:118-134`，`mobile/**` 变更触发 analyze+test）；23 个 dart 文件；Material 3 AI 紫主题；
- 页面：pairing（扫码/手动）/ connection-settings / sessions（底部 4-Tab：会话/Goal/记忆/我的）/ chat / goal-detail / triage；
- **chat 是能用的**：flat DTO 历史 + WS canonical 事件驱动（Perplexity 式三阶段指示）+ `POST /api/chat/enriched` 发送 + Hive 离线兜底（TTL 24h、50 条/会话、纯文本）；
- 网络：`GatewayClient` 16 个方法（health/sessions/messages/createSession/sendEnriched/memory/goals/triage/media/tts）；WS `/api/ws` query token 鉴权；
- 测试：10 文件 86 例，含 **37 词 canonical 词汇表与 SDK parity 钉死**（vocabulary_parity_test.dart）与效果表全量钉死（event_effects_test.dart）。

### 5.2 三诉求现状

| 诉求 | 现状 |
|---|---|
| ① 看 goal 跑动 | 🔴 **Goal Tab 完全失效**：列表读 `title/status/id`（sessions_page.dart:276-300），网关实际返回 `{goals:[{goalId, phase, loop, nextAction, error, updatedAt}]}` → 空标题空状态、`goalId` 读不到 → 行不可点；详情页期望 `progress/sessions/evidence` 全不命中 → 恒落「详情不可用」空态（goal_detail_page.dart:57-63,184-196）。无 work.overview/presence/timeline 消费；`pod.*/run.*` 事件效果表全 `none` 不触发刷新；扁平帧（goal_node/phase_transition）被当非 canonical 丢弃 |
| ② 创建讨论 | 🔴 零：GatewayClient 无任何 pods.* 方法，无 Goal composer，无 pod lookup/ensure。服务端面已齐（§4.2） |
| ③ 自由讨论 | 🟡 底座在：通用聊天链路完整（理论上对任何拿到的 sessionID 都能聊，`_navigateToSession` 骨架在，main.dart:188-211）。缺：隐藏会话不出现在 `/api/sessions`（特性）→ 讨论入口必须从 Goal 进（`GET tech-lead` 拿 sessionID）；无 tech-lead 消息通道；`MafwSession.isManager` 只认 legacy `'manager'`（mafw_models.dart:36）→ Lead/tech-lead 徽标不渲染；ChatPage 构造必须传 `MafwSession` 对象，没有「按裸 sessionID 开会话」入口 |

### 5.3 横切缺口（影响落地的基础设施）

1. **明文策略自相矛盾**：`network_security_config.xml` 全禁 cleartext + `usesCleartextTraffic="false"`，但 SecureConfigStore 缺省 baseUrl 是 `http://127.0.0.1:3000`（secure_config_store.dart:21）、mDNS 发现拼 `http://$host:$port`（mdns_discovery.dart:30）——与策略直接冲突；
2. **`mafw://` 深链无 intent-filter**（Manifest 只有 LAUNCHER）——桌面生成配对码后无法从外部链接打开 App，只能 App 内扫码/粘贴；
3. WS v1 在用（无重连上限）；WsClientV2 + SmartReconnect 未接线，且 SmartReconnect 持久化 bug（`.toString()` 而非 `jsonEncode`，smart_reconnect.dart:182-183）原样未修（BRAINSTORMING_V2 G1/G2）；
4. FCM 占位符（firebase.json `mafw-mobile-placeholder`）→ 推送整体不可用；
5. `error_models.dart` 是死代码（无页面引用）；审批/问答事件（permission.asked/question.asked）效果 `none` 无 UI 出口——Pod「需要你」（plan 批准/方向裁定/提问）在移动端没有应答面（服务端 `goals/:id/plan-approval`、`questions/:qid/respond` 齐备）；
6. 每 WS 事件全量重拉历史（250ms 防抖，BRAINSTORMING_V2 G9 未修）——对「看 goal 跑动」的高频事件不友好，建议 Pod 面用增量/按需拉取。

---

## 6. Tailscale 连接方案对比

### 6.1 三条路径

| | **A. 直连 tailnet**（推荐主路径） | **B. tailscale serve（443）** | C. Funnel |
|---|---|---|---|
| URL | `http://100.x.y.z:3000` 或 `http://machine.<tailnet>.ts.net:3000` | `https://machine.<tailnet>.ts.net`（443） | `https://machine.<tailnet>.ts.net`（公网） |
| 手机要求 | 装 Tailscale App（VPN 开着） | 同左 | 不需要 VPN |
| gateway 改动 | **零**（已绑全网卡） | 零代码，需 `tailscale serve --bg localhost:3000` + tailnet 开 HTTPS 证书 | 同 B |
| Android 侧 | 需 network security config 按域放行 cleartext（`ts.net` 或 100.x 段） | **零**（Let's Encrypt 公共证书，系统原生信任） | 零 |
| apiToken | **生效**（remote=100.x 非 loopback → 必须 token） | **被绕过**（见 6.2）→ tailnet 成员资格即边界 | 被绕过 + 公网暴露，双重危险 |
| WS/SSE | 原生直连，无代理风险 | 经 serve 反代：WS query 剥离 issue（#18651，Open/官方无法复现）与 WS 掉线 issue（#18827）有报告；**规避法：WS 鉴权走 header**（dart:io `IOWebSocketChannel.connect(url, headers:{Authorization})` 支持，mobile 代码注释「不支持 header」是误判，仅 Flutter Web 不支持） | 同 B + 更糟 |
| 配对 | 现有 `detectReachableHost()` 已优先 Tailscale IP，`mafw://pair` 直接可用 | 设 `MAFW_MOBILE_TAILSCALE_URL=https://machine.<tailnet>.ts.net`（env 已支持，index.ts:4715-4716） | 同 B |
| 已知限制 | Android 9+ 默认禁 cleartext；明文在 WireGuard 隧道内本身加密 | serve 的 `--https=3000` 与 gateway 自身 0.0.0.0:3000 **端口冲突** → 只能用 443；reverse proxy 目标只支持 `http://127.0.0.1`（官方 CLI 文档） | HA 官方指南原话「你几乎肯定不想要 Funnel」；不推荐 |

### 6.2 🔴 serve/Funnel 路径的鉴权绕过（设计必须知道）

`tailscale serve` 的 reverse proxy **只支持 `http://127.0.0.1` 目标**（官方 CLI reference），即经 serve 进来的请求到达 gateway 时 `remoteAddress` 是环回 → `isLoopbackAddr` 命中 → **apiToken 检查整体跳过**。后果：

- 任何 tailnet 成员设备（serve 路径）/ 任何公网客户端（funnel 路径）都能免 token 访问 gateway 全部内联链路由 + §2.1 的 registry 路由；
- serve 会注入 `Tailscale-User-Login` 等 identity headers（并剥掉外部伪造的同名 header，官方文档）——**可选加固**：gateway 增加「strict identity 模式」校验该 header 匹配期望用户；
- 也可用 tailnet ACL 限制哪些设备能访问本机 443。

**安全排序**：A（token 生效，双层）> B（tailnet 即边界，个人单用户 tailnet 可接受 + 可选 identity header/ACL 加固）>> C（不推荐）。

### 6.3 手机侧体验事实（外部调研）

- Tailscale Android App 支持常开 VPN（Always-on）+ 后台电池豁免设置；Android 15 有 always-on VPN 30-120 分钟掉线报告（tailscale#15736，与「允许后台使用」设置相关）——**交互式使用（打开 App 看 goal/聊天）按需连 VPN 足够；要息屏收通知才需要常开**，而息屏通知目前被 §3 的 FCM 缺口挡住，所以 v1 不需要常开 VPN；
- 先例模式（Tailscale 官方 Home Assistant 指南，2026-07 更新）：HA 主机装 Tailscale addon + `tailscale serve` + MagicDNS + HTTPS 证书，手机 App 填 ts.net URL——与我们的 B 路径同构；HA 社区亦有「internal/external URL 双填」惯例（对应我们的 A/B 双支持）；
- `tailscale cert` 证书是 Let's Encrypt 签发的 ts.net 域名证书（公共信任链，Android/iOS 原生信任，无需自装 CA）。

### 6.4 推荐连接策略

**v1 主路径 A（直连 tailnet + apiToken）**，理由：零新增组件、配对服务现成、鉴权最强、无 WS 代理风险；Android 侧给 `ts.net` 域 + 100.64.0.0/10 段做 network security config 域级放行（而非全局开 cleartext）。
**可选并存 B（serve 443）**：给「不想配 cleartext 放行」的场景；前提是先修 §2.1 鉴权洞（否则 serve 路径=裸奔）。配对页已同时支持两种 URL 形态（pairing_page.dart 提示文案两种都写了）。

---

## 7. 三诉求 × 资产矩阵（gap 总表）

| 能力项 | 服务端 | 移动端 | 缺口归属 |
|---|---|---|---|
| Tailscale 直连 + token 鉴权 | ✅ | 🟡 配置/配对/重连骨架在，明文策略矛盾待收尾 | 移动端收尾 |
| registry 路由鉴权（pods/work/tech-lead） | 🔴 dispatch 先于 auth | — | **gateway P0** |
| work.overview 五桶 / presence / timeline | ✅ | 🔴 零消费 + Goal Tab 契约错位 | 移动端重写数据层 |
| goal 跑动实时事件（goal_node/phase_transition） | ✅ 广播进 WS | 🔴 扁平帧被丢弃、效果表 none | 移动端加扁平帧分支 |
| pod.event / pod.updated | ✅ | 🟡 词汇表已同步（parity 钉死），效果 none | 移动端接效果 |
| 创建讨论型 Goal | ✅（source 枚举缺 mobile） | 🔴 零 | 移动端新页面 + 小服务端扩枚举 |
| Tech Lead 讨论读/发 | ✅ GET/POST tech-lead | 🔴 零（渲染管线可复用） | 移动端发送分流 |
| Tech Lead 流式 | ✅ 常规 SSE/WS 按 sessionID | 🟡 chat 管线现成 | 移动端按 sessionID 复用 |
| 终态讨论回落 transcript | ✅ | 🔴 零 | 移动端 |
| Lead 新话题聊天 | ✅ | 🟡 底座在（createSession/enriched/messages） | 移动端入口组织 |
| 交给 Lead（handoff） | ✅ | 🔴 零 | 移动端 |
| 「需要你」应答（plan 批准/方向裁定/问答） | ✅ 全齐 | 🔴 无 UI 出口 | 移动端（建议列入 v2） |
| 离线推送（FCM） | 🔴 无 sender | 🔴 占位符 | 双端，可选 |
| mafw:// 深链 | ✅ 配对码生成 | 🔴 无 intent-filter | 移动端小改 |
| WS 鉴权走 header（规避 serve 风险） | ✅ 三通道已支持 | 🟡 现用 query token | 移动端小改 |

---

## 8. 冲突点清单（按严重度）

1. 🔴 **P0 安全**：registry dispatch 先于 auth（§2.1）——任何远端暴露前必修；
2. 🔴 **serve 路径 apiToken 整体绕过**（§6.2）——选 B 路径时的边界认知，可配 identity header/ACL 缓解；
3. 🔴 **离线推送断链**（§3）：服务端无 FCM sender + 移动端占位符——「跑动通知」当前不可能，只有前台 WS；
4. 🟠 **移动端 Goal 数据面整体失真**（§5.2-①）：`GET /api/goals` 是降级列表形状，与移动端期望完全错位——需按 Pod v3 语义（goalId/revision/stage/verdict/bucket）重写；
5. 🟠 **明文策略矛盾**（§5.3-1）：全禁 cleartext vs 缺省 http://127.0.0.1:3000 + mDNS http URL——需统一裁决（推荐：域级放行 ts.net + 100.x 段，缺省改 https 或空）；
6. 🟠 **消息路由纪律**（§4.3）：讨论 tab 发送必须分流到 `tech-lead/messages`，直接 promptAsync 会丢 agent 绑定 + ContextManifest——移动端发送层需要视图感知的分叉（照抄桌面 use-send-message.ts:407-416 模式）；
7. 🟡 `source` 枚举缺 `mobile`；`isManager` 只认 legacy 'manager'；`GET tech-lead` 终态 409/空态两分支；`/api/chat/enriched` 不带 sessionID 落第一个项目；扁平帧事件分支；深链 intent-filter；SmartReconnect 持久化 bug；每事件全量重拉（G9）。

---

## 9. 建议路线（分阶段）

> 原则：每阶段独立可用；安全洞最先；移动端数据层按 Pod v3 语义重写而不是修补旧 Goal Tab。

- **Phase 0（gateway，先行）**：修 dispatch/auth 顺序（P0）；`GOAL_SOURCES` 扩 `mobile`；（可选）serve 场景的 identity header 校验模式。
- **Phase 1（连接收尾）**：Tailscale 直连走通（token + network security config 域级放行）；`mafw://` intent-filter；缺省 baseUrl 裁决；WS 鉴权迁 header（为 serve 并存做准备）；SmartReconnect 修复接线。
- **Phase 2（看 goal 跑动）**：work.overview 五桶首页 + presence 徽标；Goal 详情 = pod.result + revisions + timeline；扁平帧事件分支 + `pod.*` 效果接线（局部刷新，不做全量重拉）。
- **Phase 3（创建讨论 + Tech Lead 讨论）**：Goal composer（createGoal → 返回 sessionID）；讨论页 = `GET tech-lead` 历史 + sessionID 订阅 WS 流式 + 发送分流 `tech-lead/messages`；终态回落 transcript。
- **Phase 4（自由讨论 + 交接）**：Lead 新话题入口（显式 directory 建会话）；「交给 Lead」handoff（sourceRef 自拼）。
- **Phase 5（可选）**：「需要你」应答面（plan 批准/方向裁定/问答）；离线推送（服务端 FCM sender + 真实 Firebase 项目）或明确接受前台-only。

---

## 10. 待用户决策

1. **连接路线**：v1 只做直连 tailnet（A），还是直连 + serve（B）双支持？（推荐 A 先行，B 视需求）
2. **离线推送**：v1 是否需要息屏通知？若需要，Phase 5 的 FCM 双端工作量要提前排；若不需要，「打开 App 才看到」是明确边界。
3. **鉴权洞修复**：是否同意作为独立第一批（与本移动端项目解耦、先行合入）？
4. **移动端信息架构**：「讨论」以 Goal 为中心（从 Goal 进讨论）还是独立 tab？桌面范式是 Goal 绑定（Tech Lead 页按 Goal 组织），建议移动端沿用。
5. **v1 是否包含「需要你」应答**（plan 批准/方向裁定/问答）——技术上服务端全齐，纯移动端 UI 工作量。

---

## 附：外部来源

- Tailscale Serve 文档/CLI reference（2026-01 validated）：https://tailscale.com/docs/features/tailscale-serve 、https://tailscale.com/docs/reference/tailscale-cli/serve
- Tailscale HTTPS 证书（LE + ts.net）：https://tailscale.com/docs/how-to/set-up-https-certificates
- Tailscale 官方 Home Assistant 远程访问指南（2026-07 更新）：https://tailscale.com/blog/remotely-access-home-assistant
- WS query 剥离 issue（Open/无法复现）：tailscale/tailscale#18651；WS 掉线报告：#18827；Android 15 always-on 掉线：#15736
- Android 网络安全配置：https://developer.android.com/privacy-and-security/security-config
