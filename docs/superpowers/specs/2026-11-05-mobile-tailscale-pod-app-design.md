# Mobile App v1 设计：Orcalore · Tailscale 直连 + Pod 协作

日期：2026-11-05（2026-11-06 品牌修订：MAFW → **Orcalore**）｜ 前置调研：`docs/research/2026-11-05-mobile-tailscale-pod-research.md`（下称「调研报告」，所有行号证据在彼处）
状态：**已批准**（D1-D6 + 2026-11-06 品牌三项裁决）｜ 实现基线：mobile/（Flutter）+ gateway（HEAD `d0752664`）

---

## 1. 意图与为什么

用户在手机上**打开 App 就能**：

1. 看到 Pod 里 goal 的跑动（阶段、进行中、结果、需要我的地方）；
2. 点一下就发起一个讨论型 Goal，跟 Tech Lead 自由讨论；
3. 跟 Lead 自由聊天（新话题、交代事情、必要时交给 Lead 变成 Goal）。

连接方式为 **Tailscale 直连**（手机装 Tailscale App，gateway 零公网暴露）。明确接受「打开 App 才看到」——**v1 不做息屏离线推送**，因此也不要求常开 VPN。

为什么是 Tailscale：私网直达、无端口转发、无公网面；gateway 已绑全网卡 + apiToken 三通道鉴权 + 配对深链（Tailscale IP 优先探测）——连接层基建现成（调研报告 §2/§3/§6）。

## 2. 已确定的决策（用户 2026-11-05 拍板）

| # | 决策 | 含义 |
|---|---|---|
| D1 | **打开 App 才看到** | 无 FCM/离线通知；实时性=前台 WS；不要求 always-on VPN |
| D2 | **直连 tailnet** | `http://machine.<tailnet>.ts.net:3000`（MagicDNS）为主；不做 tailscale serve/Funnel |
| D3 | **鉴权洞独立先行修复** | registry dispatch 先于 authorizeRequest 的顺序回归，作为独立第一批交付（Phase 0），与移动端项目解耦 |
| D4 | **沿用桌面范式** | 讨论以 Goal 为中心：从 Goal 进 Tech Lead 讨论页；不做独立「讨论」tab 顶层入口 |
| D5 | **v1 要有「需要你」应答面** | plan 批准 / 方向裁定 / 问答的移动端 UI（服务端 API 全齐） |
| D6 | **UI 参考 Dots / Grok / Muse** | 设计语言见 §3 |

## 3. 设计语言（Dots / Grok / Muse → 本 App）

三个参照的共性正是本 App 的范式——**agent 人格化消息 + 后台目标活动可见 + 需要你时才打扰**：

| 参照 | 借鉴什么 | 落到本 App |
|---|---|---|
| **Dots**（OpenAI，常驻 agent） | Activity View：后台任务与状态常驻可见，随时介入/重定向 | 「工作」tab = work.overview 五桶活动流（Dots 的 Activity View 同构）；goal 卡片常驻显示阶段 |
| **Muse**（Meta，消息式 agent） | 像给人发消息一样与 agent 交流；非回合制（agent 干活时也能插话）；审批时刻（approval moment）才来找你；完整审计轨迹 | 与 Lead/Tech Lead 的交流全部是**消息流**（复用现有 chat 管线）；「需要你」= approval moment 置顶；Goal 详情 = revisions/timeline/证据的审计轨迹 |
| **Grok**（xAI） | 深色极简、对话优先、质感流畅、最小 chrome | 配色裁定 **B「Grok 单色极简」**（2026-11-05 用户选）+ **Orcalore 品牌修订**（2026-11-06）：中性 ink/cream 主导，**mint #4FD388（桌面同款 accent）**只做 accent——见下方 token 表与 §3.1 |

### 配色 token（裁定 B + Orcalore 品牌）

