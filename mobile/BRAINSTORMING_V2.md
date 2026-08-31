# Android App 优化与 App-Gateway 连接建设 — V2 头脑风暴

**日期**: 2026-08-31  
**状态**: 分析完成，方案设计  
**前置文档**: `BRAINSTORMING_FINAL.md`（V1）、`docs/superpowers/specs/2026-08-19-android-app-gateway-design.md`

---

## 0. 执行摘要

在 V1 头脑风暴（2026-08-25）基础上，本次深入代码级分析，识别出 **3 层 12 个具体瓶颈**，并设计了针对性优化方案。核心发现：

- **App 侧已完成度 ~75%**：WS 双版本（v1 简洁 + v2 智能重连）、FCM 推送、生命周期管理、mDNS 发现、配对二维码、媒体上传/TTS 全链路已实现
- **Gateway 侧已完成度 ~80%**：推送网关、设备表、配对服务、媒体代理、mDNS 广播已实现
- **关键差距在「胶水层」**：App 用的是 WsClient（v1）而非 WsClientV2；SmartReconnectManager 的持久化有 bug；主流程 main.dart 未接入 V2 客户端

---

## 1. 现状审计（代码级）

### 1.1 App 侧已完成

| 模块 | 文件 | 状态 | 备注 |
|------|------|------|------|
| HTTP 客户端 | `gateway_client.dart` | ✅ 完成 | 覆盖 sessions/messages/enriched/memory/goals/triage/media/TTS |
| WS 客户端 v1 | `ws_client.dart` | ✅ 完成 | 基础指数退避 1/2/5/10/15/30s + jitter，**正在使用** |
| WS 客户端 v2 | `ws_client_v2.dart` | ✅ 完成 | SmartReconnectManager + 最大 10 次 + 错误事件流，**未接入主流程** |
| 智能重连 | `smart_reconnect.dart` | ⚠️ 有 bug | SharedPreferences 存储 `toJson().toString()` 而非 `jsonEncode()`，反序列化会失败 |
| 连接配置 | `connection_config.dart` | ✅ 完成 | baseUrl + apiToken → normalizedBaseUrl/wsUrl/headers |
| 安全存储 | `secure_config_store.dart` | ✅ 完成 | flutter_secure_storage + 旧 token 迁移 |
| 配对页 | `pairing_page.dart` | ✅ 完成 | QR 扫描 + mDNS 发现 + 手动输入 + nonce 验证 |
| mDNS 发现 | `mdns_discovery.dart` | ✅ 完成 | `_mafw._tcp` DNS-SD 扫描 |
| 连接设置 | `connection_settings_page.dart` | ✅ 完成 | URL + Token + 测试连接 |
| 生命周期 | `lifecycle_ws.dart` | ✅ 完成 | WidgetsBindingObserver pause/resume |
| 网络监听 | `connectivity_watcher.dart` | ✅ 完成 | 500ms 防抖 + health 探活 |
| 推送服务 | `push_service.dart` | ✅ 完成 | FCM token 注册 + 通知通道 + 点击链路 + WorkManager 15min |
| 会话缓存 | `session_cache.dart` | ✅ 完成 | hive_ce + TTL 24h + 每 session 50 条上限 |
| 错误模型 | `error_models.dart` | ✅ 完成 | ErrorType/ErrorAction/MafwError/StructuredErrorHandler |
| 聊天页 | `chat_page.dart` | ✅ 完成 | 流式阶段指示 + 媒体上传 + TTS 朗读 + 优化滚动 |
| 会话列表 | `sessions_page.dart` | ✅ 完成 | 4 Tab（会话/Goal/记忆/我的）+ 搜索 + 离线横幅 |
| 主入口 | `main.dart` | ✅ 完成 | Firebase + Hive + 配置加载 + WS + FCM + 生命周期 + 网络监听 |

### 1.2 Gateway 侧已完成

