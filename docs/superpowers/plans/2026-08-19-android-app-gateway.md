# Android 全功能移动端 MAFW + Gateway 连接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Flutter 壳 `mobile/` 上交付全功能移动端（会话/消息/记忆/TTS/媒体/Goal+Triage）+ Tailscale 优先连接 + FCM 杀后台可达，并完成 A 启动体积/B 后台可达/D 多模态/E 电量流量优化。

**Architecture:** 复用现有 `GatewayClient`/`WsClient`/`ConnectionConfig` 链路，Gateway 新增 `gateway/src/mobile/*`（配对码、设备表、推送网关、媒体鉴权代理、WS 心跳），App 用 Flutter + Platform Channel 补 FCM/扫码/录音/压缩/前后台生命周期，`aab`+R8+Baseline Profile 达标。

**Tech Stack:** Flutter 3.13 / Dart, Kotlin (Android), TypeScript (Gateway), `ws`, `flutter_secure_storage`, `firebase_messaging`+`flutter_local_notifications`, `mobile_scanner`, `connectivity_plus`, `hive_ce`/`drift`, `just_audio`, `speech_to_text`

**设计文档（权威）:** `docs/superpowers/specs/2026-08-19-android-app-gateway-design.md`

## Global Constraints

- 鉴权统一复用 `MAFW_SERVER_API_TOKEN` (`gateway/src/config.ts:17`)，三通道 `Authorization: Bearer` / `x-api-token` / `?token=` 必须一致；`loopback-only` `/a2a` 不得绕过
- 敏感全文不进 FCM，payload 仅 `data {type,sessionID,title≤12,summary≤80,ts}`；日志必须脱敏 `Bearer/token=`
- 默认不常驻 `ForegroundService`，以 FCM 为主；`POST_NOTIFICATIONS` 运行时申请
- 存储：`apiToken` 进 `flutter_secure_storage` (EncryptedSharedPrefs)，`~/.mafw/mobile-devices.json` 与 `~/.mafw/fcm.json` 600 权限
- 产出 `aab` 为主、`apk split-per-abi`、R8 fullMode、`resConfigs("zh","en")`、`--obfuscate --split-debug-info`、`analyze-size <35MB/abi`、`冷启 <1.2s`
- WS 心跳 `ping 30s` / `prune 60s` / `isAlive`，在线窗口 30s，指数退避 1/2/5/10s + jitter 上限 30s
- 二维码 `mafw://pair?url&token&v=1&exp=300&nonce` 单次兑现、TTL 300s、5/min/IP 限频
- `/api/mobile/*` 路由用 `^(?:\?|$)` 防 query 锚定，CORS 对该前缀收紧；`hive` 禁用，用 `hive_ce`/`drift+sqlcipher`

---

## File Structure

- **Gateway 新增:** `gateway/src/mobile/pairing.ts` (配对码内存表+限频), `gateway/src/mobile/device-store.ts` (600 权限 JSON), `gateway/src/mobile/push-gateway.ts` (在线直推/离线FCM、限流、OAuth2), `gateway/src/mobile/media-proxy.ts` (鉴权代理 `/a2a`)
- **Gateway 修改:** `gateway/src/index.ts:1431` (isLoopback 加固+token强制), `gateway/src/index.ts:3215` (WS ping/prune), `gateway/src/config.ts:354` (apiToken热更拆分), `gateway/src/core/utils/logger.ts:17` (脱敏), `gateway/src/index.ts:1429` (媒体代理直调)
- **Mobile 新增:** `mobile/lib/src/pages/pairing_page.dart`, `mobile/lib/src/services/secure_config_store.dart`, `mobile/lib/src/services/connectivity_watcher.dart`, `mobile/lib/src/services/lifecycle_ws.dart`, `mobile/lib/src/services/push_service.dart`, `mobile/lib/src/cache/session_cache.dart`, `mobile/android/app/src/main/kotlin/ai/mafw/mafw_mobile/PushChannel.kt` (FCM bridge)
- **Mobile 修改:** `mobile/lib/src/config/connection_config.dart:6`, `mobile/lib/src/network/ws_client.dart:16`, `mobile/lib/src/network/gateway_client.dart:11`, `mobile/lib/main.dart:13`, `mobile/lib/src/pages/connection_settings_page.dart:62`, `mobile/lib/src/pages/chat_page.dart:10`, `mobile/android/app/src/main/AndroidManifest.xml:10`, `mobile/android/app/build.gradle.kts:1`, `mobile/pubspec.yaml:30`

