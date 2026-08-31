# Android App 优化与 App-Gateway 连接建设 头脑风暴

**目标**：梳理现状、识别瓶颈、设计优化方案
**日期**：2026-08-25
**参与者**：MiMo-v2.5（AI助手）

---

## 第一部分：现状梳理

### 1.1 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    Flutter Android App                   │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   UI层      │  │  网络层     │  │  服务层     │    │
│  │ (Pages)     │  │ (Clients)   │  │ (Services)  │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                │            │
│         └────────────────┼────────────────┘            │
│                          │                             │
│  ┌───────────────────────┴───────────────────────────┐ │
│  │              状态管理 (StatefulWidget)              │ │
│  └───────────────────────┬───────────────────────────┘ │
└──────────────────────────┼─────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    MAFW Gateway                         │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  HTTP API   │  │  WebSocket  │  │  MCP Tools  │    │
│  │  (REST)     │  │  (Events)   │  │  (LLM)      │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                │            │
│         └────────────────┼────────────────┘            │
│                          │                             │
│  ┌───────────────────────┴───────────────────────────┐ │
│  │              谐波记忆系统 (Harmonic Memory)         │ │
│  └───────────────────────┬───────────────────────────┘ │
└──────────────────────────┼─────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              OpenCode Serve (Sidecar)                   │
│              LLM 推理引擎                               │
└─────────────────────────────────────────────────────────┘
```

### 1.2 连接流程

#### 当前实现：
1. **手动配置**：用户输入 `Base URL` + `API Token`
2. **配对连接**：通过 `mafw://pair?...` URL scheme 自动配置
3. **WebSocket**：建立实时事件流（SSE 替代方案）
4. **推送通知**：Firebase Cloud Messaging (FCM) 离线推送

#### 连接状态管理：
```dart
// mobile/lib/main.dart
MafwMobileApp
  ├── ConnectionConfig? _config      // 连接配置
  ├── GatewayClient? _client         // HTTP 客户端
  ├── WsClient? _ws                  // WebSocket 客户端
  ├── PushService? _pushService      // 推送服务
  ├── ConnectivityWatcher? _connectivityWatcher  // 网络监听
  └── LifecycleWsManager? _lifecycleManager      // 生命周期管理
```

### 1.3 当前功能矩阵

| 功能 | 状态 | 实现方式 | 备注 |
|------|------|----------|------|
| 会话列表 | ✅ | HTTP GET /api/sessions | 支持 projectID 过滤 |
| 消息历史 | ✅ | HTTP GET /api/sessions/{id}/messages | 限制 limit=50 |
| 发送消息 | ✅ | WebSocket send / HTTP POST /api/chat/enriched | 记忆注入内置 |
| 实时事件 | ✅ | WebSocket /api/ws | 自动重连 |
| 推送通知 | ✅ | FCM + 本地通知 | 前台消息不重复弹窗 |
| 媒体上传 | ✅ | HTTP POST /api/mobile/media/tasks | 支持图片/视频/音频 |
| TTS 语音 | ✅ | HTTP POST /api/tts | 多种声音选择 |
| Triage 决策 | ✅ | HTTP POST /api/triage/{id}/confirm\|reject | |
| Goal 管理 | ✅ | HTTP GET /api/goals | |
| 连接测试 | ✅ | HTTP GET /health | 5s 超时 |
| 断线重连 | ✅ | 指数退避 [1,2,5,10,15,30]s | 抖动 0-500ms |
| 网络切换 | ✅ | connectivity_plus + 500ms 防抖 | 健康探测 |
| 后台保活 | ✅ | WorkManager 15min 周期检查 | 电池优化 |
| 安全存储 | ✅ | flutter_secure_storage | API token 加密 |

### 1.4 技术栈

**前端（Flutter）：**
- Flutter 3.x + Dart 3.13+
- web_socket_channel 3.0.3（WebSocket）
- http 1.6.0（HTTP 客户端）
- firebase_messaging 15.2.1（推送）
- flutter_secure_storage 9.2.4（安全存储）
- connectivity_plus 6.1.3（网络状态）
- workmanager 0.10.7（后台任务）
- hive_ce 2.10.0（本地缓存）
- multicast_dns 0.3.3（mDNS 发现）

**后端（Gateway）：**
- Node.js + TypeScript
- 原生 HTTP 服务器（无框架）
- WebSocket (ws 库)
- SQLite (gateway.db)
- Firebase Admin SDK（推送）

