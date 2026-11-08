/// Orcalore Tech Lead 讨论页（Task 12）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.6 —— Goal 详情「与 Tech Lead 讨论」→ 本页；终态回落只读 transcript。
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 12.
///
/// 数据面（全部按 gateway 路由实读）：
/// - `GET /api/pods/:podId/goals/:goalId/tech-lead?limit=50` → `{goalId,
///   revision, sessionID, messages}`（flat `MafwMessage[]`，与 chat 同构）。
///   `sessionID == null`（无存活租约）或 409（revision 已终态）都是
///   「讨论已归档」——不是错误。
/// - `GET /api/pods/:podId` → `sessions[]`：归档后按 `goalId +
///   scopeKind:'discussion'` 取最新 discussion 会话（`tech-lead` 的 409 没有
///   session id，只有这条路能拿到归档 transcript 的 id；桌面同路径）。
/// - `GET /api/pods/:podId/sessions/:sessionId/transcript` → `{transcript:
///   {sessionID, messages} | null}`，`null` = 没有快照（照实说，不伪造）。
///
/// 发送纪律（硬约束）：composer **text-only**，发送只经 [SendRouter] →
/// `POST .../tech-lead/messages`。**绝不** `sendEnriched` / `promptAsync`：
/// 那会丢 Tech Lead agent 绑定 + revision 的 ContextManifest。Tech Lead 身份
/// allowlist 里没有 `mafw_media_*`，所以 v1 不发附件（发图=没人能解的指针）。
///
/// 阶段指示复用 chat 的词表：`chatEventEffects`（`models/event_effects.dart`）
/// + 共享组件 `GenPhaseIndicator`（`widgets/chat_messages.dart`）。
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../models/event_effects.dart';
import '../models/mafw_models.dart';
import '../models/pod_models.dart';
import '../network/gateway_client.dart';
import '../services/send_router.dart';
import '../theme.dart';
import '../widgets/chat_messages.dart';

/// 归档讨论会话的选取（纯函数）：同一 Goal 的 discussion scope 里取
/// revision 最大 → generation 最大 → createdAt 最新的一条。
///
/// node 会话（execute/review/probe）与其它 Goal 的会话永不参与——读错会话会把
/// 实施记录当讨论记录展示给用户。
String? archivedDiscussionSessionId(
  Iterable<PodSessionInfo> sessions,
  String goalId,
) {
  PodSessionInfo? best;
  for (final session in sessions) {
    if (session.sessionId.isEmpty) continue;
    if (session.goalId != goalId) continue;
    if (!session.isDiscussion) continue;
    if (best == null || _newerDiscussionSession(session, best)) best = session;
  }
  return best?.sessionId;
}

bool _newerDiscussionSession(PodSessionInfo candidate, PodSessionInfo current) {
  final candidateRevision = candidate.revision ?? 0;
  final currentRevision = current.revision ?? 0;
  if (candidateRevision != currentRevision) {
    return candidateRevision > currentRevision;
  }
  if (candidate.generation != current.generation) {
    return candidate.generation > current.generation;
  }
  return candidate.createdAt.compareTo(current.createdAt) > 0;
}

/// One Goal 的 Tech Lead 讨论（历史 + 实时流 + text-only composer）。
class TechLeadDiscussionPage extends StatefulWidget {
  final String podId;
  final String goalId;
  final GatewayClient? client;

  /// Canonical WS event stream (the shell passes `ws.events`). Optional so the
  /// page can run without a socket (offline / tests).
  final Stream<MafwEvent>? messagesStream;

  const TechLeadDiscussionPage(
    this.podId,
    this.goalId, {
    super.key,
    this.client,
    this.messagesStream,
  });

  @override
  State<TechLeadDiscussionPage> createState() => _TechLeadDiscussionPageState();
}

class _TechLeadDiscussionPageState extends State<TechLeadDiscussionPage> {
  final _inputCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();

  List<MafwMessage> _messages = const <MafwMessage>[];
  bool _loading = true;
  String? _error;

  /// 活跃讨论会话 id；`null` = 归档（无存活租约 / 409）。
  String? _sessionID;
  bool _archived = false;

  /// 归档但读不到 transcript（没有 discussion 会话或快照为空）。
  bool _transcriptMissing = false;

  GenPhase _phase = GenPhase.idle;
  bool _sending = false;
  StreamSubscription<MafwEvent>? _sub;
  Timer? _refreshDebounce;

