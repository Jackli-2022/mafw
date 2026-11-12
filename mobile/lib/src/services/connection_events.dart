/// 重连信号（Task 5 扩展，final fix wave Finding 1；E5b-3 起由
/// `RecoveryCoordinator` 驱动）。
///
/// E5b 起断线期间的事件会先经 `GET /api/events/replay` 按 `seq` 补齐，因此本信号
/// 表达的是「replay 已完成，页面该做 REST 对账」：`part.delta` 与部分状态帧从不
/// 重放，工作 tab / Goal 详情 / Tech Lead 讨论 / Chat 仍必须重拉数据。
/// `WsClientV2.onGatewayReady` 每个 `connected` greeting 触发一次；配置它之后旧的
/// `onReconnected` 钩子被抑制（`main.dart` 不再使用），避免恢复跑两遍。
/// 消费者有多个，因此把重连收敛成一个可多订阅的信号：
///
/// - `main.dart` 经 `RecoveryCoordinator` 在 replay 之后调用 [onReconnected]
///   （同时转发给 [WorkRefreshBus]）；
/// - 每个页面在 `initState` 订阅、`dispose` 取消，收到信号后**静默重载**
///   （保留旧数据、不清屏、不重新进入 loading）。
///
/// 用 [ChangeNotifier] 而不是单订阅 `Stream`：多消费者是常态，且页面可以在
/// 任意时刻挂载/卸载而不影响其它消费者。
library;

import 'package:flutter/foundation.dart';

class ConnectionEvents extends ChangeNotifier {
  int _revision = 0;

  /// 单调递增的重连计数（测试与诊断用）。
  int get revision => _revision;

  /// WS 重连成功（E5b replay 补页之后）：seq 缺失的瞬态帧不会重放，订阅方仍须
  /// 重拉数据。
  void onReconnected() {
    _revision += 1;
    notifyListeners();
  }
}