---

## 第二部分：瓶颈识别

### 2.1 连接稳定性瓶颈

#### 问题 1：WebSocket 断线重连策略
**现状**：
```dart
// mobile/lib/src/network/ws_client.dart
final baseTable = [1, 2, 5, 10, 15, 30]; // 重试间隔
final jitterMs = (Random().nextDouble() * 500).round(); // 0-500ms 抖动
```

**瓶颈**：
- 重试次数无上限（虽然有最大间隔 30s，但会无限重试）
- 没有退避状态持久化（app 重启后重置）
- 没有服务端连接状态同步（客户端不知道服务端是否收到）

**影响**：网络不稳定时可能出现连接风暴，消耗电量和流量。

#### 问题 2：网络切换处理
**现状**：
```dart
// mobile/lib/src/services/connectivity_watcher.dart
_debounceTimer = Timer(const Duration(milliseconds: 500), () async {
  final ok = await healthProbe();
  if (ok) await onChanged();
});
```

**瓶颈**：
- 只检查网络类型变化，不检查网络质量
- 健康探测只检查 `/health`，不检查 WebSocket 端点
- 没有处理 WiFi→移动数据 的 IP 变化（需要重连）

**影响**：网络切换时可能出现短暂断连，用户体验不流畅。

#### 问题 3：后台 WebSocket 保活
**现状**：
```dart
// mobile/lib/src/services/lifecycle_ws.dart
void didChangeAppLifecycleState(AppLifecycleState state) {
  switch (state) {
    case AppLifecycleState.paused:
    case AppLifecycleState.inactive:
    case AppLifecycleState.detached:
      pause(); // 断开 WebSocket
      break;
    case AppLifecycleState.resumed:
      resume(); // 重连 WebSocket
      break;
  }
}
```

**瓶颈**：
- 后台直接断开 WebSocket，完全依赖 FCM 推送
- FCM 不可靠时（如国内网络环境），用户可能错过重要事件
- 没有后台 WebSocket 心跳机制

**影响**：后台时可能错过实时事件，依赖 FCM 的可靠性。

### 2.2 认证安全性瓶颈

#### 问题 4：API Token 传输安全
**现状**：
```dart
// mobile/lib/src/config/connection_config.dart
Map<String, String> get headers => {
  'Content-Type': 'application/json',
  if (apiToken.isNotEmpty) 'Authorization': 'Bearer $apiToken',
};
```

**瓶颈**：
- API Token 明文传输（HTTP 场景下不安全）
- Token 没有自动轮换机制
- Token 权限粒度不够（全有或全无）

**影响**：中间人攻击风险，Token 泄露后无法限制权限。

#### 问题 5：配对安全
**现状**：
```typescript
// gateway/src/mobile/pairing.ts
const params = new URLSearchParams({
  url: this.tailscaleUrl,
  token: this.apiToken,
  v: '1',
  exp: String(exp),
  nonce,
});
return { url: `mafw://pair?${params.toString()}` };
```

**瓶颈**：
- 配对 URL 包含明文 API Token
- Nonce 只验证一次，没有撤销机制
- 没有设备绑定（同一 Token 可多设备使用）

**影响**：配对 URL 泄露可能导致未授权访问。

### 2.3 性能瓶颈

#### 问题 6：消息列表加载
**现状**：
```dart
Future<List<MafwMessage>> messages(String sessionID, {int limit = 50}) async {
  final res = await _http.get(
    _uri('/api/sessions/$sessionID/messages', {'limit': '$limit'}),
    headers: _headers,
  );
  // ... 解析响应
}
```

**瓶颈**：
- 每次加载 50 条消息，没有分页
- 没有本地缓存（Hive 只用于 session 列表）
- 没有增量更新机制

**影响**：长会话加载慢，流量消耗大。

#### 问题 7：媒体上传效率
**现状**：
```dart
Future<Map<String, dynamic>> uploadMediaTask(String filePath, {String? filename}) async {
  final file = await http.MultipartFile.fromPath('media', filePath, filename: filename);
  // ... 上传文件
}
```

**瓶颈**：
- 大文件上传没有分片
- 没有断点续传
- 没有压缩优化（虽然有 flutter_image_compress 依赖）

**影响**：大文件上传失败率高，用户体验差。

### 2.4 发现机制瓶颈

#### 问题 8：Gateway 发现
**现状**：
```dart
// mobile/lib/src/pages/connection_settings_page.dart
// 手动输入 Base URL 或通过配对 URL
```

**瓶颈**：
- 没有自动发现局域网 Gateway
- mDNS 发现已实现但未集成到 UI
- 没有 Tailscale 网络自动发现

**影响**：用户需要手动配置，门槛高。

### 2.5 错误处理瓶颈

#### 问题 9：错误信息不友好
**现状**：
```dart
if (res.statusCode != 200) throw GatewayException('listSessions: HTTP ${res.statusCode}');
```

**瓶颈**：
- 错误信息只有 HTTP 状态码
- 没有错误分类（网络/认证/业务）
- 没有用户友好的错误提示

**影响**：用户难以理解错误原因，难以自我修复。

### 2.6 测试覆盖瓶颈

#### 问题 10：单元测试不足
**现状**：
```bash
mobile/test/
├── lifecycle_ws_test.dart
├── pairing_page_test.dart
├── push_service_test.dart
└── secure_config_test.dart
```

**瓶颈**：
- 没有 WebSocket 客户端测试
- 没有 Gateway 客户端测试
- 没有网络切换测试

**影响**：重构风险高，回归测试困难。

---

## 第三部分：优化方案设计

### 3.1 连接稳定性优化

#### 方案 1：智能重连策略
**目标**：减少连接风暴，提高重连成功率

**设计**：
```dart
class SmartReconnectManager {
  // 持久化状态
  final SharedPreferences _prefs;
  
