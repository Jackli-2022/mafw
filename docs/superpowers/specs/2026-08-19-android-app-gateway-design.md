# Android 全功能移动端 MAFW + Gateway 连接 — 设计文档

> 日期: 2026-08-19 | 状态: 拟定（已过 brainstorming + 子代理并行审查）| 方案: 1 Flutter 延续 + 原生补齐
> 关联: `mobile/lib/main.dart:13`, `mobile/lib/src/network/gateway_client.dart:11`, `mobile/lib/src/network/ws_client.dart:16`, `mobile/lib/src/config/connection_config.dart:6`, `gateway/src/config.ts:17`, `gateway/src/index.ts:224`

---

## 1. 目标与范围

### 1.1 目标
- 在现有 Flutter 壳上交付 **全功能移动端 MAFW**（A-E 全量）+ **Tailscale 优先连接 (B)** + **FCM 离线兜底**，达成 **A 启动/体积、B 后台可达、D 语音多模态、E 电量流量** 优化。
- 复用现有链路：HTTP `3000` + WS `/api/ws` 同 SSE 事件帧 (`gateway/src/index.ts:960`) + `MAFW_SERVER_API_TOKEN` 鉴权 (`gateway/src/config.ts:17`) + App `Authorization: Bearer` / `?token=` 双通道 (`mobile/lib/src/config/connection_config.dart:20`, `mobile/lib/src/network/ws_client.dart:39`)。

### 1.2 范围
- **v1 必做**: 扫码配对、Tailscale 直连 + WS 加固、FCM 推送网关（在线直推/离线转推）、会话/消息/记忆/TTS/媒体上传、基础 Goal/Triage/Automation 列表与操作、启动/体积/电量首轮优化。
- **v2**: 离线消息队列与分页缓存（Drift）、后台连续听写、移动端自动化编排、端到端加密配对轮换。
- **非目标**: 桌面端平替的全部管理能力（复杂编排放 v2）、公网 relay（仅 Tailscale）。

### 1.3 成功标准
- 扫码 10s 内完成配对；前台 WS <2s 重连（指数退避 1/2/5/10s + jitter，上限 30s）；杀后台后 FCM 5s 内到达；`aab` split-per-abi <35MB；中端机冷启动 <1.2s（Baseline Profile）；后台 8h 耗电 <2% 增量。

---

## 2. 现状与约束

- **App 壳**: `mobile/` Flutter 工程，`mobile/android/app/src/main/kotlin/ai/mafw/mafw_mobile/MainActivity.kt:1` 仅 `FlutterActivity`；Dart 侧 `GatewayClient:11` 覆盖 `/health`, `/api/sessions`, `/api/sessions/:id/messages`, `/api/session`, `/api/chat/enriched`, `/api/memory/*`, `/api/tts`，`WsClient:16` 以 `StreamController` 暴露 `events`/`connectionStatus`，指数退避 `mobile/lib/src/network/ws_client.dart:68`。
- **Gateway**: `gateway/src/index.ts:224` `wsClients: Set<WebSocket>`，`index.ts:3215` `WebSocketServer({noServer:true})` 在 `/api/ws` 广播与 SSE 同帧；`index.ts:1429` `/a2a` loopback-only 403；`index.ts:1431` `isLoopback` 判定；`config.ts:354` `server/paths` 视为 `restartRequired`。
- **App 配置**: `ConnectionConfig:6` `baseUrl/apiToken → normalizedBaseUrl/wsUrl/headers`，持久化 `shared_preferences` 明文（需整改）；`AndroidManifest.xml:10` `usesCleartextTraffic=true` 仅调试。
- **约束**: 已定 Tailscale 优先 (B)，FCM 兜底 (B)，全功能 A-E，优化 A/B/D/E；`Hive` 已 deprecated，需 `hive_ce`/`Drift`；国内 ROM 杀后台严格。

---

## 3. 方案对比与选型

| 方案 | 概述 | 优点 | 代价 | 结论 |
|------|------|------|------|------|
| **1 Flutter 延续 + 原生补齐（推荐）** | 复用 `mobile/` Dart UI/状态，原生 Channel 补 FCM/前台Service/录音/扫码/压缩；Gateway 新增轻量推送网关 | 复用 `gateway_client.dart:42`/`ws_client.dart:41`，最快达 A-E；热重载快；体积/启动可优化到位 | 跨 Dart↔Kotlin 生命周期需管好 | **采纳** |
| 2 纯原生 Kotlin 重写 | Compose+Room+WorkManager+ExoPlayer 重做 | 性能/电量最优 | 重写全部链路，工期 2-3×，失跨平台 | 否 |
| 3 瘦客户端 Gateway 驱动 | App WebView，能力走 Gateway 代理 | E 最快 | 离线/电量差，与 A/E 冲突 | 否 |

