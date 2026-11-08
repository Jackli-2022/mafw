/// 重连信号（Task 5 扩展，final fix wave Finding 1）。
///
/// Gateway 不重放断线期间错过的 WS 事件，所以每一次**成功重握手**都必须让所有
/// 持有实时视图的页面自己重拉数据。`WsClientV2.onReconnected` 只有一个回调位，
/// 而消费者有多个（工作 tab 刷新总线 + 已打开的 Goal 详情 / Tech Lead 讨论 /
/// Chat），因此把重连收敛成一个可多订阅的信号：
///
/// - `main.dart` 在 `onReconnected` 里调用 [onReconnected]（同时转发给
///   [WorkRefreshBus]）；
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

  /// WS 重连成功：断线期间的事件不会重放，订阅方必须重拉数据。
  void onReconnected() {
    _revision += 1;
    notifyListeners();
  }
}