  // 重连状态
  int _attempts = 0;
  DateTime? _lastSuccess;
  DateTime? _lastFailure;
  
  // 退避策略
  static const _baseDelays = [1, 2, 5, 10, 15, 30];
  static const _maxAttempts = 10;
  static const _resetAfterSuccess = Duration(minutes: 5);
  
  Future<Duration?> nextDelay() async {
    // 成功后重置计数器
    if (_lastSuccess != null && 
        DateTime.now().difference(_lastSuccess!) > _resetAfterSuccess) {
      _attempts = 0;
    }
    
    // 超过最大次数，返回 null（停止重试）
    if (_attempts >= _maxAttempts) return null;
    
    // 计算退避时间
    final base = _baseDelays[_attempts.clamp(0, _baseDelays.length - 1)];
    final jitter = Random().nextDouble() * 1000; // 0-1s 抖动
    final delay = Duration(seconds: base) + Duration(milliseconds: jitter.toInt());
    
    _attempts++;
    await _saveState();
    
    return delay;
  }
  
  Future<void> onSuccess() async {
    _attempts = 0;
    _lastSuccess = DateTime.now();
    await _saveState();
  }
  
  Future<void> onFailure() async {
    _lastFailure = DateTime.now();
    await _saveState();
  }
  
  Future<void> _saveState() async {
    await _prefs.setInt('reconnect_attempts', _attempts);
    await _prefs.setString('reconnect_last_success', _lastSuccess?.toIso8601String() ?? '');
    await _prefs.setString('reconnect_last_failure', _lastFailure?.toIso8601String() ?? '');
  }
}
```

**优势**：
- 持久化重连状态，app 重启后继续
- 限制最大重试次数，防止无限循环
- 成功后重置计数器，适应网络恢复

#### 方案 2：双通道保活
**目标**：后台时保持 WebSocket 连接，减少 FCM 依赖

**设计**：
```dart
class DualChannelManager {
  final WsClient _ws;
  final PushService _push;
  
  bool _isInBackground = false;
  Timer? _heartbeatTimer;
  
  void onLifecycleChange(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _isInBackground = true;
      _startBackgroundHeartbeat();
    } else if (state == AppLifecycleState.resumed) {
      _isInBackground = false;
      _stopBackgroundHeartbeat();
    }
  }
  
  void _startBackgroundHeartbeat() {
    // 每 30s 发送心跳，保持 WebSocket 连接
    _heartbeatTimer = Timer.periodic(Duration(seconds: 30), (_) {
      if (_ws.isConnected) {
        _ws.sendHeartbeat(); // 新增心跳消息类型
      }
    });
  }
  
  void _stopBackgroundHeartbeat() {
    _heartbeatTimer?.cancel();
  }
}
```

**优势**：
- 后台保持 WebSocket 连接，实时接收事件
- 心跳机制检测连接状态
- 减少 FCM 依赖，提高可靠性

### 3.2 认证安全性优化

#### 方案 3：短生命周期 Token
**目标**：提高 Token 安全性，支持自动轮换

**设计**：
```dart
class TokenManager {
  final SecureConfigStore _store;
  final GatewayClient _client;
  
