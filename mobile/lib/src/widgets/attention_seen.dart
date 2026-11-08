/// 「需要你」表单完成后的 Pod 事件已读回写（best-effort）。
///
/// 设计约束（Task 13）：
/// - 完成动作后尽量把工作角标抹掉：`GET /api/pods/:podId/events`（默认 unread）
///   里按 **goalId + revision**（可选 **kind** 精确匹配）找条目 →
///   `POST /api/pods/:podId/events/:id/seen`；
/// - **绝不阻塞主流程**：没有 Pod、找不到条目、网络失败都静默返回；角标会在
///   下一次 presence 轮询/下拉刷新时恢复（服务端仍是权威）；
/// - attention 条目若自带 `eventId`（新网关），优先直接按 id 回写，不再列表。
///
/// 为什么不是「按 attention kind 匹配」：Pod 事件只有 `goal.result` /
/// `goal.ended` / `member.*` 这几类（`pod-event-model.ts`），attention kind
/// （`plan_approval` / `direction_review` / `question`）不是事件 kind。表单完成
/// 说明用户已经处理了同一个 Goal 的那个 revision，因此按 (goalId, revision)
/// 找到的未读 Goal 事件就是该被抹掉的那条；需要更精确时由调用方传 [kind]。
library;

import '../network/gateway_client.dart';

Future<void> markAttentionSeen(
  GatewayClient client, {
  String? podId,
  String? eventId,
  required String goalId,
  int? revision,
  String? kind,
}) async {
  final pod = (podId ?? '').trim();
  if (pod.isEmpty || goalId.trim().isEmpty) return;

  try {
    final direct = (eventId ?? '').trim();
    if (direct.isNotEmpty) {
      await client.markPodEventSeen(pod, direct);
      return;
    }

    final events = await client.podEvents(pod);
    final wantedKind = (kind ?? '').trim();
    for (final event in events) {
      if (event.goalId != goalId) continue;
      if (revision != null && event.revision != null && event.revision != revision) {
        continue;
      }
      if (wantedKind.isNotEmpty && event.kind != wantedKind) continue;
      await client.markPodEventSeen(pod, event.id);
      return;
    }
  } catch (_) {
    // Best-effort：角标回写失败不影响已经成功的表单动作。
  }
}
