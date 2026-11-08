/// Orcalore mobile Task 15: 交给 Lead（handoff）。
///
/// A free discussion (`聊天` tab) can be explicitly promoted into a Pod Goal by
/// handing it to the Lead. The text snapshot is the **immutable** source of the
/// Goal (`GoalSourceRef.snapshot`), so this module mirrors the desktop contract
/// (`packages/desktop/src/renderer/mafw/lead-handoff.ts:46-70`):
///
/// - snapshot = last user text + the assistant text that followed it
///   (tool output never enters — [MafwMessage.text] only carries text parts);
/// - snapshot is capped at 4000 chars, title at 80;
/// - the request body is `{title, objective, sourceRef:{sessionID, snapshot,
///   capturedAt}}` posted to `POST /api/pods/:podId/goals/handoff`
///   (`gateway/src/routes/pods.ts:314-365`);
/// - a project without a Pod is created first (`podEnsure`) — the Lead handoff
///   must work for a project that has never run a Goal;
/// - the response `goalId` is handed back so the caller can open the Goal.
///
/// Failures never go silent: each stage maps to an actionable message
/// ([leadHandoffErrorMessage]) that separates「创建鲸群失败」/「网关版本过旧」/
/// 网络错误 from the server's own words.
library;

import 'dart:convert';

import '../models/mafw_models.dart';
import '../models/pod_models.dart';
import '../network/gateway_client.dart';

/// Snapshot cap (mirrors `GOAL_SOURCE_SNAPSHOT_MAX` on the gateway).
const int kLeadHandoffSnapshotLimit = 4000;

/// Title cap (desktop `TITLE_LIMIT`).
const int kLeadHandoffTitleLimit = 80;

/// How many recent messages the handoff reads.
const int kLeadHandoffMessageLimit = 100;

final RegExp _sessionIDPattern = RegExp(r'\bses_[A-Za-z0-9_-]+\b');
final RegExp _whitespaceRun = RegExp(r'\s+');
final RegExp _lineBreak = RegExp(r'\r?\n');
final RegExp _markdownHeading = RegExp(r'^#+\s*');

/// The immutable excerpt captured at handoff time (`GoalSourceRef`).
class HandoffSourceRef {
  final String sessionID;
  final String snapshot;
  final String capturedAt;

  const HandoffSourceRef({
    required this.sessionID,
    required this.snapshot,
    required this.capturedAt,
  });

  Map<String, dynamic> toJson() => <String, dynamic>{
        // The gateway trims + rejects an empty snapshot; keep the shape minimal
        // (desktop also omits messageID unless one specific message is quoted).
        if (sessionID.isNotEmpty) 'sessionID': sessionID,
        'snapshot': snapshot,
        'capturedAt': capturedAt,
      };
}

/// What the handoff route needs to create a discussion Goal.
class HandoffInput {
  final String title;
  final String objective;
  final HandoffSourceRef sourceRef;

  const HandoffInput({
    required this.title,
    required this.objective,
    required this.sourceRef,
  });

  Map<String, dynamic> toJson() => <String, dynamic>{
        'title': title,
        'objective': objective,
        'sourceRef': sourceRef.toJson(),
      };
}

/// `POST /api/pods/:podId/goals/handoff` response (only the fields the mobile
/// flow consumes; `status` is the revision status, e.g. `discussing`).
class HandoffGoalResult {
  final String podId;
  final String goalId;
  final int? revision;
  final String? sessionID;
  final String status;
  final String? sessionError;

  const HandoffGoalResult({
    required this.podId,
    required this.goalId,
    required this.revision,
    required this.sessionID,
    required this.status,
    required this.sessionError,
  });

  factory HandoffGoalResult.fromJson(String fallbackPodId, Map<String, dynamic> j) {
    final rawRevision = j['revision'];
    final rawSession = j['sessionID'] ?? j['sessionId'];
    return HandoffGoalResult(
      podId: (j['podId'] ?? fallbackPodId).toString(),
      goalId: (j['goalId'] ?? '').toString(),
      revision: rawRevision is num ? rawRevision.toInt() : null,
      sessionID: rawSession?.toString(),
      status: (j['status'] ?? '').toString(),
      sessionError: j['sessionError']?.toString(),
    );
  }
}

/// A handoff step failed with a message that is already user-readable.
class LeadHandoffException implements Exception {
  final String message;

  const LeadHandoffException(this.message);

  @override
  String toString() => message;
}