  // Token 生命周期
  static const _accessTokenTTL = Duration(hours: 1);
  static const _refreshTokenTTL = Duration(days: 30);
  
  Future<String> getAccessToken() async {
    final token = await _store.getAccessToken();
    final expiresAt = await _store.getTokenExpiresAt();
    
    if (token == null || expiresAt == null || DateTime.now().isAfter(expiresAt)) {
      // Token 过期或不存在，尝试刷新
      return await _refreshToken();
    }
    
    return token;
  }
  
  Future<String> _refreshToken() async {
    final refreshToken = await _store.getRefreshToken();
    if (refreshToken == null) {
      // 没有 Refresh Token，需要重新登录
      throw AuthenticationException('No refresh token');
    }
    
    final response = await _client.refreshAccessToken(refreshToken);
    await _store.saveAccessToken(response.accessToken, response.expiresAt);
    
    return response.accessToken;
  }
}
```

**优势**：
- Access Token 短生命周期，泄露影响小
- Refresh Token 自动轮换，用户体验好
- 支持 Token 撤销（服务端黑名单）

#### 方案 4：设备绑定
**目标**：限制 Token 使用范围，防止多设备滥用

**设计**：
```typescript
// gateway/src/mobile/device-binding.ts
interface DeviceBinding {
  deviceId: string;
  apiTokenHash: string;
  platform: string;
  createdAt: Date;
  lastSeen: Date;
  maxDevices: number;
}

class DeviceBindingService {
  async bindDevice(deviceId: string, apiToken: string, platform: string): Promise<boolean> {
    const tokenHash = hashToken(apiToken);
    const existing = await this.getDevicesByTokenHash(tokenHash);
    
    // 检查设备数量限制
    if (existing.length >= MAX_DEVICES_PER_TOKEN) {
      // 移除最旧的设备
      const oldest = existing.sort((a, b) => a.createdAt - b.createdAt)[0];
      await this.removeDevice(oldest.deviceId);
    }
    
    // 绑定新设备
    await this.saveDevice({
      deviceId,
      apiTokenHash: tokenHash,
      platform,
      createdAt: new Date(),
      lastSeen: new Date(),
    });
    
    return true;
  }
  
  async validateDevice(deviceId: string, apiToken: string): Promise<boolean> {
    const tokenHash = hashToken(apiToken);
    const device = await this.getDevice(deviceId);
    
    return device?.apiTokenHash === tokenHash;
  }
}
```

**优势**：
- 限制每个 Token 的设备数量
- 设备绑定到 Token，防止滥用
- 支持设备撤销（远程注销）

### 3.3 性能优化

#### 方案 5：消息分页加载
**目标**：减少单次加载量，提高响应速度

**设计**：
```dart
class PaginatedMessageLoader {
  final GatewayClient _client;
  
  // 分页状态
  String? _oldestMessageId;
  bool _hasMore = true;
  bool _isLoading = false;
  
  Future<List<MafwMessage>> loadMore(String sessionID, {int limit = 20}) async {
    if (_isLoading || !_hasMore) return [];
    
    _isLoading = true;
    try {
      final messages = await _client.messages(
        sessionID,
        limit: limit,
        before: _oldestMessageId, // 新增参数：加载此消息之前的消息
      );
      
      if (messages.isEmpty) {
        _hasMore = false;
      } else {
        _oldestMessageId = messages.first.id;
      }
      
      return messages;
    } finally {
      _isLoading = false;
    }
  }
  
  void reset() {
    _oldestMessageId = null;
    _hasMore = true;
    _isLoading = false;
  }
}
```

**优势**：
- 按需加载，减少初始加载时间
- 支持无限滚动，用户体验好
- 减少流量消耗

#### 方案 6：本地消息缓存
**目标**：减少网络请求，支持离线查看

**设计**：
```dart
class MessageCache {
  final Hive _hive;
  static const _boxName = 'messages';
  static const _maxMessagesPerSession = 200;
  static const _cacheTTL = Duration(days: 7);
  
