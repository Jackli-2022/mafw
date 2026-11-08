/// Orcalore 方向裁定面板（「需要你」形态二，Task 13）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.3；Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 13.
///
/// 契约（实读 `gateway/src/routes/pod-collaboration.ts:86` 与
/// `core/pod/pod-direction-service.ts`）：
/// - 写入 = `POST /api/pods/:podId/goals/:goalId/direction-decision`
///   `{mode: 'decided', optionId?, userWords?, revision?}`；服务端要求
///   「至少候选或原话」——空提交本地拦下，不发请求。
/// - 本 UI 只发 `decided`：`needs_user` 需要 `options`（服务端 400 校验），
///   移动端不提供「请求用户裁定」入口，因此文档/实现都不承诺 needs_user。
/// - 候选方向来自 revision 行的 `direction_json` 镜像（gateway 没有独立的
///   GET 方向路由；桌面 `GoalDetailOverlay` 同一来源）。解析 fail-open：
///   坏 JSON / 缺字段 = 没有候选，仍可写自由文本。
/// - 提交成功（决定 append-only 落库）→ [onDecided]；`planningStarted:false`
///   时把 `planningError` 显示在卡内（决定已落库，规划没起，必须照实说）。
/// - 调色板纪律：mint 仅用于**选用态**描边与提交 CTA；标题/摘要/风险中性。
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../models/pod_models.dart';
import '../network/gateway_client.dart';
import '../theme.dart';
import 'attention_seen.dart';

/// 一个候选方向（`DirectionOption`，`core/goal/direction-decision.ts`）。
class DirectionOptionInfo {
  final String id;
  final String title;
  final String? summary;

  /// 该方向的风险（逐条展示，不合并进 summary）。
  final List<String> risks;

  const DirectionOptionInfo({
    required this.id,
    required this.title,
    required this.summary,
    required this.risks,
  });

  factory DirectionOptionInfo.fromJson(Map<String, dynamic> j) {
    final risks = <String>[];
    final seen = <String>{};
    final rawRisks = j['risks'];
    for (final entry in rawRisks is List ? rawRisks : const <dynamic>[]) {
      if (entry is! String) continue;
      final text = entry.trim();
      if (text.isEmpty || !seen.add(text)) continue;
      risks.add(text);
    }
    final rawSummary = j['summary'];
    final summary = rawSummary == null ? '' : rawSummary.toString().trim();
    return DirectionOptionInfo(
      id: (j['id'] ?? '').toString().trim(),
      title: (j['title'] ?? '').toString().trim(),
      summary: summary.isEmpty ? null : summary,
      risks: risks,
    );
  }
}

/// revision `direction_json` 的读模型（`DirectionState` 镜像）。
///
/// 只保留面板要用的字段：`status` / `options` / 最近一次请求的 `reason`。
/// `parse` 对坏 JSON、空对象、非对象返回 `null`（不发明方向）。
class DirectionStateInfo {
  /// `none | pending | decided`。
  final String status;
  final List<DirectionOptionInfo> options;
  final String? requestReason;
  final int? revision;
  final String? updatedAt;

  const DirectionStateInfo({
    required this.status,
    required this.options,
    required this.requestReason,
    required this.revision,
    required this.updatedAt,
  });

  factory DirectionStateInfo.fromJson(Map<String, dynamic> j) {
    final options = <DirectionOptionInfo>[];
    final rawOptions = j['options'];
    for (final item in rawOptions is List ? rawOptions : const <dynamic>[]) {
      if (item is! Map<String, dynamic>) continue;
      final option = DirectionOptionInfo.fromJson(item);
      if (option.id.isEmpty || option.title.isEmpty) continue;
      options.add(option);
    }

    String? requestReason;
    final rawRequests = j['requests'];
    if (rawRequests is List && rawRequests.isNotEmpty) {
      final last = rawRequests.last;
      if (last is Map<String, dynamic>) {
        final reason = (last['reason'] ?? '').toString().trim();
        if (reason.isNotEmpty) requestReason = reason;
      }
    }

    final revision = j['revision'];
    final updatedAt = (j['updatedAt'] ?? '').toString().trim();
    return DirectionStateInfo(
      status: (j['status'] ?? '').toString().trim(),
      options: options,
      requestReason: requestReason,
      revision: revision is num ? revision.toInt() : null,
      updatedAt: updatedAt.isEmpty ? null : updatedAt,
    );
  }

  /// 从 `direction_json` 字符串解析；坏值/空对象返回 `null`（fail-open）。
  static DirectionStateInfo? parse(String? raw) {
    final text = (raw ?? '').trim();
    if (text.isEmpty) return null;
    Object? decoded;
    try {
      decoded = jsonDecode(text);
    } catch (_) {
      return null;
    }
    if (decoded is! Map<String, dynamic>) return null;
    final state = DirectionStateInfo.fromJson(decoded);
    // `{}` 不是方向状态：没有 status、没有候选、没有 revision。
    if (state.status.isEmpty && state.options.isEmpty && state.revision == null) {
      return null;
    }
    return state;
  }
}

/// 方向裁定面板：候选卡（可选中）+ 自由文本 + 提交。
///
/// [state] 来自 `RevisionInfo.directionJson`；[revision] 是当前 revision
/// （服务端按它落库并推进阶段）；[eventId] 是 attention 条目自带的 Pod 事件 id
/// （有则直接回写已读，否则按 goalId+revision 查未读事件）。
class DirectionPanel extends StatefulWidget {
  final GatewayClient client;
  final String podId;
  final String goalId;
  final int? revision;
  final DirectionStateInfo? state;
  final String? eventId;

