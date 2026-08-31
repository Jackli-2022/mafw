# 快速参考：Android App 优化

## 🚨 最紧急的 3 个问题

### 1. WebSocket 重连风暴
**问题**：断线后无限重试，消耗电量
**解决**：智能重连策略（最多 10 次，指数退避）
**文件**：`mobile/lib/src/network/ws_client.dart`

### 2. Token 安全风险
**问题**：Token 明文传输，长期有效
**解决**：短生命周期 Token（1h）+ 自动轮换
**文件**：`mobile/lib/src/config/connection_config.dart`

### 3. 消息加载慢
**问题**：每次加载 50 条，无缓存
**解决**：分页加载 + 本地缓存
**文件**：`mobile/lib/src/network/gateway_client.dart`

---

## 📋 实施检查清单

### Phase 1（2 周）
- [ ] 创建 `SmartReconnectManager` 类
- [ ] 实现 `StructuredErrorHandler`
- [ ] 添加消息分页参数 `before`
- [ ] 编写 WebSocket 客户端测试
- [ ] 更新错误处理逻辑

### Phase 2（3 周）
- [ ] 设计 Token 刷新流程
- [ ] 实现 `TokenManager`
- [ ] 添加设备绑定 API
- [ ] 更新配对安全逻辑
- [ ] 编写认证流程测试

### Phase 3（2 周）
- [ ] 实现 `MessageCache`
- [ ] 添加分片上传支持
- [ ] 完善单元测试
- [ ] 性能基准测试
- [ ] 文档更新

### Phase 4（3 周）
- [ ] 集成 mDNS 发现
- [ ] 实现双通道保活
- [ ] 添加离线模式
- [ ] 用户验收测试
- [ ] 发布准备

---

## 🔧 关键代码片段

### 智能重连（简化版）
```dart
class SmartReconnect {
  int _attempts = 0;
  static const _maxAttempts = 10;
  static const _baseDelays = [1, 2, 5, 10, 15, 30];
  
  Duration? nextDelay() {
    if (_attempts >= _maxAttempts) return null;
    final base = _baseDelays[_attempts.clamp(0, _baseDelays.length - 1)];
    final jitter = Random().nextDouble() * 1000;
    _attempts++;
    return Duration(seconds: base) + Duration(milliseconds: jitter.toInt());
  }
  
  void reset() => _attempts = 0;
}
```

### 错误处理（简化版）
```dart
enum ErrorType { network, auth, server, unknown }

class MafwError {
  final ErrorType type;
  final String message;
  final String suggestion;
  final bool retryable;
  
  const MafwError({
    required this.type,
    required this.message,
    required this.suggestion,
    this.retryable = true,
  });
}
```

### 消息分页（简化版）
```dart
Future<List<MafwMessage>> loadMessages(
  String sessionID, {
  int limit = 20,
  String? before, // 新增：加载此消息之前的消息
}) async {
  final params = {'limit': '$limit'};
  if (before != null) params['before'] = before;
  
  final res = await _http.get(
    _uri('/api/sessions/$sessionID/messages', params),
    headers: _headers,
  );
  // ... 解析响应
}
```

---

## 📊 性能基准

### 当前性能
- 首次消息加载：~2s
- WebSocket 重连：10-30s
- 后台保活：依赖 FCM
- 测试覆盖率：~40%

### 目标性能
- 首次消息加载：<500ms
- WebSocket 重连：<5s
- 后台保活：WebSocket + 心跳
- 测试覆盖率：>85%

---

## 🎯 成功标准

### 用户体验
- [ ] 连接成功率 >99%
- [ ] 断线感知时间 <1s
- [ ] 重连时间 <5s
- [ ] 错误提示友好

### 技术指标
- [ ] 单元测试覆盖率 >85%
- [ ] 代码审查通过率 100%
- [ ] 性能回归测试通过
- [ ] 安全审计通过

### 业务指标
- [ ] 用户投诉减少 50%
- [ ] 崩溃率降低 30%
- [ ] 电量消耗降低 20%
- [ ] 用户满意度提升

---

## 🚀 立即行动

### 今天
1. 阅读 `mobile/BRAINSTORMING.md` 完整方案
2. 选择 Phase 1 的一个方案开始
3. 创建开发分支 `feature/smart-reconnect`

### 本周
1. 实现智能重连策略
2. 编写单元测试
3. 代码审查

### 下周
1. 集成到现有代码
2. 性能测试
3. 准备 Phase 2 设计

---

## 📞 联系与资源

### 文档
- 完整方案：`mobile/BRAINSTORMING.md`
- 总结：`mobile/BRAINSTORMING_SUMMARY.md`
- 本文件：`mobile/QUICK_REFERENCE.md`

### 代码
- 移动端：`mobile/lib/`
- Gateway：`gateway/src/mobile/`
- 测试：`mobile/test/`

### 工具
- Flutter：`flutter test`
- 分析：`flutter analyze`
- 构建：`flutter build apk --debug`