  Future<List<MafwMessage>> getMessages(String sessionID) async {
    final box = await _hive.openBox(_boxName);
    final cached = box.get(sessionID) as List?;
    
    if (cached == null) return [];
    
    // 过滤过期消息
    final now = DateTime.now();
    return cached
        .map((e) => MafwMessage.fromJson(e))
        .where((m) => now.difference(m.createdAt) < _cacheTTL)
        .toList();
  }
  
  Future<void> cacheMessages(String sessionID, List<MafwMessage> messages) async {
    final box = await _hive.openBox(_boxName);
    
    // 合并现有缓存
    final existing = await getMessages(sessionID);
    final merged = [...messages, ...existing];
    
    // 去重并限制数量
    final unique = merged.fold<List<MafwMessage>>([], (acc, msg) {
      if (!acc.any((m) => m.id == msg.id)) {
        acc.add(msg);
      }
      return acc;
    });
    
    final limited = unique.take(_maxMessagesPerSession).toList();
    await box.put(sessionID, limited.map((m) => m.toJson()).toList());
  }
}
```

**优势**：
- 离线查看历史消息
- 减少网络请求，节省流量
- 支持消息搜索（本地）

### 3.4 发现机制优化

#### 方案 7：自动发现 Gateway
**目标**：零配置连接，降低用户门槛

**设计**：
```dart
class GatewayDiscovery {
  final MdnsDiscovery _mdns;
  final TailscaleDiscovery _tailscale;
  
  Future<List<GatewayInfo>> discover() async {
    final results = <GatewayInfo>[];
    
    // 1. mDNS 发现（局域网）
    try {
      final mdnsResults = await _mdns.discover(
        serviceType: '_mafw._tcp',
        timeout: Duration(seconds: 3),
      );
      results.addAll(mdnsResults);
    } catch (_) {}
    
    // 2. Tailscale 网络发现
    try {
      final tailscaleResults = await _tailscale.discover();
      results.addAll(tailscaleResults);
    } catch (_) {}
    
    // 3. 最近连接记录
    final recent = await _getRecentConnections();
    results.addAll(recent);
    
    return results;
  }
}

class GatewayInfo {
  final String url;
  final String? name;
  final DiscoverySource source;
  final int signalStrength; // 0-100
  final DateTime lastSeen;
}

enum DiscoverySource {
  mdns,
  tailscale,
  recent,
  manual,
}
```

**优势**：
- 自动发现局域网 Gateway
- 支持 Tailscale 远程发现
- 显示信号强度，帮助用户选择

### 3.5 错误处理优化

#### 方案 8：结构化错误处理
**目标**：提供用户友好的错误信息，支持自我修复

**设计**：
```dart
class StructuredErrorHandler {
  static MafwError handleError(dynamic error) {
    if (error is GatewayException) {
      return _handleGatewayError(error);
    } else if (error is SocketException) {
      return _handleNetworkError(error);
    } else if (error is TimeoutException) {
      return _handleTimeoutError(error);
    } else {
      return MafwError(
        type: ErrorType.unknown,
        message: '未知错误: ${error.toString()}',
        suggestion: '请稍后重试或联系支持',
        retryable: true,
      );
    }
  }
  
  static MafwError _handleGatewayError(GatewayException error) {
    if (error.message.contains('401')) {
      return MafwError(
        type: ErrorType.authentication,
        message: '认证失败',
        suggestion: '请检查 API Token 是否正确，或重新配对',
        retryable: false,
        action: ErrorAction.reauthenticate,
      );
    } else if (error.message.contains('403')) {
      return MafwError(
        type: ErrorType.authorization,
        message: '权限不足',
        suggestion: '请检查 Token 权限或联系管理员',
        retryable: false,
      );
    } else if (error.message.contains('500')) {
      return MafwError(
        type: ErrorType.server,
        message: '服务器错误',
        suggestion: '请稍后重试，或检查 Gateway 日志',
        retryable: true,
      );
    }
    // ... 其他错误处理
  }
}

class MafwError {
  final ErrorType type;
  final String message;
  final String suggestion;
  final bool retryable;
  final ErrorAction? action;
}

enum ErrorType {
  network,
  authentication,
  authorization,
  server,
  validation,
  unknown,
}