/// Builds the handoff payload from a session history page.
///
/// Returns `null` when there is nothing to hand off (no message text at all).
/// [sessionID] defaults to the id carried by the messages; [sessionTitle] is a
/// fallback when the first line strips down to nothing (mirrors desktop
/// `deriveTitle`); [now] keeps `capturedAt` testable.
HandoffInput? buildLeadHandoff(
  List<MafwMessage> history, {
  String? sessionID,
  String? sessionTitle,
  DateTime? now,
}) {
  final sid = (sessionID ?? _historySessionID(history)).trim();
  if (sid.isEmpty) return null;

  final source = _handoffSource(history);
  if (source.isEmpty) return null;

  final snapshot = _clipSnapshot(source);
  return HandoffInput(
    title: _deriveTitle(source, sessionTitle ?? ''),
    objective: snapshot,
    sourceRef: HandoffSourceRef(
      sessionID: sid,
      snapshot: snapshot,
      capturedAt: (now ?? DateTime.now()).toUtc().toIso8601String(),
    ),
  );
}

String _historySessionID(List<MafwMessage> history) {
  for (final message in history) {
    final id = message.sessionID.trim();
    if (id.isNotEmpty) return id;
  }
  return '';
}

/// Last user text + the assistant text that followed it (chronological, joined
/// with a blank line). When the session has no user message at all, the last
/// assistant text is the honest fallback. Tool-only messages contribute nothing.
String _handoffSource(List<MafwMessage> history) {
  String textOf(MafwMessage message) =>
      (message.text ?? '').replaceAll('\r\n', '\n').trim();

  var lastUser = -1;
  for (var i = history.length - 1; i >= 0; i--) {
    final message = history[i];
    if (message.role == 'user' && textOf(message).isNotEmpty) {
      lastUser = i;
      break;
    }
  }

  final parts = <String>[];
  if (lastUser >= 0) {
    parts.add(textOf(history[lastUser]));
    for (var i = lastUser + 1; i < history.length; i++) {
      final message = history[i];
      if (message.role != 'assistant') continue;
      final text = textOf(message);
      if (text.isNotEmpty) parts.add(text);
    }
  } else {
    for (var i = history.length - 1; i >= 0; i--) {
      final message = history[i];
      if (message.role != 'assistant') continue;
      final text = textOf(message);
      if (text.isNotEmpty) {
        parts.add(text);
        break;
      }
    }
  }
  return parts.join('\n\n').trim();
}

/// First non-empty line → strip Markdown heading → strip session ids →
/// fall back to the session title → `未命名讨论`; collapse whitespace; cap 80.
String _deriveTitle(String source, String sessionTitle) {
  final first = source
      .split(_lineBreak)
      .map((line) => line.trim())
      .firstWhere((line) => line.isNotEmpty, orElse: () => '');
  final fromSource = _stripSessionIDs(first.replaceFirst(_markdownHeading, '').trim());
  final fallback = _stripSessionIDs(sessionTitle.trim());
  final derived = fromSource.isNotEmpty
      ? fromSource
      : (fallback.isNotEmpty ? fallback : '未命名讨论');
  return _clipTitle(derived.replaceAll(_whitespaceRun, ' ').trim());
}

String _stripSessionIDs(String value) =>
    value.replaceAll(_sessionIDPattern, '').trim();

bool _isHighSurrogate(int unit) => unit >= 0xD800 && unit <= 0xDBFF;

String _clipSnapshot(String source) {
  if (source.length <= kLeadHandoffSnapshotLimit) return source;
  var end = kLeadHandoffSnapshotLimit;
  // Never split a surrogate pair — the gateway stores the snapshot verbatim.
  if (_isHighSurrogate(source.codeUnitAt(end - 1))) end -= 1;
  return source.substring(0, end);
}

String _clipTitle(String title) {
  if (title.length <= kLeadHandoffTitleLimit) return title;
  var end = kLeadHandoffTitleLimit - 1;
  if (_isHighSurrogate(title.codeUnitAt(end - 1))) end -= 1;
  return '${title.substring(0, end)}…';
}

/// Hands a session over to the Lead.
///
/// Flow: read the last [kLeadHandoffMessageLimit] messages → build the payload →
/// resolve the project Pod (creating it when missing) → POST the handoff.
///
/// Every transport step rethrows a [LeadHandoffException] with the stage in the
/// message, so the UI can show an actionable line instead of a stack trace.
class LeadHandoffService {
  final GatewayClient client;

  const LeadHandoffService(this.client);