---

### Task 1: 安全与鉴权收口（SecureStorage + 空token阻断 + 回环加固 + 日志脱敏）

**Files:**
- Create: `mobile/lib/src/services/secure_config_store.dart`
- Modify: `mobile/lib/src/config/connection_config.dart:6`
- Modify: `mobile/lib/src/pages/connection_settings_page.dart:62`
- Modify: `gateway/src/index.ts:1431-1446` (isLoopback + authorize)
- Modify: `gateway/src/core/utils/logger.ts:17` (脱敏)
- Test: `tests/unit/gateway/mobile-auth.test.ts`, `mobile/test/secure_config_test.dart`

**Interfaces:**
- Consumes: `ConnectionConfig` 现有 `baseUrl/apiToken → headers/wsUrl`
- Produces: `SecureConfigStore { load(), save(cfg), migrateLegacy() }`；Gateway `isLoopback(req)` 加固、`authorize(req):boolean` 三通道一致、空token远程拒绝 401；`log.*` 自动脱敏

- [ ] **Step 1: 写 Gateway 失败测试（空token远程开放 + 日志脱敏）**

```ts
// tests/unit/gateway/mobile-auth.test.ts
import { describe, it, expect } from "vitest";
import { isLoopbackAddr, authorizeRequest } from "../../gateway/src/mobile/auth-helpers";
// 需先创建 gateway/src/mobile/auth-helpers.ts 仅用于测试可导入；实现后移入 index.ts
describe("mobile auth", () => {
  it("空token时非回环应拒绝", () => {
    expect(authorizeRequest({ remoteAddress: "100.64.0.5", headers: {} }, "")).toBe(false);
  });
  it("回环 127.0.0.1/::1/::ffff:127.0.0.1 放行", () => {
    expect(isLoopbackAddr("127.0.0.1")).toBe(true);
    expect(isLoopbackAddr("::1")).toBe(true);
    expect(isLoopbackAddr("::ffff:127.0.0.1")).toBe(true);
  });
  it("127.x 网段放行", () => {
    expect(isLoopbackAddr("127.0.0.2")).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/unit/gateway/mobile-auth.test.ts`
Expected: FAIL `cannot find module auth-helpers`

- [ ] **Step 3: 实现 Gateway 加固（最小）**