enum ErrorAction {
  retry,
  reconfigure,
  reauthenticate,
  contactSupport,
}
```

**优势**：
- 错误分类，便于处理
- 用户友好的错误提示
- 支持自动修复建议

### 3.6 测试覆盖优化

#### 方案 9：完善单元测试
**目标**：提高代码质量，降低重构风险

**设计**：
```dart
// test/network/ws_client_test.dart
void main() {
  group('WsClient', () {
    late WsClient client;
    late MockWebSocketChannel mockChannel;
    
    setUp(() {
      mockChannel = MockWebSocketChannel();
      client = WsClient(
        config: ConnectionConfig(baseUrl: 'ws://localhost', apiToken: 'test'),
        channelFactory: (_) => mockChannel,
      );
    });
    
    test('reconnects on disconnect', () async {
      // 模拟断开连接
      mockChannel.simulateDisconnect();
      
      // 等待重连
      await Future.delayed(Duration(seconds: 2));
      
      // 验证重连成功
      expect(client.isConnected, isTrue);
    });
    
    test('exponential backoff on failure', () async {
      // 模拟连接失败
      mockChannel.simulateFailure();
      
      // 测试退避时间
      final delays = await client.measureReconnectDelays(attempts: 5);
      
      // 验证退避时间递增
      expect(delays[1] > delays[0], isTrue);
      expect(delays[2] > delays[1], isTrue);
    });
    
    test('resets backoff after success', () async {
      // 连续失败几次
      for (var i = 0; i < 3; i++) {
        mockChannel.simulateFailure();
        await Future.delayed(Duration(seconds: 1));
      }
      
      // 成功连接
      mockChannel.simulateSuccess();
      await Future.delayed(Duration(seconds: 1));
      
      // 再次失败，应该重置退避
      final delay = await client.measureNextDelay();
      expect(delay, Duration(seconds: 1)); // 重置为初始值
    });
  });
}
```

**测试覆盖目标**：
- WebSocket 客户端：90%
- Gateway 客户端：85%
- 网络切换处理：80%
- 认证流程：90%

---

## 第四部分：实施路线图

### Phase 1：基础优化（2 周）
1. ✅ 智能重连策略（方案 1）
2. ✅ 结构化错误处理（方案 8）
3. ✅ 消息分页加载（方案 5）

### Phase 2：安全增强（3 周）
4. ✅ 短生命周期 Token（方案 3）
5. ✅ 设备绑定（方案 4）
6. ✅ 配对安全加固

### Phase 3：性能优化（2 周）
7. ✅ 本地消息缓存（方案 6）
8. ✅ 媒体上传优化（分片上传）
9. ✅ 单元测试完善（方案 9）

### Phase 4：体验提升（3 周）
10. ✅ 自动发现 Gateway（方案 7）
11. ✅ 双通道保活（方案 2）
12. ✅ 离线模式支持

---

## 第五部分：成功指标

### 5.1 连接稳定性
- WebSocket 连接成功率：>99%
- 断线重连时间：<5s（平均）
- 后台保活率：>95%

### 5.2 安全性
- Token 泄露影响：最小化（短生命周期）
- 多设备滥用：阻止（设备绑定）
- 配对安全：端到端加密（未来）

### 5.3 性能
- 消息加载时间：<500ms（首次）
- 媒体上传成功率：>98%
- 离线可用性：历史消息 7 天

### 5.4 用户体验
- 首次连接时间：<30s
- 错误自修复率：>60%
- 测试覆盖率：>85%

---

## 附录：相关文件索引

### 移动端
- `mobile/lib/main.dart` - 应用入口，状态管理
- `mobile/lib/src/network/gateway_client.dart` - HTTP 客户端
- `mobile/lib/src/network/ws_client.dart` - WebSocket 客户端
- `mobile/lib/src/config/connection_config.dart` - 连接配置
- `mobile/lib/src/services/lifecycle_ws.dart` - 生命周期管理
- `mobile/lib/src/services/push_service.dart` - 推送服务
- `mobile/lib/src/services/connectivity_watcher.dart` - 网络监听

### Gateway 端
- `gateway/src/index.ts` - 主入口，HTTP 路由
- `gateway/src/mobile/pairing.ts` - 配对服务
- `gateway/src/mobile/push-gateway.ts` - 推送网关
- `gateway/src/mobile/device-store.ts` - 设备存储

### 测试
- `mobile/test/` - 移动端测试
- `tests/unit/gateway/` - Gateway 单元测试