```
背景/表面：bg #000 · surface #1D1F25（ink，替代 #0D0D0F）· border #2A2D36
文本：    text #FCF8F1（cream）· dim #9CA3AF · faint #6B6B72
accent mint #4FD388（唯一彩色，与桌面 accent 同源）只用于四处：
  ① 需要你卡片（边框 + ◆ 标记 + 提示文字）② 激活态（导航点/焦点/选中）③ CTA 主按钮 ④ 进行中的时间线节点/进度焦点
FAB：    纯白 #FCF8F1 圆形 + 黑色＋号
阶段徽标：全部中性化——#24272F 底 + #C9C9D4 字（不再彩虹徽标；阶段差异靠文字）
verdict： 白 ✓ / 灰 ✕（PASS/FAIL 不引入绿红；mint 是 accent 不是 success 专用色）
语义：    「需要你」是唯一允许抢眼的元素；「在跑」用灰边白点或 mint 点（激活态语义）
```

theme.dart 的 accent 语义从「全局主色」收敛为「B accent」（Material 3 `ColorScheme.primary` 指向 mint，组件用法按上表收敛）。粉 #EC4899 / 青 #22D3EE / 琥珀 #F59E0B 从 UI 语义色退役（保留给 markdown 内容渲染等非 chrome 场景可再议，默认不进 chrome）。

### 3.1 品牌修订（Orcalore，用户 2026-11-06 拍板）

前置：`docs/superpowers/specs/2026-11-05-orcalore-lore-character-design.md`（产品名 Orcalore；Lore = 记忆珍珠/品牌形象；Pod 角色不改名；ink/cream/white + mint accent）。

**用户三项裁决**：① 品牌一致（accent 用 mint #4FD388，弃 AI 紫）；② 技术标识现在就改；③ 品牌位放**工作 tab 顶部一行**。

| 层 | 决定 |
|---|---|
| 品牌位 | 工作 tab 顶部一行：**Lore 20px 圆形图标 + Orcalore 字标**，项目切换器在右侧（同一行）；「我的」关于页同款 lockup |
| 应用图标 | `assets/brand/lore/platform/` 的 Android 包（5 密度 + adaptive/monochrome，ink `#1D1F25` 底）；随 v1 首发（spec 的「等改名一起上」即本批） |
| MaterialApp title / Launcher label | `Orcalore` |
| applicationId / namespace | `ai.mafw.mafw_mobile` → **`ai.orcalore.mobile`**（换 appId = 全新应用，pre-release 无迁移） |
| pubspec name | `mafw_mobile` → **`orcalore_mobile`** |
| 配对深链 | `mafw://pair` → **`orcalore://pair`**，三处**锁步**：gateway `mobile/pairing.ts`、mobile `pairing_page.dart` 解析、Manifest intent-filter |
| FCM 通知通道 | `mafw_messages`/`mafw_goals` → **`orcalore_messages`/`orcalore_goals`**（Android 通知设置用户可见） |
| env 变量 | `MAFW_SERVER_API_TOKEN`/`MAFW_MOBILE_TAILSCALE_URL` **暂留原名**（归后续改名专项文档；mobile 文档同步说法） |

**不改名（避免契约破坏/无谓 churn）**：HTTP 路径 `/api/*`；事件信封 `mafw_event` + canonical 词汇（若改名专项动，移动端 `isCanonical` 一行 + vocabulary parity 测试锁步）；`@mafw/sdk`（mobile 未依赖）；Dart 内部类名 `MafwSession`/`MafwMessage`/`MafwEvent`/`kMafw*`（纯代码不用户可见）。



1. **消息优先**：所有 agent 交互都是聊天流，不是表单/工单；composer 永远在场；
2. **活动常驻**：工作 tab 是活动流（五桶），不是空白列表页；goal 卡片自带阶段徽标与「需要你」状态点；
3. **approval moment 置顶**：需要人类的阻塞点（plan 批准/方向裁定/问答）永远在视觉最上层，其余一切可等；
4. **非回合制**：Tech Lead 工作中用户仍可发消息（异步 promptAsync 天然支持）；回合进行态用现有 Perplexity 式阶段指示（searching→writing→done）；
5. **审计可见**：Goal 详情能下钻到 revision 历史 + 节点时间线 + 结果证据（Muse 的 audit trail）。