  /// 决定已落库后的回调；携带服务端结果，宿主据此区分「规划已起」与
  /// 「决定已记录但规划没起」（后者必须保留面板把 `planningError` 说完）。
  final void Function(DirectionDecisionResult result)? onDecided;

  const DirectionPanel(
    this.podId,
    this.goalId, {
    super.key,
    required this.client,
    this.revision,
    this.state,
    this.eventId,
    this.onDecided,
  });

  @override
  State<DirectionPanel> createState() => _DirectionPanelState();
}

class _DirectionPanelState extends State<DirectionPanel> {
  final TextEditingController _words = TextEditingController();
  String? _selectedOptionId;
  bool _busy = false;
  String? _error;
  String? _planningError;

  @override
  void dispose() {
    _words.dispose();
    super.dispose();
  }

  void _toggleOption(String id) {
    if (_busy) return;
    setState(() {
      _selectedOptionId = _selectedOptionId == id ? null : id;
      _error = null;
    });
  }

  Future<void> _submit() async {
    if (_busy) return;
    final optionId = _selectedOptionId;
    final words = _words.text.trim();
    if (optionId == null && words.isEmpty) {
      setState(() => _error = '请选择候选方向或写下你的方向');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
      _planningError = null;
    });
    try {
      final result = await widget.client.directionDecision(
        widget.podId,
        widget.goalId,
        mode: 'decided',
        optionId: optionId,
        userWords: words.isEmpty ? null : words,
        revision: widget.revision,
      );
      if (!mounted) return;
      setState(() {
        _busy = false;
        _selectedOptionId = null;
        _words.clear();
        // 决定已经 append-only 落库；规划没起是真实失败，必须照实展示。
        _planningError = result.planningStarted
            ? null
            : (result.planningError ?? '方向已记录，但规划未能启动');
      });
      unawaited(markAttentionSeen(
        widget.client,
        podId: widget.podId,
        eventId: widget.eventId,
        goalId: widget.goalId,
        revision: widget.revision,
      ));
      widget.onDecided?.call(result);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _serverMessage(e);
      });
    }
  }

  /// 优先展示服务端 `{error}` 原文（如 `direction decision not allowed ...`）。
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
          // 非 JSON 错误体：回退到 GatewayException.message。
        }
      }
      return error.message;
    }
    return error.toString();
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final options = state?.options ?? const <DirectionOptionInfo>[];
    final reason = state?.requestReason;

    return Column(
      key: const Key('direction-panel'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          children: [
            Icon(Icons.alt_route, size: 15, color: MafwPalette.dim),
            SizedBox(width: 6),
            Text(
              '方向裁定',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: MafwPalette.text,
              ),
            ),
          ],
        ),
        if (reason != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              reason,
              key: const Key('direction-request-reason'),
              style: const TextStyle(
                fontSize: 11.5,
                height: 1.45,
                color: MafwPalette.dim,
              ),
            ),
          ),
        if (options.isNotEmpty) ...[
          const SizedBox(height: 6),
          for (final option in options) _buildOption(option),
        ],
        TextField(
          key: const Key('direction-input'),
          controller: _words,
          minLines: 2,
          maxLines: 4,
          enabled: !_busy,
          style: const TextStyle(fontSize: 13, color: MafwPalette.text),
          decoration: const InputDecoration(
            hintText: '也可以直接写下你的方向（原话会逐字保留）',
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              _error!,
              key: const Key('direction-error'),
              style: TextStyle(
                fontSize: 11.5,
                height: 1.45,
                color: Theme.of(context).colorScheme.error,
              ),
            ),
          ),
        if (_planningError != null)
          Container(
            key: const Key('direction-planning-error'),
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              color: MafwPalette.black,
              borderRadius: BorderRadius.circular(9),
              border: Border.all(color: MafwPalette.border),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.error_outline, size: 13, color: MafwPalette.dim),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    '方向已记录，但规划未启动：$_planningError',
                    style: const TextStyle(
                      fontSize: 11,
                      height: 1.45,
                      color: MafwPalette.dim,
                    ),
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton(
            key: const Key('direction-submit'),
            // mint 只属于 CTA：这里是面板里唯一的彩色面。
            style: FilledButton.styleFrom(
              backgroundColor: MafwPalette.accent,
              foregroundColor: MafwPalette.black,
              disabledBackgroundColor: MafwPalette.badgeBg,
              disabledForegroundColor: MafwPalette.faint,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 11),
            ),
            onPressed: _busy ? null : () => unawaited(_submit()),
            child: Text(_busy ? '提交中…' : '记录方向决定'),
          ),
        ),
      ],
    );
  }

  Widget _buildOption(DirectionOptionInfo option) {
    final selected = _selectedOptionId == option.id;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: _busy ? null : () => _toggleOption(option.id),
          borderRadius: BorderRadius.circular(10),
          child: Container(
            key: Key('direction-option:${option.id}'),
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
            decoration: BoxDecoration(
              color: selected ? MafwPalette.accentDim : MafwPalette.black,
              borderRadius: BorderRadius.circular(10),
              // 选用态 = mint 描边（spec §3：mint 允许用于激活/选用）。
              border: Border.all(
                color: selected ? MafwPalette.accent : MafwPalette.border,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  option.title,
                  style: const TextStyle(
                    fontSize: 12.5,
                    height: 1.4,
                    fontWeight: FontWeight.w600,
                    color: MafwPalette.text,
                  ),
                ),
                if (option.summary != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      option.summary!,
                      style: const TextStyle(
                        fontSize: 11,
                        height: 1.45,
                        color: MafwPalette.dim,
                      ),
                    ),
                  ),
                if (option.risks.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      '风险：${option.risks.join('；')}',
                      style: const TextStyle(
                        fontSize: 10.5,
                        height: 1.45,
                        color: MafwPalette.faint,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