选型理由：已打通 HTTP/WS/Token 鉴权，补“配对二维码 + 推送网关 + 原生音视频”即达最大体验，满足 B+C+D 全量。

---

## 4. 总体架构

```
[Android App: Flutter UI] ——— Tailscale tailnet https://xxx.ts.net:3000 ——— [Gateway 3000]
  Dart: pages/* + GatewayClient/WsClient + SecureStorage + Cache (Hive_ce/Drift)
  Platform Channel (Kotlin): FCM, ForegroundService/WorkManager, 录音/播放, 相机/压缩, 扫码
         ↕                                                          ↕
       FCM HTTP v1 (serviceAccount)                           PushGateway + /api/mobile/*
         ↕
      [FCM] → [Android System] → App (killed 可达) → 点击 → WS 拉详情
```

- **单一真相源**: Gateway；App 薄缓存，推送仅含 id/摘要，详情回 Tailscale 拉取。
- **鉴权统一**: 全部复用 `apiToken`，不另起一套；`/api/mobile/*` 与现有 `/api/*` 同鉴权面。

---

## 5. 连接与扫码配对（Tailscale 优先）

### 5.1 二维码载体
- 新增 `GET /api/mobile/pairing-code`（需本机或已鉴权，返回 `mafw://pair?url=<tailnet>&token=<apiToken>&v=1&exp=300&nonce=…`，内存存储、单次兑现、TTL 300s、5/min/IP 限频、哈希存储）。
- 桌面端设置页与 `mafw mobile pairing-code` CLI 同源展示；App 新增 `lib/src/pages/pairing_page.dart` 用 `mobile_scanner` 解析。
- 落盘：`flutter_secure_storage`（Android EncryptedSharedPrefs）存 `apiToken`，`shared_preferences` 仅存 `baseUrl`；旧明文迁移后删除。

### 5.2 连接策略
- 启动 `ConnectionConfig.load()` 优先读 SecureStorage，缺失回退 `connection_settings_page.dart:62` 手动页。
- `ConnectivityWatcher` (`connectivity_plus`) 监听；Tailscale 断开时 WS 走 `ws_client.dart:63` 退避 + jitter（上限 30s），成功后 `GatewayClient.health()` 探活再重订阅。
- Gateway `config.reload()` 若 `server.apiToken` 变更，踢掉旧指纹的 WS 并对后续请求 401，App 弹“重新扫码”。

### 5.3 安全（审查 Must 已纳入）
- **空 token 开放** (`config.ts:171` + `index.ts:1441` 非回环直通) → 远程/Tailscale 监听时强制要求 `MAFW_SERVER_API_TOKEN`，未设拒绝非回环 401 并启动 warn。
- **token 进 URL/日志** (`ws_client.dart:39` `?token=`) → WS 优先 `Authorization: Bearer` 头，query 仅兼容；网关日志脱敏扩展到通用 `Bearer/token=`。
- **明文嗅探** (`AndroidManifest.xml:10`) → Tailscale 强制 `https/wss`，`http` 仅 allow `192.168/10.x` 且 UI 警示。
- **回环判定加固** → `index.ts:1433` 补 `127.0.0.0/8`、`::1` 变体，禁止 `X-Forwarded-For` 绕过。
- **设备表** → `~/.mafw/mobile-devices.json` 600 权限，存 `sha256(apiToken)` 指纹，不存明文。

---

## 6. 推送与后台（FCM 兜底）

### 6.1 Gateway 推送网关 `gateway/src/mobile/push-gateway.ts`
- **设备注册表** `~/.mafw/mobile-devices.json`：`POST /api/mobile/devices/register {fcmToken, deviceId, platform:"android"}` 需 `Authorization: Bearer`，`GET/DELETE /api/mobile/devices` 本机鉴权；二维码兑现与 FCM 注册分两步。
- **在线判定**: 基于 `wsClients` + 30s `ping` / 60s `prune` + `isAlive`，窗口 30s 防抖；在线直推 WS 帧 (`index.ts:960`)，离线转 FCM。
- **FCM 发送 — v2 / WS-only beta 豁免（见 §12）**: 本期为 WS-only beta，`MAFW_FCM_SERVICE_ACCOUNT_PATH` → OAuth2 → HTTP v1、`collapse_id`/`ttl 24h`/限流/退避均标为 **v2**。离线时静默丢弃推送（仅 WS 在线可达），FCM 服务账号路径与发送链路留待 v2 实现。
- **可靠（v1 已实现）**: 每设备 1 msg/s 令牌桶 + 全局限流（WS 扇出）；`config.reload()` token 失效清该指纹设备；路由 `^/api/mobile/...(?:\?|$)` 防 query 锚定失效；CORS 对 `/api/mobile` 收紧。