  /// 请求代际：重试/刷新时丢弃过期响应。
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _listen();
    unawaited(_load());
  }

  @override
  void dispose() {
    _sub?.cancel();
    _refreshDebounce?.cancel();
    _inputCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _listen() {
    final stream = widget.messagesStream;
    if (stream == null) return;
    _sub = stream.listen(_onEvent);
  }

  // ── 数据 ──

  Future<void> _load({bool silent = false}) async {
    final client = widget.client;
    final seq = ++_seq;
    if (client == null) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '未配置 Gateway';
      });
      return;
    }
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    final TechLeadHistory history;
    try {
      history = await client.openTechLead(widget.podId, widget.goalId);
    } catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _loading = false;
        if (_messages.isEmpty) _error = _serverMessage(e);
      });
      return;
    }
    if (!mounted || seq != _seq) return;

    if (!history.archived) {
      setState(() {
        _loading = false;
        _error = null;
        _archived = false;
        _transcriptMissing = false;
        _sessionID = history.sessionID;
        _messages = history.messages;
      });
      _jumpToBottom();
      return;
    }

    // 归档：取最新 discussion 会话的 transcript（只读）。
    final archived = await _loadArchivedTranscript(client);
    if (!mounted || seq != _seq) return;
    setState(() {
      _loading = false;
      _error = null;
      _archived = true;
      _sessionID = archived.sessionID;
      _messages = archived.messages;
      _transcriptMissing = archived.missing;
    });
    _jumpToBottom();
  }

  Future<_ArchivedTranscript> _loadArchivedTranscript(GatewayClient client) async {
    String? sessionID;
    try {
      final pod = await client.podDetail(widget.podId);
      sessionID = archivedDiscussionSessionId(pod.sessions, widget.goalId);
    } catch (_) {
      // Pod 详情是附加面：读不到就照实说「没有可读取的记录」。
      return const _ArchivedTranscript(sessionID: null, messages: <MafwMessage>[], missing: true);
    }
    if (sessionID == null) {
      return const _ArchivedTranscript(sessionID: null, messages: <MafwMessage>[], missing: true);
    }
    try {
      final messages = await client.podTranscript(widget.podId, sessionID);
      return _ArchivedTranscript(
        sessionID: sessionID,
        messages: messages,
        missing: messages.isEmpty,
      );
    } catch (_) {
      return _ArchivedTranscript(sessionID: sessionID, messages: const <MafwMessage>[], missing: true);
    }
  }

  void _onEvent(MafwEvent ev) {
    // Canonical envelopes only；legacy 帧不解包（与 chat 同规）。
    if (!ev.isCanonical) return;
    final sessionID = _sessionID;
    if (sessionID == null) return;
    if (ev.sessionID != null && ev.sessionID != sessionID) return;

    // 事件语义查表（`models/event_effects.dart`，与 chat 同源）。
    final effects = chatEventEffects(ev.innerType);
    if (effects.writing && _phase != GenPhase.writing) {
      setState(() => _phase = GenPhase.writing);
    } else if (effects.turnEnd && _phase != GenPhase.idle) {
      setState(() => _phase = GenPhase.idle);
    }

    if (effects.refresh) {
      _refreshDebounce?.cancel();
      _refreshDebounce = Timer(
        const Duration(milliseconds: 250),
        () => unawaited(_load(silent: true)),
      );
    }
  }

  // ── 发送 ──

  Future<void> _send() async {
    final client = widget.client;
    if (client == null || _archived) return;
    // 防连点：上一笔 HTTP 请求尚未落地时不再发第二条（与 chat_page 同规）。
    if (_sending) return;
    // 文本原样发送（client 不 trim：服务端 `text is required` 是唯一校验）。
    final text = _inputCtrl.text;
    if (text.trim().isEmpty) return;

    setState(() {
      _sending = true;
      _phase = GenPhase.searching;
      _messages = [
        ..._messages,
        MafwMessage(
          id: 'user-${DateTime.now().millisecondsSinceEpoch}',
          sessionID: _sessionID ?? '',
          role: 'user',
          text: text,
          timeCreated: DateTime.now().millisecondsSinceEpoch,
        ),
      ];
    });
    _inputCtrl.clear();
    _jumpToBottom();

    try {
      await SendRouter(client).send(
        SendView.techLead(podId: widget.podId, goalId: widget.goalId),
        text,
      );
      if (!mounted) return;
      // 成功则保持 searching，等 WS 事件驱动 writing/done。
      setState(() => _sending = false);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _phase = GenPhase.idle;
      });
      _snack('发送失败: ${_serverMessage(e)}');
    }
  }

  void _jumpToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollCtrl.hasClients) return;
      _scrollCtrl.jumpTo(_scrollCtrl.position.maxScrollExtent);
    });
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(message),
        duration: const Duration(seconds: 2),
      ));
  }

  /// 优先展示服务端的 `{error}` 文案（`tech lead discussion unavailable` 等）。
  String _serverMessage(Object error) {
    if (error is GatewayException) {
      final body = error.errorBody;
      if (body != null && body.isNotEmpty) {
        try {
          final decoded = jsonDecode(body);
          if (decoded is Map<String, dynamic>) {
            final text = decoded['error']?.toString() ?? '';
            if (text.isNotEmpty) return text;
          }
        } catch (_) {
          // 非 JSON 错误体：回退到 message。
        }
      }
      return error.message;
    }
    return error.toString();
  }

  // ── 渲染 ──

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Tech Lead', style: TextStyle(fontSize: 16)),
            Text('Goal 讨论', style: TextStyle(fontSize: 11, color: MafwPalette.dim)),
          ],
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (_archived) _buildArchivedBanner(),
            Expanded(child: _buildBody()),
            if (_error == null && _phase != GenPhase.idle)
              GenPhaseIndicator(phase: _phase),
            if (_error == null && !_archived) _buildComposer(),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return _buildErrorPanel(_error!);

    final children = <Widget>[];
    if (_messages.isEmpty) {
      children.add(_buildEmptyState());
    } else {
      for (final msg in _messages) {
        children.add(MafwMessageBubble(msg: msg));
      }
    }
    return ListView.builder(
      key: const Key('tech-lead-list'),
      controller: _scrollCtrl,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      itemCount: children.length,
      itemBuilder: (ctx, i) => children[i],
    );
  }

  Widget _buildEmptyState() {
    if (_archived) {
      return Padding(
        key: const Key('tech-lead-transcript-note'),
        padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 12),
        child: Column(
          children: [
            const Icon(Icons.history, size: 26, color: MafwPalette.faint),
            const SizedBox(height: 10),
            Text(
              _transcriptMissing
                  ? '没有可读取的讨论记录（归档快照缺失）。'
                  : '没有可读取的讨论记录。',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 12,
                height: 1.5,
                color: MafwPalette.dim,
              ),
            ),
          ],
        ),
      );
    }
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 32, horizontal: 12),
      child: Center(
        child: Text(
          '还没有消息，先说说你的想法。',
          style: TextStyle(fontSize: 12.5, color: MafwPalette.dim),
        ),
      ),
    );
  }

  /// 「讨论已归档」横幅（中性色：mint 只属于需要你/CTA/激活）。
  Widget _buildArchivedBanner() {
    return Container(
      key: const Key('tech-lead-archived-banner'),
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: MafwPalette.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: MafwPalette.border),
      ),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.forum_outlined, size: 16, color: MafwPalette.dim),
          SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '讨论已归档',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: MafwPalette.text,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  '这个 Goal 的当前版本已经结束，下面是留存的讨论记录（只读）。',
                  style: TextStyle(fontSize: 11.5, height: 1.45, color: MafwPalette.dim),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorPanel(String message) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 16),
      children: [
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '无法打开 Tech Lead 讨论',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: MafwPalette.text,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  message,
                  style: const TextStyle(
                    fontSize: 12,
                    height: 1.5,
                    color: MafwPalette.dim,
                  ),
                ),
                const SizedBox(height: 12),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton(
                    key: const Key('tech-lead-retry'),
                    onPressed: () => unawaited(_load()),
                    child: const Text('重试'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// text-only composer（无附件 / 无语音：Tech Lead allowlist 解不了媒体指针）。
  Widget _buildComposer() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              key: const Key('tech-lead-input'),
              controller: _inputCtrl,
              minLines: 1,
              maxLines: 6,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => unawaited(_send()),
              style: const TextStyle(fontSize: 14, color: MafwPalette.text),
              decoration: const InputDecoration(
                hintText: '和 Tech Lead 讨论…',
                isDense: true,
                border: OutlineInputBorder(),
              ),
            ),
          ),
          const SizedBox(width: 6),
          IconButton(
            key: const Key('tech-lead-send'),
            icon: const Icon(Icons.arrow_upward_rounded),
            tooltip: '发送',
            style: IconButton.styleFrom(
              backgroundColor: kMafwPrimary,
              foregroundColor: MafwPalette.black,
            ),
            onPressed: () => unawaited(_send()),
          ),
        ],
      ),
    );
  }
}

class _ArchivedTranscript {
  final String? sessionID;
  final List<MafwMessage> messages;
  final bool missing;

  const _ArchivedTranscript({
    required this.sessionID,
    required this.messages,
    required this.missing,
  });
}
