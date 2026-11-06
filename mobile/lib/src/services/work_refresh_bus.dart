/// 工作面刷新总线（Task 7）。
///
/// 工作 tab 的数据来自 HTTP（`work.overview` / `presence`），但「什么时候该
/// 重拉」由 WS 决定。总线把三个可测的触发点收敛成一个信号：
///
/// 1. **15s 轮询** —— 直接调用 [refreshWork]（兜底，spec §7.3）；
/// 2. **重连** —— `WsClientV2.onReconnected`（断线期间的事件不会重放，
///    所以必须重拉，见 Task 5）；
/// 3. **事件** —— [onEvent] 只放行 [shouldRefreshWork] 命中的帧
///    （`pod.updated` / `pod.event` / `run.updated` + flat `goal_node` /
///    `phase_transition` / `state_change` / `user_question`）。
///
/// 携带 `goalId` 的事件会让订阅方做**局部更新**（只替换该 Goal 的卡片），
/// 其余事件走整份快照。总线本身不发起请求、不持有 UI 状态，纯信号。
library;

import 'package:flutter/foundation.dart';

import '../models/event_effects.dart';
import '../models/mafw_models.dart';

class WorkRefreshBus extends ChangeNotifier {
  MafwEvent? _lastEvent;
  int _revision = 0;

  /// 最近一次触发刷新的事件（轮询/重连触发时为 `null`）。
  MafwEvent? get lastEvent => _lastEvent;

  /// 单调递增的触发计数（测试与诊断用）。
  int get revision => _revision;

  /// 请求一次工作面刷新。[event] 非空时订阅方可按 `goalId` 局部更新。
  void refreshWork([MafwEvent? event]) {
    _lastEvent = event;
    _revision += 1;
    notifyListeners();
  }

  /// WS 重连成功：断线期间的事件不会重放，必须重拉数据。
  void onReconnected() => refreshWork();

  /// WS 事件入口：只有会改变工作面的帧才触发刷新（其余静默丢弃）。
  void onEvent(MafwEvent event) {
    if (shouldRefreshWork(event)) refreshWork(event);
  }
}