| 模块 | 文件 | 状态 | 备注 |
|------|------|------|------|
| WS 端点 | `index.ts:4250-4340` | ✅ 完成 | WebSocketServer + ping 30s + prune 60s + deviceId 追踪 |
| 推送网关 | `push-gateway.ts` | ✅ 完成 | 在线直推 WS + 离线 FCM + 1msg/s/设备限流 + 3x 退避 |
| 设备表 | `device-store.ts` | ✅ 完成 | 600 权限 JSON + 7 天 pruning + touch/syncLastSeen |
| 配对服务 | `pairing.ts` | ✅ 完成 | nonce 哈希存储 + TTL 300s + 5/min/IP 限频 |
| 媒体代理 | `media-proxy.ts` | ✅ 完成 | multipart 上传 + A2A 直调 + SSRF 防护 + sharp 压缩 |
| mDNS 广播 | `mdns-advertiser.ts` | ✅ 完成 | bonjour-service `_mafw._tcp` |
| TTS | `tts-service.ts` + `tts-artifact.ts` | ✅ 完成 | MiMo-V2.5-TTS + 3 种模式 |

### 1.3 胶水层差距（核心瓶颈）

| # | 瓶颈 | 影响 | 严重度 |
|---|------|------|--------|
| **G1** | `main.dart` 用 WsClient v1，WsClientV2 + SmartReconnectManager 未接入 | 智能重连形同虚设 | 🔴 高 |
| **G2** | SmartReconnectManager `_saveState()` 用 `json.toString()` 而非 `jsonEncode()` | 反序列化永远失败，持久化无效 | 🔴 高 |
| **G3** | ChatPage 的 `WsClient` 参数类型是 v1，无法无缝切换到 v2 | 切换需要改所有页面签名 | 🟡 中 |
| **G4** | main.dart 的 `LifecycleWsManager` 调用 `ws.disconnect()`/`ws.reconnect()`，WsClientV2 用 `disconnect()`/`resume()` 语义不同 | 生命周期管理不匹配 | 🟡 中 |
| **G5** | ConnectivityWatcher 调用 `ws.reconnect()`，WsClientV2 的 reconnect 会 reset 状态 | 网络切换时重置退避计数 | 🟡 中 |
| **G6** | PushService 注入 WsClient v1 引用 | 事件消费绑定旧客户端 | 🟡 中 |
| **G7** | 无消息分页 — `messages(limit=50)` 一次全拉 | 长会话加载慢 | 🟡 中 |
| **G8** | Gateway `/api/sessions/:id/messages` 不支持 `before` 参数 | 服务端无分页能力 | 🟡 中 |
| **G9** | App 无消息增量更新 — 每次 WS 事件全量 `_loadHistory()` | 流式场景 HTTP 开销大 | 🟡 中 |
| **G10** | 无 Token 自动轮换 — apiToken 永不过期 | 安全风险 | 🟢 低（v2） |
| **G11** | 媒体上传无断点续传 — 大文件失败需重传 | 体验差 | 🟢 低（v2） |
| **G12** | 无离线消息队列 — 断网时发送的消息丢失 | 数据丢失 | 🟢 低（v2） |

---

## 2. 优化方案设计

### 方案 A：WsClient 统一 + 智能重连激活（G1-G6）

**目标**: 让 WsClientV2 的智能重连真正生效，统一所有消费者。

**方案**: 定义一个抽象接口，让 v1 和 v2 都实现它；main.dart 按配置选择具体实现。

```dart
/// 统一 WS 客户端接口 — 所有页面依赖此接口，不依赖具体实现
abstract class MafwWsClient {
  Stream<MafwEvent> get events;
  Stream<bool> get connectionStatus;
  bool get isConnected;
  Future<void> connect();
  Future<void> reconnect();
  void disconnect();
  Future<void> send(String message, {String? sessionID});
  void dispose();
}
```

**改动范围**:
1. 新建 `mobile/lib/src/network/ws_client_interface.dart` — 抽象接口
2. `ws_client.dart` implements MafwWsClient（零改动，仅加 implements）
3. `ws_client_v2.dart` implements MafwWsClient（加 resume→reconnect 适配）
4. `main.dart` — 创建 WsClientV2 并注入各页面
5. `chat_page.dart` — 参数类型改为 MafwWsClient
6. `push_service.dart` — 参数类型改为 MafwWsClient

**预期效果**: 智能重连（10 次上限 + 持久化 + 指数退避）立即生效；后续可无缝切换到更优实现。