### 6.2 Android 侧
- **依赖**: `firebase_core` + `firebase_messaging` + `flutter_local_notifications` + `google-services.json`；厂商通道（小米/华为/OPPO）二期按需。
- **通道**: `mafw_messages` (high) 与 `mafw_goals` (default)；前台 `onMessage` 若正看该会话仅刷新 `WsClient.events`，否则本地通知。
- **点击链路**: `getInitialMessage/onMessageOpenedApp` → `data.sessionID` → `ChatPage` → `GatewayClient.messages:51` 拉详情，缺失落 `SessionsPage`。
- **Token 生命周期**: `onTokenRefresh` 立即覆盖注册；`deviceId=androidId` 覆盖旧记录。
- **后台策略（默认无常驻）**: 以 FCM 为主，不默认 `ForegroundService`；仅用户开启“后台保活”时起 `startForeground` + 30s 心跳，配合白名单引导；`WorkManager` 15min 周期 `health()+listSessions` 轻量拉取，仅 `lastFcmAt>24h` 加频，约束 `requiresBatteryNotLow+requiresNetworkConnected`。
- **权限**: `POST_NOTIFICATIONS` (13+ 运行时)、`RECEIVE_BOOT_COMPLETED` (重启重注册)、`FOREGROUND_SERVICE` 按需；忽略电池优化为可选引导，不强制。

---

## 7. 启动 / 体积 / 电量 / 流量优化（A+E）

### 7.1 启动与体积 (A)
- 产出 `aab` 为主，`apk` `split-per-abi` (`mobile/android/app/build.gradle.kts:1`)；`isMinifyEnabled/isShrinkResources + R8 fullMode + resConfigs("zh","en")`；`--obfuscate --split-debug-info`；重依赖 `deferred as` 懒加载（`mobile_scanner` 优先，FCM/record 次之）；`flutter build apk --analyze-size` 门禁 <35MB/abi。
- 去白屏：`flutter_native_splash` + `drawable*/launch_background.xml:1`；`lib/main.dart:35` `_init()` 并行 `ConnectionConfig.load() + Firebase.initializeApp()` 后 `hide`；`WsClient.connect()` 延首帧 200ms（与 `WidgetsBindingObserver` 协同，不丢首批事件）；Macrobenchmark Baseline Profile 录 `SessionsPage→ChatPage`，冷启 <1.2s。

### 7.2 电量与流量 (E) — 必须纳入的修正
- **WidgetsBindingObserver 前后台管理**: 前台 `ping 30s`，切后台立即 `sink.close()`，回前台重连；避免 `ws_client.dart:42` 常驻耗电。
- **流量**: `Accept-Encoding: gzip`；媒体本地压缩（图 1280px/JPEG80、音 AAC 32k，超 `MAX_*_BYTES` 预检）；会话/消息本地缓存 `hive_ce` (TTL 24h, `session:{id}:messages`)，在线以 `message.part.updated` 增量为准；`gateway_client.dart:51` `limit=50` 分页 + 滚动按需；`Hive` → `hive_ce`（或 Triage/Goal 需查询时 `Drift+sqlcipher`）。

---

## 8. 语音 / 多模态 / TTS / 记忆 / Goal（C+D+B+E）

### 8.1 语音输入
- `AndroidManifest.xml:6` `RECORD_AUDIO` 已声明；首版 `speech_to_text` (系统 `SpeechRecognizer`) 点按录音→实时转写→松手发送，失败回退键盘；`Permission.microphone` 运行时申请。

### 8.2 多模态
- 因 `/a2a` loopback-only (`gateway/src/index.ts:1429`)，新增 `POST /api/mobile/media/tasks` (multipart `file+question`) 与 `POST /api/mobile/media/tasks/:id/ask` 鉴权代理，直调 `mediaAgent.handleJsonRpc()`，复用 `MAX_*_BYTES` + 禁止外部 URL（SSRF 防护）；上限 20/50/25MB，超限 413。
- App: `image_picker` + `record` + 1280px 压缩，输入栏附件钮 → 预览 → 上传 → 指针 `[媒体附件 taskID:…]` 占位，WS `message.part.updated` 后渲染。