## 4. 架构总览

```
手机                                     家里 PC（tailnet 节点）
┌──────────────────────────┐            ┌─────────────────────────────┐
│ Orcalore Mobile (Flutter) │            │ gateway :3000               │
│  ├ GatewayClient (HTTP+token) ────────▶│  /api/projects/:id/work     │
│  ├ WsClient v2 (header auth) ─────────▶│  /api/pods/* · tech-lead/*  │
│  ├ Hive 缓存               │  WireGuard │  /api/chat/enriched         │
│  └ Tailscale App (VPN)     │◀═════════▶│  /api/ws (canonical+flat 帧)│
└──────────────────────────┘  ts.net 私网 │  /api/presence · /api/mobile/*│
                                         └─────────────────────────────┘
```

复用面（不重造）：配对深链与 `detectReachableHost()`（Tailscale 优先）、`/api/ws` 事件管道（canonical + flat 帧同流）、chat 渲染管线（flat DTO + 事件驱动）、词汇 parity 测试（37 词与 SDK 钉死）、Hive 离线兜底、Orcalore B-mint 主题。

## 5. Phase 0：gateway 先行修复（独立交付，D3）

**P0-1 鉴权顺序**：`index.ts:5266-5272` 的 registry dispatch 移到 `authorizeRequest`（5291）之后，保留「goals.sessions 先于 dashboard 兜底」等既有顺序教训；同步修正 5262 失真注释。
- 验收（TDD）：新增测试——非 loopback + 无 token 调 `/api/pods/:id/goals` → 401；带 token → 200；loopback 仍豁免；
- 风险检查：现有 gateway 套件全量保持绿（desktop/TUI 均 loopback 不受影响）。

**P0-2 source 枚举**：`GOAL_SOURCES`（pods.ts:605-617）扩 `mobile`。

**P0-4 Tech Lead 模型可配置（用户 2026-11-05 裁决 B）**：Tech Lead 讨论回合模型硬编码 `gateway/volcengine/deepseek-v4.1-flash`（identity-registry.ts:180，`config.goal.nodeModel` 不覆盖）；仿 nodeModel 先例新增 config 键（如 `goal.techLeadModel`，空对回落身份内置），驱动 `PodTechLeadRuntime` bindModel（fail-open），保证 P3 冒烟不被单 provider 403 卡死。

**P0-3（配对 URL 主机名化，极小改动）**：`MAFW_MOBILE_TAILSCALE_URL` 是 env-only（index.ts:4724-4725），desktop bundle 场景设 Windows 环境变量笨拙——新增 config.yaml 键 `mobile.tailscaleUrl`（`PairingService.updateConfig` 已支持热更，接线 ~10 行），env 仍作覆盖；setup 文档同步。

## 6. 连接层（Phase 1）