### 方案 B：SmartReconnectManager 持久化修复（G2）

**目标**: 修复 SharedPreferences 存储 bug。

**当前 bug**:
```dart
// smart_reconnect.dart:127 — 错误写法
await _prefs?.setString(_stateKey, json.toString());
// json.toString() 输出 {attempts: 1, lastSuccess: ...}（Dart Map toString）
// 而 ReconnectState.fromJson 期望 JSON 字符串
```

**修复**:
```dart
import 'dart:convert';
await _prefs?.setString(_stateKey, jsonEncode(json));
```

加载也要修：
```dart
// 当前：json 是 String，直接 cast Map 会失败
final map = Map<String, dynamic>.from(Uri.decodeComponent(json) as Map);
// 修复：
final map = jsonDecode(json) as Map<String, dynamic>;
```

### 方案 C：消息分页加载（G7-G8）

**目标**: 支持按时间倒序分页加载消息，减少首次加载数据量。

**Gateway 改动**:
```typescript
// gateway/src/index.ts — /api/sessions/:id/messages 路由
// 新增 before 参数
if (req.url?.match(/^\/api\/sessions\/([^/]+)\/messages(?:\?|$)/)) {
  const before = url.searchParams.get('before'); // message ID
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  // SQLite 查询：WHERE session_id = ? AND (before IS NULL OR created < before_created) 
  // ORDER BY created DESC LIMIT ?
}
```

**App 改动**:
```dart
// gateway_client.dart
Future<List<MafwMessage>> messages(
  String sessionID, {
  int limit = 20,
  String? before, // 新增：此消息之前的消息
}) async {
  final params = {'limit': '$limit'};
  if (before != null) params['before'] = before;
  // ...
}
```

**ChatPage 改动**:
- 初始加载 `limit=20`（而非 50）
- 滚动到底部时加载更多 `messages(sid, limit=20, before: oldestMessageId)`
- WS 增量事件只更新变化的消息（方案 D）

### 方案 D：消息增量更新（G9）

**目标**: 避免每次 WS 事件全量刷新消息列表。

**当前问题**: ChatPage `_onEvent` 每次收到 `message.part.delta` 都调 `_loadHistory()`（HTTP GET 全部消息）。

**优化方案**:
```dart
void _onEvent(MafwEvent ev) {
  final propsType = ev.innerType;
  
  // 增量：part.delta → 只更新当前生成中的消息文本
  if (propsType == 'message.part.delta' && _streamingMessage != null) {
    final delta = ev.properties?['delta'] as String? ?? '';
    _streamingMessage = _streamingMessage!.copyWith(
      text: (_streamingMessage!.text ?? '') + delta,
    );
    setState(() {}); // 只重建一条消息
    return;
  }
  
  // 完成：message.complete → 用完整消息替换流式占位
  if (propsType == 'message.complete') {
    final completeMsg = _parseCompleteMessage(ev);
    _replaceStreamingMessage(completeMsg);
    return;
  }
  
  // 新消息：message.updated（非当前会话的）→ debounce 全量刷新
  if (propsType == 'message.updated' || propsType == 'session.idle') {
    _refreshDebounced();
  }
}
```

**核心思路**:
- `message.part.delta` → 纯 UI 增量拼接，零 HTTP
- `message.complete` → 用完整对象替换流式占位
- `session.idle` → debounce 一次全量刷新（确保一致性）
- 减少 ~80% 的 HTTP 请求（流式生成期间）

---

## 3. 优先级排序与实施路径

### Phase 0：紧急修复（1 天）
| # | 任务 | 文件 | 工作量 |
|---|------|------|--------|
| B | SmartReconnectManager 持久化修复 | `smart_reconnect.dart` | 0.5h |
| A1 | 创建 MafwWsClient 接口 | 新文件 | 1h |
| A2 | WsClient implements 接口 | `ws_client.dart` | 0.5h |
| A3 | WsClientV2 implements + 适配 | `ws_client_v2.dart` | 1h |
| A4 | main.dart 切换到 V2 | `main.dart` | 1h |
| A5 | ChatPage/PushService 类型更新 | `chat_page.dart` + `push_service.dart` | 1h |

