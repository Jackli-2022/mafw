/// 工作面刷新总线（Task 7）。
///
/// 工作 tab 的数据来自 HTTP（`work.overview` / `presence`），但「什么时候该
/// 重拉」由 WS 决定。总线把三个可测的触发点收敛成一个信号：
///
/// 1. **15s 轮询** —— 订阅方自己发起的权威全量刷新（兜底，spec §7.3）；
/// 2. **重连** —— `WsClientV2.onReconnected`（断线期间的事件不会重放，
///    所以必须重拉，见 Task 5）；
/// 3. **事件** —— [onEvent] 只放行 [shouldRefreshWork] 命中的帧
///    （`pod.updated` / `pod.event` / `run.updated` + flat `goal_node` /
///    `phase_transition` / `state_change` / `user_question`）。
///
/// 携带 `goalId` 的事件让订阅方做**局部更新**（只替换该 Goal 的卡片），其余
/// 触发走整份快照。事件是**单次使用**的：[consumeEvent] 取走即清空——保留旧
/// 事件会让兜底轮询永远读到同一个 goalId，把全量刷新退化成局部 patch
/// （Task 7 review 的 Important 回归）。
library;

import 'package:flutter/foundation.dart';

import '../models/event_effects.dart';
import '../models/mafw_models.dart';

class WorkRefreshBus extends ChangeNotifier {
  MafwEvent? _pendingEvent;
  int _revision = 0;

  /// 单调递增的触发计数（测试与诊断用）。
  int get revision => _revision;

  /// 请求一次工作面刷新。[event] 非空时订阅方可按 `goalId` 局部更新。
  void refreshWork([MafwEvent? event]) {
    _pendingEvent = event;
    _revision += 1;
    notifyListeners();
  }

  /// 取走本次刷新携带的事件（消费语义：调用后总线不再保留它）。
  ///
  /// 事件只服务**紧接着的一次**刷新。订阅方必须在处理信号时取走，否则下一次
  /// 兜底轮询会把它当成新事件重复使用。
  MafwEvent? consumeEvent() {
    final event = _pendingEvent;
    _pendingEvent = null;
    return event;
  }

  /// WS 重连成功：断线期间的事件不会重放，必须重拉数据。
  void onReconnected() => refreshWork();

  /// WS 事件入口：只有会改变工作面的帧才触发刷新（其余静默丢弃）。
  void onEvent(MafwEvent event) {
    if (shouldRefreshWork(event)) refreshWork(event);
  }
}