  Future<HandoffGoalResult> handoff(
    String sessionID, {
    required String projectDir,
    String? sessionTitle,
  }) async {
    final dir = projectDir.trim();
    if (dir.isEmpty) {
      throw const LeadHandoffException('无法确定会话所属项目，请先在「工作」tab 选择项目');
    }

    final history = await _readHistory(sessionID);
    final input = buildLeadHandoff(
      history,
      sessionID: sessionID,
      sessionTitle: sessionTitle,
    );
    if (input == null) {
      throw const LeadHandoffException('这个会话还没有可交接的对话内容');
    }

    final pod = await _resolvePod(dir);
    return handoffGoal(pod.id, input);
  }

  /// POSTs one handoff payload (`POST /api/pods/:podId/goals/handoff`).
  Future<HandoffGoalResult> handoffGoal(String podId, HandoffInput input) async {
    final id = podId.trim();
    if (id.isEmpty) {
      throw const LeadHandoffException('交给 Lead 失败：缺少 Pod id');
    }

    Map<String, dynamic> json;
    try {
      json = await client.goalHandoff(
        id,
        title: input.title,
        objective: input.objective,
        sourceRef: input.sourceRef.toJson(),
      );
    } on GatewayRouteMissingException {
      throw const LeadHandoffException(
        '网关版本过旧：缺少「交给 Lead」的路由，请升级 gateway 后重试',
      );
    } on GatewayException catch (e) {
      // A plain 404 without a route payload is an old gateway, exactly like
      // `_ensureNotFound` / `_notFound` in GatewayClient.
      if (e.statusCode == 404 && (e.errorBody ?? '').trim().isEmpty) {
        throw const LeadHandoffException(
          '网关版本过旧：缺少「交给 Lead」的路由，请升级 gateway 后重试',
        );
      }
      throw LeadHandoffException('交给 Lead 失败：${_messageOf(e)}');
    }

    final result = HandoffGoalResult.fromJson(id, json);
    if (result.goalId.isEmpty) {
      throw const LeadHandoffException('交给 Lead 失败：网关没有返回 Goal id');
    }
    return result;
  }

  Future<List<MafwMessage>> _readHistory(String sessionID) async {
    try {
      return await client.messages(sessionID, limit: kLeadHandoffMessageLimit);
    } on GatewayRouteMissingException {
      throw const LeadHandoffException(
        '网关版本过旧：缺少会话历史路由，请升级 gateway 后重试',
      );
    } catch (e) {
      throw LeadHandoffException('读取会话历史失败：${_messageOf(e)}');
    }
  }

  Future<PodInfo> _resolvePod(String projectDir) async {
    PodInfo? pod;
    try {
      pod = await client.podLookup(projectDir);
    } on GatewayRouteMissingException {
      throw const LeadHandoffException(
        '网关版本过旧：缺少鲸群路由，请升级 gateway 后重试',
      );
    } catch (e) {
      throw LeadHandoffException('读取项目失败：${_messageOf(e)}');
    }

    if (pod != null) {
      if (pod.id.trim().isEmpty) {
        throw const LeadHandoffException('读取项目失败：网关没有返回 Pod id');
      }
      return pod;
    }

    try {
      pod = await client.podEnsure(projectDir);
    } on GatewayRouteMissingException {
      throw const LeadHandoffException(
        '网关版本过旧：缺少创建鲸群的路由，请升级 gateway 后重试',
      );
    } catch (e) {
      throw LeadHandoffException('创建鲸群失败：${_messageOf(e)}');
    }
    if (pod.id.trim().isEmpty) {
      throw const LeadHandoffException('创建鲸群失败：网关没有返回 Pod id');
    }
    return pod;
  }
}

/// One actionable sentence for a failed handoff.
String leadHandoffErrorMessage(Object error) {
  if (error is LeadHandoffException) return error.message;
  if (error is GatewayRouteMissingException) {
    return '网关版本过旧：缺少「交给 Lead」的路由，请升级 gateway 后重试';
  }
  if (error is GatewayException) {
    if (error.statusCode == 404) {
      return '网关版本过旧：缺少「交给 Lead」的路由，请升级 gateway 后重试';
    }
    return _messageOf(error);
  }
  return '网络错误：$error';
}

/// Prefers the gateway's own `{"error": "..."}` body, then the exception message.
String _messageOf(Object error) {
  if (error is GatewayException) {
    final body = (error.errorBody ?? '').trim();
    if (body.isNotEmpty) {
      try {
        final decoded = jsonDecode(body);
        if (decoded is Map<String, dynamic>) {
          final message = decoded['error'];
          if (message is String && message.trim().isNotEmpty) {
            return message.trim();
          }
        }
      } catch (_) {
        // Non-JSON body (HTML/plain text): never paste it into the UI.
      }
    }
    return error.message;
  }
  return error.toString();
}