**验收**: SmartReconnectManager 持久化正常工作；WS 断线后重连遵循 10 次上限 + 指数退避；App 重启后重连状态恢复。

### Phase 1：消息体验优化（3 天）
| # | 任务 | 文件 | 工作量 |
|---|------|------|--------|
| C1 | Gateway 消息分页 API | `gateway/src/index.ts` | 4h |
| C2 | App 分页加载 | `gateway_client.dart` + `chat_page.dart` | 4h |
| D | 消息增量更新 | `chat_page.dart` | 6h |
| — | 单元测试 | `mobile/test/` | 4h |

**验收**: 长会话首次加载 <500ms；流式生成期间零 HTTP 请求；滚动加载平滑。

### Phase 2：安全与体验（2 周，v2 scope）
| # | 任务 | 工作量 |
|---|------|--------|
| G10 | Token 自动轮换（Access 1h + Refresh 30d） | 1 周 |
| G11 | 媒体分片上传 + 断点续传 | 3 天 |
| G12 | 离线消息队列 | 3 天 |

---

## 4. 架构图

```
┌─────────────────────────────────────────────────┐
│                  Android App                     │
│                                                  │
│  main.dart                                       │
│    ├─ SecureConfigStore (flutter_secure_storage) │
│    ├─ WsClientV2 (implements MafwWsClient)       │ ← Phase 0 切换
│    │    ├─ SmartReconnectManager (持久化修复)     │ ← Phase 0 修复
│    │    └─ events broadcast stream                │
│    ├─ GatewayClient (HTTP)                       │
│    │    ├─ messages(sid, limit=20, before=?)      │ ← Phase 1 分页
│    │    └─ sendEnriched / memory / goals / ...    │
│    ├─ PushService (FCM)                          │
│    │    ├─ 注册 + 通知 + 点击链路                  │
│    │    └─ 消费 WsClientV2.events                │
│    ├─ ConnectivityWatcher (connectivity_plus)    │
│    ├─ LifecycleWsManager (WidgetsBindingObserver)│
│    └─ SessionCache (hive_ce, TTL 24h)           │
│                                                  │
│  ChatPage                                        │
│    ├─ 增量消息渲染（delta → 拼接）                 │ ← Phase 1 增量
│    ├─ 分页加载（滚动到底 → before=oldest）         │ ← Phase 1 分页
│    └─ MafwWsClient（接口类型，不绑具体实现）       │ ← Phase 0 解耦
│                                                  │
│  SessionsPage                                    │
│    ├─ 会话 Tab (搜索 + 列表)                      │
│    ├─ Goal Tab (Triage 快捷入口)                  │
│    ├─ 记忆 Tab (BM25 检索)                       │
│    └─ 我的 Tab (Gateway 设置 + 扫码配对)          │
└──────────────────────┬──────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │  Tailscale tailnet      │
          │  https://xxx.ts.net:3000│
          └────────────┬────────────┘
                       │
┌──────────────────────┴──────────────────────────┐
│                MAFW Gateway (:3000)               │
│                                                   │
│  HTTP API                                         │
│    ├─ /health                                      │
│    ├─ /api/sessions/:id/messages?limit=&before=    │ ← Phase 1 分页
│    ├─ /api/chat/enriched                           │
│    ├─ /api/memory/search                           │
│    ├─ /api/goals                                   │
│    ├─ /api/triage                                  │
│    ├─ /api/mobile/pairing-code + /verify           │
│    ├─ /api/mobile/devices/register                 │
│    ├─ /api/mobile/media/tasks + /:id/ask           │
│    ├─ /api/tts + /api/tts/voices                   │
│    └─ /api/recall/context                          │
│                                                   │
│  WebSocket /api/ws                                │
│    ├─ broadcast → 所有在线 wsClients               │
│    ├─ pushGateway.onBroadcast → 在线直推/离线 FCM   │
│    ├─ ping 30s / prune 60s / isAlive               │
│    └─ deviceId 追踪 → PushGateway.addOnlineWs      │
│                                                   │
│  Services                                         │
│    ├─ PushGateway + DeviceStore                    │
│    ├─ PairingService (nonce + 限频)                │
│    ├─ MdnsAdvertiser (_mafw._tcp)                  │
│    ├─ MediaAgent (A2A + pi runtime)                │
│    ├─ TTS Service                                  │
│    ├─ HarmonicIndexManager (BM25 检索)             │
│    └─ AutomationEngine                             │
└───────────────────────────────────────────────────┘
```