- **URL 形态**：主 `http://machine.<tailnet>.ts.net:3000`（MagicDNS 主机名；Tailscale App 默认接受 tailnet DNS，手机可解析）；配对码默认给的是 100.x IP（`detectReachableHost()`），App 侧允许两种，**主机名优先**（原因见 cleartext 条）。
- **Android cleartext**：`network_security_config.xml` 增加 `<domain-config cleartextTrafficPermitted="true"><domain>ts.net</domain></domain-config>`（域后缀匹配 ts.net 全部子域）；**不**全局放开。裸 100.x IP 的放行行为是验证点 V1（域条目按 Android 文档只匹配主机名）——若 IP 不被覆盖：App 内把 IP 形态映射为主机名输入提示，或接受仅主机名路径。
- **apiToken**：`MAFW_SERVER_API_TOKEN` 必须设置（空 token = 远端全拒，auth.ts:43）。setup 文档写明。
- **WS 鉴权迁移 header**：`IOWebSocketChannel.connect(url, headers: {Authorization: Bearer})`（dart:io 支持；现有「不支持 header」注释是误判）——为将来 serve 并存留余地；`deviceId` 仍走 query（PushGateway 在线追踪）。
- **配对**：Manifest 增加 `orcalore://` intent-filter（现有配对页/QR/nonce verify 全复用）；**深链 scheme 改名锁步三处**（gateway `mobile/pairing.ts` 生成、mobile `pairing_page.dart` 解析、Manifest intent-filter）；配对 URL 主机名经 P0-3 的 `mobile.tailscaleUrl` 配置（config.yaml 或 env），配对码即给 MagicDNS 主机名。
- **重连**：接线 WsClientV2 + 修复 SmartReconnect 持久化 bug（`toString()`→`jsonEncode`，smart_reconnect.dart:182-183）；移除 v1 无上限重连路径。
- **缺省清理**：SecureConfigStore 缺省 `http://127.0.0.1:3000` 改为空（未配置态）；mDNS 发现结果标注「局域网明文」警告（现状已有）但不再与禁明文策略自相矛盾（127.0.0.1 本机路径是 adb reverse 开发场景，文档化）。
- **mDNS 与 Tailscale 并存**：配对页发现列表保持现状（mDNS=LAN），Tailscale 场景走扫码/手输；不做 Tailscale 网络自动发现（BRAINSTORMING 旧提议，留待后续）。

## 7. 信息架构与页面（Phase 2-4）

### 7.1 多项目语义（裁定：active 项目模型，沿用桌面范式）

- App 维护**单一「当前项目」**：工作 tab 头部项目切换器（`GET /api/projects` 列表选择，持久记住）；工作 tab（work.overview）与聊天 tab（`listSessions({projectID})`——API 已支持，main.dart 现状未传）**都按当前项目过滤**；
- **「需要你」是跨项目的**（presence 天然跨项目）：attention 列表全量显示，条目自带 projectId/podId；点击其它项目的条目 = 先切换当前项目再进 Goal 详情；
- 「新话题」的 `POST /api/session {directory}` 取当前项目目录；「交给 Lead」从会话的 `MafwSession.directory/projectID` 解析所属 Pod（与桌面 worktree→父项目折叠同规则，验证点 V4）。

### 7.2 Tab 结构：4 tab → 3 tab

```
底部导航：  Ⓢ 工作   Ⓦ 聊天   ⚙ 我的
```

- **工作**（新，首页）：Dots Activity View 范式——顶部「需要你」置顶区（presence attention + unreadResults）→ Lead 消息入口条（「跟 Lead 说件事」）→ 五桶 goal 活动流（needs_you/queued/in_progress/result_ready/ended，含计数徽标）→ FAB「+ 新建讨论」；
- **聊天**：现有普通会话列表（自由讨论/新话题——复用 sessions_page 主体；隐藏的 Lead/Tech Lead 会话**不在此列**，这是特性：讨论入口在工作 tab 的 Goal 里）；保留 Manager/子代理胶囊（`isManager` 判定补 `lead` 角色）；
- **我的**：连接设置（现有）+ 扫码配对（现有）+ 记忆检索（从现 4-tab 迁入，Grok 式搜索入口）。

Tab 命名与图标细节留给 builder；3-tab 结构是设计决定（工作/聊天分离对应 activity-first + message-first 双主页）。

### 7.3 工作 tab（Phase 2）