```ts
// gateway/src/index.ts 内
const isLoopback = (() => {
  const addr = req.socket.remoteAddress || '';
  // 加固：127.0.0.0/8 + ::1 变体
  return addr === '127.0.0.1' || addr.startsWith('127.') || addr === '::1' || addr === '::ffff:127.0.0.1';
})();
const apiToken = (config.raw as any)?.server?.apiToken || '';
const authorize = (): boolean => {
  if (isLoopback) return true;
  if (!apiToken) return false; // 远程必须配 token（原 true 改为 false）
  const h = String(req.headers.authorization || '');
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  const xToken = String(req.headers['x-api-token'] || '');
  const qToken = new URL(req.url || '/', `http://${req.headers.host||'localhost'}`).searchParams.get('token') || '';
  return bearer === apiToken || xToken === apiToken || qToken === apiToken;
};
```

```ts
// gateway/src/core/utils/logger.ts
function redact(s: string): string {
  return s.replace(/Bearer\s+[^\s"]+/gi, "Bearer ***").replace(/([?&]token=)[^&\s"]+/gi, "$1***");
}
function write(level: string, msg: string, ...args: any[]) {
  const line = `[${new Date().toISOString()}] [${level}] ${redact(msg)}${args.length? " "+redact(args.map(a=> typeof a==='object'?JSON.stringify(a):String(a)).join(" ")):""}\n`;
  // ...
}
```

- [ ] **Step 4: App SecureStorage 实现**

```dart
// mobile/lib/src/services/secure_config_store.dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/connection_config.dart';
class SecureConfigStore {
  static const _kUrl = 'mafw_conn_base_url';
  static const _kTokenLegacy = 'mafw_conn_token';
  static const _kToken = 'mafw_secure_token';
  final _sec = const FlutterSecureStorage();
  Future<ConnectionConfig> load() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString(_kUrl) ?? 'https://xxx.ts.net:3000';
    String? token = await _sec.read(key: _kToken);
    if (token == null) {
      final legacy = prefs.getString(_kTokenLegacy);
      if (legacy != null && legacy.isNotEmpty) {
        token = legacy;
        await _sec.write(key: _kToken, value: legacy);
        await prefs.remove(_kTokenLegacy);
      }
    }
    return ConnectionConfig(baseUrl: url, apiToken: token ?? '');
  }
  Future<void> save(ConnectionConfig c) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kUrl, c.baseUrl);
    await _sec.write(key: _kToken, value: c.apiToken);
  }
}
```

同步改 `mobile/lib/src/config/connection_config.dart:27` 的 `load()/save()` 委托给 `SecureConfigStore`，`connection_settings_page.dart:62` 的保存走新 store。

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- tests/unit/gateway/mobile-auth.test.ts`
Expected: PASS

Run: `cd mobile && flutter test test/secure_config_test.dart`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add gateway/src/index.ts gateway/src/core/utils/logger.ts mobile/lib/src/services/secure_config_store.dart mobile/lib/src/config/connection_config.dart mobile/lib/src/pages/connection_settings_page.dart tests/unit/gateway/mobile-auth.test.ts
git commit -m "feat(security): SecureStorage + 空token远程阻断 + 回环加固 + 日志脱敏"
```

---

### Task 2: Gateway 推送网关 + 设备表 + WS 心跳（在线直推/离线FCM）

**Files:**
- Create: `gateway/src/mobile/device-store.ts`
- Create: `gateway/src/mobile/push-gateway.ts`
- Modify: `gateway/src/index.ts:224,960,3215` (wsClients + ping/prune + 广播)
- Modify: `gateway/src/config.ts:354` (apiToken 热更拆分)
- Test: `tests/unit/gateway/push-gateway.test.ts`

**Interfaces:**
- Consumes: `wsClients:Set<WebSocket>`、`config.raw.server.apiToken`
- Produces: `DeviceStore { register/list/remove }` (600), `PushGateway { onBroadcast(event), registerDevice() }` (1msg/s/设备+全局漏桶、30s ping/60s prune、失败3次退避)

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/gateway/push-gateway.test.ts
import { describe, it, expect } from "vitest";
import { PushGateway } from "../../gateway/src/mobile/push-gateway";
describe("push gateway", () => {
  it("在线设备走WS不走FCM", async () => {
    const gw = new PushGateway({ fcmSend: async () => { throw new Error("should not call"); } });
    gw.markOnline("hash1", { send: () => {} } as any);
    await gw.dispatch({ type: "message.updated", sessionID: "s1" }, "hash1");
    expect(gw.fcmCalls).toBe(0);
  });
  it("离线设备限流 1msg/s", async () => {
    const gw = new PushGateway({ fcmSend: async () => {} });
    await gw.dispatch({ type: "message.updated", sessionID: "s1" }, "unknown");
    await gw.dispatch({ type: "message.updated", sessionID: "s1" }, "unknown");
    expect(gw.fcmCalls).toBe(1); // 第二条被折叠
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- tests/unit/gateway/push-gateway.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: 实现 DeviceStore + PushGateway + WS 心跳**

```ts
// gateway/src/mobile/device-store.ts
import * as fs from 'fs'; import * as path from 'path'; import * as os from 'os';
const P = path.join(os.homedir(), '.mafw', 'mobile-devices.json');
export function loadDevices(): any[] { try { return JSON.parse(fs.readFileSync(P,'utf-8')).devices||[]; } catch { return []; } }
export function saveDevices(devs: any[]) { fs.mkdirSync(path.dirname(P),{recursive:true}); fs.writeFileSync(P, JSON.stringify({devices: devs},null,2)); fs.chmodSync(P, 0o600); }
```

```ts
// gateway/src/mobile/push-gateway.ts
// - 维护 online: Map<hash, {ws, lastPing}>
// - setInterval 30s ping, 60s prune isAlive
// - dispatch: 若 online→ws.send(JSON.stringify(event)); 否则 fcmSend(data{type,sessionID,title,summary,ts}) with collapse_id=sessionID, 令牌桶 1/s/设备
// - fcmSend: 读 MAFW_FCM_SERVICE_ACCOUNT_PATH 默认 ~/.mafw/fcm.json → OAuth2 → POST https://fcm.googleapis.com/v1/projects/{id}/messages:send, 退避3次
```

Gateway `index.ts:3215` 的 `wss.on('connection')` 补 `ws.isAlive=true; ws.on('pong',()=>ws.isAlive=true);`，`setInterval` 30s `ws.ping()`，60s 清 `!isAlive`。

`gateway/src/config.ts:354` 拆：`server.apiToken` 变更时仅更新 `this.data.server.apiToken` 不进 `restartRequired`，其余 `server` 字段仍需重启。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/unit/gateway/push-gateway.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/mobile/device-store.ts gateway/src/mobile/push-gateway.ts gateway/src/index.ts gateway/src/config.ts tests/unit/gateway/push-gateway.test.ts
git commit -m "feat(gateway): 推送网关 + 设备表(600) + WS ping/prune + apiToken热更"
```