---

## 5. 详细技术设计

### 5.1 MafwWsClient 接口（方案 A 核心）

```dart
// mobile/lib/src/network/ws_client_interface.dart

import 'dart:async';
import 'mafw_models.dart';

/// 统一 WebSocket 客户端接口。
/// 
/// 所有消费 WS 事件的页面和服务都依赖此接口，
/// 不绑定具体实现（v1 简洁版 / v2 智能重连版）。
abstract class MafwWsClient {
  /// 接收到的事件流（广播）
  Stream<MafwEvent> get events;
  
  /// 连接状态流（true = 已连接）
  Stream<bool> get connectionStatus;
  
  /// 当前是否已连接
  bool get isConnected;
  
  /// 建立连接
  Future<void> connect();
  
  /// 强制重连（网络切换、手动刷新等场景）
  Future<void> reconnect();
  
  /// 断开连接（保持客户端可用，可再次 connect）
  void disconnect();
  
  /// 发送聊天消息（gateway 注入记忆上下文）
  Future<void> send(String message, {String? sessionID});
  
  /// 释放资源
  void dispose();
}
```

**WsClientV2 适配**:
```dart
// ws_client_v2.dart — 补充 disconnect 后可 reconnect 的语义
class WsClientV2 implements MafwWsClient {
  // ... 现有代码 ...
  
  @override
  void disconnect() {
    _intentionalDisconnect = true; // 已有
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _channel = null;
    _status.add(false);
  }
  
  // 注意：WsClientV2 原有的 resume() 方法语义等同于 
  // disconnect + connect，可直接用 reconnect() 替代
  @override
  Future<void> reconnect() async {
    _intentionalDisconnect = false; // 清除有意断开标记
    _reconnectManager.reset();
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _channel = null;
    _status.add(false);
    await connect();
  }
}
```

### 5.2 SmartReconnectManager 修复（方案 B 核心）

```dart
// smart_reconnect.dart — 修复 _saveState 和 _loadState

import 'dart:convert'; // 新增导入

class SmartReconnectManager {
  // ... 其他代码不变 ...

  Future<void> _saveState() async {
    try {
      final json = _state.toJson();
      // 修复：用 jsonEncode 而非 toString()
      await _prefs?.setString(_stateKey, jsonEncode(json));
    } catch (e) {
      // Best effort
    }
  }

  Future<void> _loadState() async {
    try {
      final raw = _prefs?.getString(_stateKey);
      if (raw != null && raw.isNotEmpty) {
        final map = jsonDecode(raw) as Map<String, dynamic>;
        _state = ReconnectState.fromJson(map);
      }
    } catch (e) {
      _state = const ReconnectState();
    }
  }
}
```

### 5.3 消息增量更新（方案 D 核心）