- 数据：`GET /api/projects/:projectId/work`（五桶+counts，15s 轮询 + 事件触发刷新）+ `GET /api/presence`（跨项目徽标）；`projectId` = URL-encode 项目绝对路径（App 首次从 `GET /api/projects` 选择/记住）；
- goal 卡片（Muse 审计轨迹入口）：`title`、`stage` 徽标（discussing/planning/implementing/reviewing/…）、`revision r<n>`、`verdict`（PASS/FAIL/…）、`bucket` 归属、`strategy`（quick/collaborative）；点击 → Goal 详情；
- **Goal 详情页**（重写现有失效页）：头部（title/stage/verdict/revision）+ 「需要你」操作区（见 7.3）+ 当前阶段上下文 + **节点时间线**（`GET /api/goals/:id/timeline`，节点格子+verdict+attempt，Dots 式可展开）+ revision 历史（`GET .../revisions`）+ 结果区（`GET .../result`：验收/证据/产物/feedback + 打回入口 `POST .../reject`）；
- 实时：flat 帧 `goal_node`/`phase_transition`/`state_change` + canonical `pod.updated`/`pod.event` 驱动**局部刷新**（按 goalId diff 更新对应卡片/详情，不做全量重拉——顺带修 G9 在 Pod 面的表现）；`pod.event` 无 projectId，按当前选中项目过滤前先经 work 数据反查归属；
- 事件接线：`event_effects` 表为 `pod.*`/`run.*`/`goal_node`/`phase_transition` 补效果（钉死测试同步更新——词汇 parity 守卫会强制表态）。

### 7.4 「需要你」应答面（Phase 2-4 内嵌，D5）

approval moment 的三个形态，全部服务端就绪：

| 形态 | 触发呈现 | 应答动作 |
|---|---|---|
| **Plan 批准** | goal 卡片/详情置顶「计划待批准」 | 详情内嵌 plan 审阅（`GET /api/goals/:id/plan` → waves+goalEval+hashes 渲染）→ 批准 `POST /api/goals/:id/plan-approval {approve, approvalId, planHash, evalHash}`（不匹配 409 stale_plan → 提示重拉）；驳回同端点 `reject + planFeedback` |
| **方向裁定** | 「方向待裁定」attention | 详情内嵌方向面板（选项+原话）→ `POST .../direction-decision {mode: decided, optionId?, userWords}`；也可自然语言输入（mode:'decided' + userWords） |
| **问答** | `user_question` 事件 + attention `question` | 详情内嵌问答卡 → `POST /api/goals/:id/questions/:qid/respond {answer}` 或 `{cancel}` |

「需要你」聚合源：`/api/presence` attention + `GET /api/pods/:id/events?state=unread`（含 seen 回写）。

### 7.5 创建讨论（Phase 3）

- 工作 tab FAB「+ 新建讨论」→ Goal composer（title + objective + 可选 acceptance/boundaries，Muse 式自然语言优先、字段最少）→ `POST /api/pods/:podId/goals`（`source:'mobile'`，P0-2 后生效）→ 响应给 `{goalId, revision, sessionID}` → **直接跳进讨论页**；
- Pod 不存在时：先 `GET /api/projects/:id/pod/lookup` → 404 则引导（`POST /api/projects/:id/pod` ensure 或提示去桌面建——builder 决定，倾向 App 内 ensure）。

### 7.6 讨论页（Phase 3，Tech Lead）

- 进入：Goal 详情「与 Tech Lead 讨论」→ `GET /api/pods/:podId/goals/:goalId/tech-lead?limit=50` → `{sessionID, messages[]}`（flat DTO，与 chat 同构）；
- 渲染：**完全复用现有 chat 渲染管线**（messages 历史 + 该 sessionID 的 WS canonical 事件流 + 阶段指示）；
- **发送路由纪律（硬约束）**：讨论页发送**只走** `POST .../tech-lead/messages {text}`——直接 promptAsync/enriched 会丢 Tech Lead agent 绑定 + ContextManifest（pod-store.ts:58-62）；实现形态照抄桌面 use-send-message.ts:407-416 的「按视图绑定 Goal 分流」；
- **composer 能力边界（裁定：text-only）**：Tech Lead 身份 allowlist 无 `mafw_media_*` 工具（identity-registry.ts:182-190），讨论页发图=指针无人能解——v1 讨论页 composer 仅文本；Lead 聊天保留媒体/TTS（`mafw_*` 全放行）；Tech Lead 媒体能力（扩 allowlist）记为后续；
- 终态：GET 409 / `{sessionID:null}` → 落款「讨论已归档」+ 转已归档 transcript（`GET /api/pods/:podId/sessions/:sessionId/transcript`，只读）；
- 打回流：结果区「打回」→ `POST .../reject {feedback}` → revision N+1 自动回 discussing → 讨论页复活。