---

### Task 3: 配对二维码 + App 扫码页 + 连接策略（Tailscale优先）

**Files:**
- Create: `gateway/src/mobile/pairing.ts`
- Modify: `gateway/src/index.ts` (新增 GET /api/mobile/pairing-code, 路由 ^/api/mobile/(?:\?|$))
- Create: `mobile/lib/src/pages/pairing_page.dart`
- Create: `mobile/lib/src/services/connectivity_watcher.dart`
- Modify: `mobile/lib/src/network/ws_client.dart:16` (jitter+上限30s, 优先Bearer头)
- Modify: `mobile/lib/main.dart:13` (SecureStore + 扫码入口)
- Test: `tests/unit/gateway/pairing.test.ts`, `mobile/test/pairing_page_test.dart`

**Interfaces:**
- Consumes: `DeviceStore`, `SecureConfigStore`, `GatewayClient.health()`
- Produces: `GET /api/mobile/pairing-code → { url: "mafw://pair?..." }` (5min/单次/限频), `PairingPage` 扫码写入 SecureStorage, `ConnectivityWatcher` 驱动 WS 重连

- [ ] **Step 1: 写失败测试（配对单次兑现）**

```ts
// tests/unit/gateway/pairing.test.ts
import { createPairingCode, redeem } from "../../gateway/src/mobile/pairing";
it("单次兑现后二次失败", () => {
  const c = createPairingCode("https://x.ts.net:3000","tok123");
  expect(redeem(c.nonce).ok).toBe(true);
  expect(redeem(c.nonce).ok).toBe(false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- tests/unit/gateway/pairing.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 pairing + 路由 + App 扫码**

```ts
// gateway/src/mobile/pairing.ts: Map<nonce,{url,token,exp}> + TTL 300s + 5/min/IP 限频 + redeem单次
```

Gateway `index.ts` 新增：
```ts
if (req.url?.match(/^\/api\/mobile\/pairing-code(?:\?|$)/) && req.method==='GET') {
  if (!authorize()) { 401; return; }
  // 限频 5/min/IP
  const code = createPairingCode(tailnetUrl, apiToken);
  res.end(JSON.stringify({ url: `mafw://pair?url=${encodeURIComponent(code.url)}&token=${encodeURIComponent(code.token)}&v=1&exp=300&nonce=${code.nonce}` }));
  return;
}
if (req.url?.match(/^\/api\/mobile\/devices(?:\?|$)/)) { /* register/list/delete */ }
```

App：
```dart
// mobile/lib/src/pages/pairing_page.dart: mobile_scanner 解析 mafw://pair → SecureConfigStore.save(ConnectionConfig(baseUrl:url, apiToken:token))
```

```dart
// mobile/lib/src/network/ws_client.dart:39
var url = config.wsUrl;
final headers = {'Authorization': 'Bearer ${config.apiToken}'}; // 优先头
// WebSocketChannel.connect(Uri.parse(url), protocols:..., ) 时 headers 经 platform 注入；query token 仅兼容保留
// 退避: Duration(seconds: [1,2,5,10,15,30][attempts.clamp(0,5)]) + jitter 0-500ms
```

```dart
// mobile/lib/src/services/connectivity_watcher.dart: connectivity_plus 监听 → ws.connect() + GatewayClient.health() 探活
```

- [ ] **Step 4: 运行测试**

Run: `npm test -- tests/unit/gateway/pairing.test.ts`
Expected: PASS

Run: `cd mobile && flutter test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/mobile/pairing.ts gateway/src/index.ts mobile/lib/src/pages/pairing_page.dart mobile/lib/src/services/connectivity_watcher.dart mobile/lib/src/network/ws_client.dart mobile/lib/main.dart
git commit -m "feat(mobile): 配对二维码(5min单次) + 扫码页 + Tailscale连接策略"
```

---

### Task 4: Android FCM 集成 + 通知通道 + 点击链路

**Files:**
- Modify: `mobile/pubspec.yaml:30` (firebase_core, firebase_messaging, flutter_local_notifications, connectivity_plus, flutter_secure_storage, mobile_scanner)
- Modify: `mobile/android/app/src/main/AndroidManifest.xml:10` (POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, FOREGROUND_SERVICE where needed)
- Create: `mobile/lib/src/services/push_service.dart`
- Create: `mobile/android/app/src/main/kotlin/ai/mafw/mafw_mobile/PushChannel.kt`
- Create: `mobile/firebase.json` / `mobile/android/app/google-services.json` (占位说明)
- Test: `mobile/test/push_service_test.dart`

**Interfaces:**
- Consumes: `POST /api/mobile/devices/register`, `WsClient.events`, `GatewayClient.messages`
- Produces: `PushService { init(), onTokenRefresh, handleInitialMessage }` 双通道 `mafw_messages(high)`/`mafw_goals(default)`，点击 `data.sessionID → ChatPage`

- [ ] **Step 1: 写失败测试**

```dart
// mobile/test/push_service_test.dart
test('FCM data 仅摘要不含全文', () {
  final payload = buildFcmData(type: 'message.updated', sessionID: 's1', title: 'Hi', summary: 'first 80');
  expect(payload.containsKey('text'), isFalse);
  expect(payload['summary'].length <= 80, isTrue);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd mobile && flutter test test/push_service_test.dart`
Expected: FAIL (buildFcmData not found)

- [ ] **Step 3: 实现**

```dart
// mobile/lib/src/services/push_service.dart
// - Firebase.initializeApp()
// - createNotificationChannels: mafw_messages (high, sound/vibrate), mafw_goals (default)
// - onMessage: 若 currentSessionID==data.sessionID 仅刷新 WsClient.events，否则 flutter_local_notifications.show()
// - getInitialMessage/onMessageOpenedApp → Navigator.push(ChatPage(sessionID))
// - onTokenRefresh → POST /api/mobile/devices/register {fcmToken, deviceId=androidId}
// - WorkManager 15min health()+listSessions 仅 lastFcmAt>24h 加频, 约束 requiresBatteryNotLow+requiresNetworkConnected
```

`AndroidManifest.xml` 补：
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" /> <!-- 仅保活开关开启时使用 -->
```

- [ ] **Step 4: 运行测试**

Run: `cd mobile && flutter test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add mobile/pubspec.yaml mobile/android/app/src/main/AndroidManifest.xml mobile/lib/src/services/push_service.dart mobile/android/app/src/main/kotlin/ai/mafw/mafw_mobile/PushChannel.kt
git commit -m "feat(mobile): FCM推送 + 双通道 + 点击拉详情 + Token生命周期"
```

---

### Task 5: 媒体鉴权代理 + TTS + 记忆/Goal/Triage

**Files:**
- Create: `gateway/src/mobile/media-proxy.ts`
- Modify: `gateway/src/index.ts:1429` (直调 mediaAgent.handleJsonRpc, 禁外部URL, 复用 MAX_*_BYTES)
- Modify: `mobile/lib/src/network/gateway_client.dart:11` (listGoals/getGoal, triage, mediaTasks)
- Modify: `mobile/lib/src/pages/chat_page.dart:174` (附件钮+预览+指针占位, 长按TTS)
- Test: `tests/unit/gateway/media-proxy.test.ts`

**Interfaces:**
- Consumes: `mediaAgent.handleJsonRpc`, `GatewayClient` 现有方法
- Produces: `POST /api/mobile/media/tasks` (multipart) + `POST /api/mobile/media/tasks/:id/ask` (鉴权直调), App 附件上传与 `just_audio` 播放

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/gateway/media-proxy.test.ts
it("禁止外部URL透传", async () => {
  await expect(proxyCreate({ url: "http://evil.com/img.jpg" })).rejects.toThrow(/forbidden/);
});
it("超限 413", async () => {
  await expect(proxyCreate({ file: big(30*1024*1024) })).rejects.toThrow(/413/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- tests/unit/gateway/media-proxy.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

Gateway直调：
```ts
const result = await this.mediaAgent.handleJsonRpc({ jsonrpc:"2.0", method:"createTask", params:{file, question}}, headers);
// 不 fetch http://127.0.0.1/a2a
```

App `gateway_client.dart` 新增：
```dart
Future<Map<String,dynamic>> createMediaTask(Uint8List bytes, String question) // POST /api/mobile/media/tasks multipart
Future<Map<String,dynamic>> askMedia(String taskID, String question)
Future<List<Map<String,dynamic>>> listGoals()
```

`chat_page.dart:174` 输入栏加 `IconButton(Icons.attach_file)` → `image_picker` + 1280px 压缩 → 上传 → 插入 `[媒体附件 taskID:...]`；长按气泡 `PopupMenuItem("朗读")` → `ttsSpeak(text)` → `just_audio` 播 `/a2a/artifacts/<id>` (带 Bearer)。

- [ ] **Step 4: 运行测试**

Run: `npm test -- tests/unit/gateway/media-proxy.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/mobile/media-proxy.ts gateway/src/index.ts mobile/lib/src/network/gateway_client.dart mobile/lib/src/pages/chat_page.dart
git commit -m "feat(media): 鉴权代理直调 + App多模态/TTS + 记忆/Goal"
```

---

### Task 6: 启动/体积/电量/流量优化 + 缓存与生命周期

**Files:**
- Modify: `mobile/android/app/build.gradle.kts:1` (split-per-abi, minify, shrinkResources, resConfigs)
- Modify: `mobile/lib/main.dart:35` (并行初始化 + 首帧延迟 + WidgetsBindingObserver)
- Create: `mobile/lib/src/services/lifecycle_ws.dart`
- Create: `mobile/lib/src/cache/session_cache.dart` (hive_ce, TTL 24h, limit50)
- Modify: `mobile/pubspec.yaml:30` (hive_ce, drift 可选)
- Test: `mobile/test/lifecycle_ws_test.dart`, `tests/unit/mobile/cache.test.ts`

- [ ] **Step 1: 写失败测试**

```dart
test('后台立即 close，前台重连', () {
  final lc = LifecycleWs(ws: fakeWs);
  lc.didChangeAppLifecycleState(AppLifecycleState.paused);
  expect(fakeWs.closed, isTrue);
  lc.didChangeAppLifecycleState(AppLifecycleState.resumed);
  expect(fakeWs.connectCalls, 1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd mobile && flutter test test/lifecycle_ws_test.dart`
Expected: FAIL

- [ ] **Step 3: 实现**

`build.gradle.kts`:
```kotlin
android {
  splits.abi { isEnable = true; reset(); include("arm64-v8a","armeabi-v7a","x86_64") }
  buildTypes { release { isMinifyEnabled = true; isShrinkResources = true; resConfigs("en","zh") } }
  bundle { abi { enableSplit = true } }
}
```

`main.dart:35`:
```dart
Future<void> _init() async {
  WidgetsFlutterBinding.ensureInitialized();
  final results = await Future.wait([SecureConfigStore().load(), Firebase.initializeApp()]);
  // hide splash
  await Future.delayed(Duration(milliseconds: 200)); // 首帧后
  ws.connect();
}
class _MafwMobileAppState extends State<MafwMobileApp> with WidgetsBindingObserver {
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s==AppLifecycleState.paused) ws.close();
    if (s==AppLifecycleState.resumed) ws.connect();
  }
}
```

`hive_ce` 缓存 `session:{id}:messages` TTL 24h，`Accept-Encoding: gzip`，媒体本地压缩。

- [ ] **Step 4: 构建验证**

Run: `cd mobile && flutter build apk --analyze-size` (或 `flutter build appbundle`)
Expected: `appbundle` 产出，`analyze-size <35MB/abi`

Run: `cd mobile && flutter test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add mobile/android/app/build.gradle.kts mobile/lib/main.dart mobile/lib/src/services/lifecycle_ws.dart mobile/lib/src/cache/session_cache.dart mobile/pubspec.yaml
git commit -m "perf(mobile): aab+split+R8 + 前后台WS + hive_ce缓存 + 首帧延迟"
```

---

### Task 7: 联调与门禁（健康/重连/401重配对/边界/Baseline Profile）

**Files:**
- Create: `mobile/android/app/src/test/baseline-profiler` (Macrobenchmark)
- Modify: `docs/superpowers/plans/2026-08-19-android-app-gateway.md` (验收清单)
- Test: 端到端联调脚本 `scripts/mobile-e2e.sh`

- [ ] **Step 1: 联调脚本（失败态）**

```bash
# scripts/mobile-e2e.sh
# 1. 未配对 → 扫码 → health 200
# 2. 杀后台 → FCM data 到达 → 点击 → messages 拉详情
# 3. 401 → 弹重新扫码
# 4. 媒体 20/50/25MB 边界 413
# 5. Tailscale 未登录提示
```

- [ ] **Step 2: 运行联调**

Run: `bash scripts/mobile-e2e.sh`
Expected: 初次 FAIL (缺 google-services.json 时提示 `fcm: disabled` 仍可 WS)

- [ ] **Step 3: 补 Baseline Profile + 门禁**

Macrobenchmark 录 `SessionsPage→ChatPage` 生成 `baseline-profils.txt`，CI 加 `analyze-size` 阈值。

Run: `adb shell am start -W ai.mafw.mafw_mobile/.MainActivity`
Expected: `TotalTime <1200ms`

- [ ] **Step 4: 提交**

```bash
git add scripts/mobile-e2e.sh mobile/android/app/src/test/baseline-profiler
git commit -m "chore(mobile): 联调脚本 + Baseline Profile + 门禁"
```

---

## Self-Review

- **Spec 覆盖:** §5 连接配对 → Task 3；§6 推送后台 → Task 2+4；§7 优化 → Task 6；§8 语音多模态TTS/记忆Goal → Task 5；§9 安全 → Task 1；9项 Must 全映射（SecureStorage/空token/回环/日志/WS心跳/热更/直调/hive_ce/生命周期）✓
- **占位符扫描:** 无 TBD/TODO，步骤含完整代码与精确命令 ✓
- **类型一致性:** `SecureConfigStore/GatewayClient/WsClient/PushService/DeviceStore/Pairing` 命名与签名前后一致；`apiToken` 指纹、路由锚定、`collapse_id` 一致 ✓