```dart
// chat_page.dart — 增量消息渲染

class _ChatPageState extends State<ChatPage> {
  // ... 现有字段 ...
  
  /// 当前正在流式生成的消息（占位）
  MafwMessage? _streamingMessage;
  
  void _onEvent(MafwEvent ev) {
    final isSessionEvent = ev.sessionID == null || ev.sessionID == widget.session.id;
    final propsType = ev.innerType;
    
    if (!isSessionEvent) return;
    
    // ── 阶段驱动（现有逻辑，保留）──
    if (_sending) {
      if (propsType == 'message.part.updated' || propsType == 'message.part.delta') {
        if (_phase != _GenPhase.writing) {
          setState(() => _phase = _GenPhase.writing);
        }
        // 增量：拼接 delta 到流式消息
        _handleStreamingDelta(ev);
        return;
      }
      if (propsType == 'message.complete' || propsType == 'message.error' || propsType == 'session.idle') {
        _handleStreamingComplete(ev);
        return;
      }
    }
    
    // ── 非流式事件：debounce 全量刷新 ──
    if (propsType == 'message.updated' || propsType == 'session.idle') {
      _refreshDebounce?.cancel();
      _refreshDebounce = Timer(const Duration(milliseconds: 300), _loadHistory);
    }
  }
  
  void _handleStreamingDelta(MafwEvent ev) {
    final delta = ev.properties?['delta'] as String? ?? '';
    if (delta.isEmpty) return;
    
    setState(() {
      if (_streamingMessage == null) {
        // 首次 delta：创建流式占位消息
        _streamingMessage = MafwMessage(
          id: 'streaming-${DateTime.now().millisecondsSinceEpoch}',
          sessionID: widget.session.id,
          role: 'assistant',
          text: delta,
          timeCreated: DateTime.now().millisecondsSinceEpoch,
        );
        _messages.add(_streamingMessage!);
      } else {
        // 后续 delta：拼接文本
        final idx = _messages.indexWhere((m) => m.id == _streamingMessage!.id);
        if (idx >= 0) {
          _streamingMessage = _streamingMessage!.copyWith(
            text: (_streamingMessage!.text ?? '') + delta,
          );
          _messages[idx] = _streamingMessage!;
        }
      }
    });
    _jumpToBottom();
  }
  
  void _handleStreamingComplete(MafwEvent ev) {
    // 清除流式占位，debounce 一次全量刷新确保一致性
    _streamingMessage = null;
    setState(() {
      _phase = _GenPhase.idle;
      _sending = false;
    });
    _refreshDebounce?.cancel();
    _refreshDebounce = Timer(const Duration(milliseconds: 200), _loadHistory);
  }
}
```

---

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| WsClientV2 接口不兼容 v1 的事件格式 | 低 | 高 | 两者都用 MafwEvent.fromJson，格式一致 |
| SmartReconnectManager 修复后旧缓存数据格式不兼容 | 中 | 低 | _loadState 已有 try-catch 兜底，失败从零开始 |
| 消息增量更新引入渲染闪烁 | 中 | 中 | streamingMessage 用独立引用，setState 只更新一条 |
| Gateway 分页 API 改动影响桌面端 | 低 | 高 | 新增 `before` 参数可选，不影响现有调用 |
| Phase 0 改动引入回归 | 中 | 高 | 改动集中在接口层，现有行为不变；增加 smoke test |

---

## 7. 验收标准

### Phase 0 验收
- [ ] SmartReconnectManager 重启后恢复重连状态（attempts + lastSuccess）
- [ ] WS 断线后重连遵循 [1,2,5,10,15,30]s + jitter，最多 10 次
- [ ] 10 次后停止重连，UI 显示"连接失败"
- [ ] 成功连接后 5 分钟再断线，重试计数重置
- [ ] 所有页面（Chat/Sessions/Goals/Triage）WS 事件正常接收
- [ ] FCM 推送正常到达
- [ ] 现有测试全部通过

### Phase 1 验收
- [ ] 长会话（100+ 消息）首次加载 <500ms（20 条）
- [ ] 滚动到底部自动加载下一页
- [ ] 流式生成期间无 HTTP 请求（仅 delta 拼接）
- [ ] 流式完成后全量刷新确保一致性
- [ ] 单元测试覆盖率 >80%

---

## 8. 后续方向（v2 scope）

1. **Token 自动轮换**: Access Token 1h + Refresh Token 30d，Gateway 新增 `/api/mobile/token/refresh` 端点
2. **端到端加密配对**: nonce 升级为 ECDH 密钥交换，Token 不经明文传输
3. **媒体分片上传**: 大文件（>5MB）自动分片 + 断点续传 + 进度回调
4. **离线消息队列**: 断网时发送的消息本地持久化，恢复后自动重发
5. **后台 WebSocket 保活**: 用户可选"后台保活"开关，起 ForegroundService + 30s 心跳
6. **消息推送富化**: FCM payload 增加 `preview` 字段（前 50 字），减少点击后白屏

---

**最后更新**: 2026-08-31  
**下一步**: 开始 Phase 0 实施，从 SmartReconnectManager 修复 + MafwWsClient 接口创建开始