### 7.7 自由讨论（Phase 4）

- **跟 Lead 聊**：工作 tab 的 Lead 入口条 → `POST /api/pods/:podId/lead/ensure` → `{sessionId}` → 复用 chat 页（发送走普通 `/api/chat/enriched {sessionID}`——身份绑定由 runtime 层 `withIdentityPrompt` 保证，index.ts:2187/7529，**已核实**；不走专用通道）；
- **新话题（普通会话）**：聊天 tab 现有「新建会话」（`POST /api/session {directory}`——显式传目录，enriched 不带 sessionID 会落第一个注册项目）；
- **交给 Lead**：任意普通会话长按/菜单「交给 Lead」→ 照抄 lead-handoff.ts:46-70 拼 `{title, objective, sourceRef:{sessionID, snapshot(4000字), capturedAt}}` → `POST /api/pods/:podId/goals/handoff` → 跳 Goal 详情。

## 8. 数据层（GatewayClient 扩展）

新增方法（全部对齐既有 client 风格 + flat DTO 契约检测）：

```
projects() / workOverview(projectDir) / presence()
podLookup(projectDir) / podEnsure(projectDir) / ensureLead(podId)
listPodGoals(podId) / createGoal(podId, body) / handoffGoal(podId, body)
goalResult(podId, goalId) / goalRevisions(podId, goalId)
openTechLead(podId, goalId, {limit}) / sendTechLeadMessage(podId, goalId, text)
directionDecision(podId, goalId, body) / rejectGoal(podId, goalId, feedback)
goalTimeline(goalId) / goalPlan(goalId) / planApproval(goalId, body)
answerQuestion(goalId, questionId, body) / podEvents(podId, {state}) / markEventSeen(...)
transcript(podId, sessionId)
```

模型层新增：`PodGoalView`、`WorkOverview`（五桶）、`Presence`、`GoalTimeline`、`PlanPackage`、`PodEvent`、`DirectionDecision`——按 SDK types 对应 DTO 手写 Dart 镜像（沿用现有 parity 测试模式，可选加 shape 钉死）。

**移除/废弃**：`listGoals()`（`/api/goals` 降级形状）与 `getGoal()` 删除，改 work.overview + pod 面组合。

## 9. 非目标（v1 边界）

- ❌ 离线推送（FCM 服务端发送、真实 Firebase 项目、常开 VPN）——D1；
- ❌ tailscale serve / Funnel 路径（连接层不留 https 分支，但 WS header 鉴权已为其留余地）；
- ❌ 桌面工作台面（编辑器/文件树/终端/diff 审阅）；
- ❌ 记忆 triage 应答、自动化规则管理、usage/quota 面（保持现状入口或后续）；
- ❌ 语音输入/TTS 交互增强（现有 TTS 长按朗读保留，语音输入占位不动）；
- ❌ 多 Goal 并行管理的高级操作（重排/跨 wave 编辑等——桌面才有）；
- ❌ iOS（现有工程 Android-only）。

## 10. 测试策略（TDD 先行）