### 8.3 TTS
- 复用 `gateway_client.dart:117` `ttsVoices/ttsSpeak`；长按气泡“朗读” → `just_audio` 播放 `url=/a2a/artifacts/<id>` (带 token)，通知栏控制；`config.ts:289` 默认 `茉莉`。

### 8.4 记忆 / Goal / Automation / Triage
- 记忆：`gateway_client.dart:98` `memorySearch`，Chat 顶搜索框，指针卡片插入上下文。
- Goal/Automation/Triage：新增 `GatewayClient.listGoals/getGoal` 映射 `GET /api/goals` 等，`SessionsPage` 二级 Tab；Triage `GET /api/triage/items` + `proposeTriageDecision/runAutomation`；本地缓存 TTL 24h，WS 重连增量合并（`main.dart:87` 500ms 防抖）。

---

## 9. 数据与安全

- 存储：`flutter_secure_storage` (token) + `shared_preferences` (url) + `hive_ce`/`Drift` (缓存)；`~/.mafw/mobile-devices.json` 600，`~/.mafw/fcm.json` 600，env 覆盖路径支持。
- 鉴权：三通道统一校验 (`Bearer`/`x-api-token`/`?token=`)；二维码 `v/exp/nonce` 校验。
- 推送隐私：FCM 仅摘要，正文不进推送；日志脱敏通用 token。
- 权限最小化：`RECORD_AUDIO` 按需，`POST_NOTIFICATIONS` 按需，电池优化仅引导。

---

## 10. 接口清单（增量）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/mobile/pairing-code` | 本机/已鉴权 | 一次性 ma fw://pair，5min，单次兑现 |
| POST | `/api/mobile/devices/register` | Bearer | 注册 fcmToken/deviceId |
| GET | `/api/mobile/devices` | 本机/已鉴权 | 列表 |
| DELETE | `/api/mobile/devices/:id` | Bearer/本机 | 解绑 |
| POST | `/api/mobile/media/tasks` | Bearer | multipart 代理 /a2a 创建 |
| POST | `/api/mobile/media/tasks/:taskID/ask` | Bearer | 追问代理 |
| WS | `/api/ws` | Bearer/?token= (统一) | 存量，补 ping/prune/isAlive |

---

## 11. 测试与验收

- **联调**: `GatewayClient.health/listSessions/messages/sendEnriched` + `WsClient` 重连 + 401 重配对；媒体代理 20/50/25MB 边界；FCM data→点击→拉详情。
- **性能**: `analyze-size` <35MB/abi；`adb shell am start -W` 冷启；Battery Historian 8h；媒体流量对比。
- **兼容**: Tailscale 未安装/未登录、二维码过期、513/413、权限拒绝、国内 ROM 杀后台。

---

## 12. 风险与回退

- **FCM v2 豁免（WS-only beta）**: 本期 scope 为 WS-only beta，`MAFW_FCM_SERVICE_ACCOUNT_PATH`（默认 `~/.mafw/fcm.json` 600）及 FCM HTTP v1 发送链路（OAuth2、`collapse_id=sessionID`、`ttl 24h`、限流/退避）标记为 **v2**，暂不实现。离线推送静默丢弃，仅 WS 在线可达；FCM App 侧通道/点击链路已就绪，网关发送待 v2 补齐。
- FCM 未配置 → `fcm: disabled`，WS 前台可用；配额超限 → 折叠；Tailscale 不通 → 提示并重试 `health()`。
- 空 token 远程开放已通过 Must 1 阻断；媒体代理直调避免 loopback 绕过。
- `Hive` 弃用已迁 `hive_ce`；`config.reload()` 热更拆分避免重启。

---

## 13. 实施顺序（对接 writing-plans）

1. 安全与鉴权收口（SecureStorage、空 token 阻断、日志脱敏、回环加固）→ 2. Gateway 推送网关 + 设备表 + WS ping/prune → 3. 配对二维码 + App 扫码页 → 4. Android FCM 集成 + 通知通道 + 点击链路 → 5. 媒体代理 + TTS + 记忆/Goal → 6. 启动/体积/电量/流量优化 + Baseline Profile → 7. 联调与门禁。