- **Phase 0（gateway）**：鉴权顺序 RED→GREEN 用例（远端无 token 401 / 带 token 200 / loopback 豁免）+ 全量回归；`GOAL_SOURCES` 扩枚举用例；
- **连接层**：pairing URL 主机名/IP 双形态解析、WS header 鉴权、SmartReconnect 持久化往返（修 bug 的 RED 用例先写）；
- **数据层**：每个新 client 方法的请求/响应解析测试（沿用 view_dto_test.dart 的「全页解析失败→可操作错误」模式）；**flat 帧解析测试**（goal_node/phase_transition 载荷）；event_effects 表扩展的钉死测试（37→N 词全部显式表态，vocabulary parity 自动守卫）；
- **页面**：工作 tab 五桶渲染、Goal 详情时间线、讨论页发送分流（**必须有**「讨论视图绝不调 sendEnriched」的契约测试）、「需要你」三形态应答、终态回落 transcript；
- **调试面（dev-only）**：`DiagnosticsSink` 环形缓冲截断断言 + DebugPage fixture 渲染（帧原文/判定/效果、HTTP 行、诊断包导出）；调试策略全文见 `docs/architecture/mobile.md` §7（分层调试、真机日志三条路、故障速查表）；
- **交付纪律**（用户既定偏好）：每阶段汇报新增测试数与全量通过数；发布记录版本号 + commit 哈希；
- **真机冒烟**（每阶段末）：真 Tailscale 连接（手机 + PC 同 tailnet）走通当阶段主链路；Phase 1 验证点 V1（裸 IP cleartext 行为）+ 调试面板可用性。

## 11. 阶段划分与验收摘要

| 阶段 | 内容 | 可验收标志 |
|---|---|---|
| P0 | gateway 鉴权洞 + source 枚举 + Tech Lead 模型可配置（独立交付） | 远端无 token 全拒；全量测试绿 |
| P1 | 连接层收尾 | 真机 Tailscale 配对→聊天→WS 事件通；明文策略无自相矛盾 |
| P2 | 工作 tab + Goal 详情 + 实时 | 手机上能看到 goal 跑动（五桶/时间线/事件驱动刷新） |
| P3 | 创建讨论 + Tech Lead 讨论页 | 手机上建 Goal→与 Tech Lead 流式讨论→打回→revision 2 |
| P4 | 自由讨论 + Lead 入口 + handoff | 手机上跟 Lead 聊、新话题、交给 Lead |

**交付形态（裁定）**：release APK（现有 build.gradle.kts 的 release 配置 = minify + debug keystore 签名，`build-apk.bat` 已有）侧载安装；v1 更新方式 = 重装 APK，不做应用内更新。真机冒烟在用户日常用机上以该形态验证。

**已裁决（2026-11-05 用户选 B）**：Tech Lead 模型可配置 → P0-4。

## 12. 留给 builder 的决定（不改变所建之物）

1. 3-tab 的图标/文案（工作/聊天/我的）与记忆检索的归宿（「我的」内二级页 vs 搜索入口）；
2. flat 帧的实现形态：扩展 `MafwEvent`（加 flat 分支字段）vs 独立 `FlatEvent` 类型——建议前者（词汇 parity 测试已按字符串表驱动）；
3. Hive 缓存是否扩展到 work.overview/goal 详情（建议：goal 详情缓存 TTL 5min，工作 tab 不缓存）；
4. Pod 不存在时的 ensure 策略（App 内 ensure vs 引导桌面）；
5. 五桶的分组/折叠形态（Dots 式时间线流 vs 分组列表）；
6. 100.x 裸 IP cleartext 验证失败时的降级具体形态（提示改主机名 vs 配对码带主机名）。

## 13. 验证点（builder 需实测确认的假设）

- **V1**：Android network security config 的 `ts.net` 域条目是否覆盖裸 100.x IP（预期不覆盖——文档说 domain 是主机名）；
- **V2**：Tailscale App 关闭「Use Tailscale DNS」时 MagicDNS 主机名不可解析——setup 文档要求保持默认开启；
- **V3**：`GET tech-lead` 在 App 后台较久后回来时 lease 过期的重建延迟（supervisor ensure 路径）实测体感；
- **V4**：`POST /api/session {directory}` 对 worktree 项目目录（`-wt-` 后缀）的行为与主目录 Pod 的映射（worktree 折叠到父项目）。
