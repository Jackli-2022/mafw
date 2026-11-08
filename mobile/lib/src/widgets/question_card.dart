/// Orcalore 问答卡（「需要你」形态三，Task 13）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.3；Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 13.
///
/// 契约（实读 `gateway/src/index.ts:6340`）：
/// - 回答 = `POST /api/goals/:goalId/questions/:questionId/respond {answer}`；
/// - 取消 = 同端点 `{type:'cancel'}`（服务端走 `handleCancel`，不会把问题当成
///   已回答）；
/// - **空回答必须本地拦下**：`answerQuestion(answer:null)` 会真的发出
///   `{answer:''}`（Task 10 报告），等于写进一条空回答；
/// - 404 = 问题不存在、409 = 已不再 pending（`{status,currentState}`）——
///   错误原文照实展示，草稿保留（失败不丢用户原话）；
/// - 完成动作后 best-effort 回写 Pod 事件已读（[markAttentionSeen]）。
/// - 调色板纪律：mint 只用于提交 CTA；问题文本/取消按钮中性。
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../network/gateway_client.dart';
import '../theme.dart';
import 'attention_seen.dart';

/// 一条 Goal 问题的回答卡。
///
/// [questionId] 来自待回答列表（`GET /api/approvals`）；[question] 是问题正文。
/// [podId] / [revision] / [eventId] 用于完成后的 Pod 事件已读回写（可缺省）。
class QuestionCard extends StatefulWidget {
  final GatewayClient client;
  final String goalId;
  final String questionId;
  final String question;
  final String? podId;
  final int? revision;
  final String? eventId;
  final VoidCallback? onAnswered;

  const QuestionCard(
    this.goalId,
    this.questionId,
    this.question, {
    super.key,
    required this.client,
    this.podId,
    this.revision,
    this.eventId,
    this.onAnswered,
  });

  @override
  State<QuestionCard> createState() => _QuestionCardState();
}

class _QuestionCardState extends State<QuestionCard> {
  final TextEditingController _answer = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _answer.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    final answer = _answer.text.trim();
    if (answer.isEmpty) {
      setState(() => _error = '请填写回答');
      return;
    }
    await _respond(answer: answer);
  }

  Future<void> _cancel() async {
    if (_busy) return;
    await _respond(cancel: true);
  }

  Future<void> _respond({String? answer, bool cancel = false}) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.client.answerQuestion(
        widget.goalId,
        widget.questionId,
        answer: answer,
        cancel: cancel,
      );
      if (!mounted) return;
      setState(() {
        _busy = false;
        if (!cancel) _answer.clear();
      });
      unawaited(markAttentionSeen(
        widget.client,
        podId: widget.podId,
        eventId: widget.eventId,
        goalId: widget.goalId,
        revision: widget.revision,
      ));
      widget.onAnswered?.call();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _serverMessage(e);
      });
    }
  }

  /// 优先展示服务端 `{error}`；问题状态冲突（409）给 `currentState` 人话。
  String _serverMessage(Object error) {
    if (error is GatewayException) {
      final body = error.errorBody;
      if (body != null && body.isNotEmpty) {
        try {
          final decoded = jsonDecode(body);
          if (decoded is Map<String, dynamic>) {
            final text = decoded['error']?.toString() ?? '';
            if (text.isNotEmpty) return text;
            final current = decoded['currentState']?.toString() ?? '';
            if (current.isNotEmpty) return '问题状态已变化：$current';
            final status = decoded['status']?.toString() ?? '';
            if (status.isNotEmpty) return '提交失败：$status';
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
    return Column(
      key: const Key('question-card'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          children: [
            Icon(Icons.help_outline, size: 15, color: MafwPalette.dim),
            SizedBox(width: 6),
            Text(
              '待你回答',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: MafwPalette.text,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          widget.question,
          key: const Key('question-text'),
          style: const TextStyle(
            fontSize: 12.5,
            height: 1.5,
            color: MafwPalette.text,
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          key: const Key('question-answer'),
          controller: _answer,
          minLines: 2,
          maxLines: 5,
          enabled: !_busy,
          style: const TextStyle(fontSize: 13, color: MafwPalette.text),
          decoration: const InputDecoration(hintText: '写下你的回答'),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              _error!,
              key: const Key('question-error'),
              style: TextStyle(
                fontSize: 11.5,
                height: 1.45,
                color: Theme.of(context).colorScheme.error,
              ),
            ),
          ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                key: const Key('question-cancel'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: MafwPalette.text,
                  side: const BorderSide(color: MafwPalette.border),
                  padding: const EdgeInsets.symmetric(vertical: 11),
                ),
                onPressed: _busy ? null : () => unawaited(_cancel()),
                child: const Text('取消问题'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton(
                key: const Key('question-submit'),
                // mint 只属于 CTA。
                style: FilledButton.styleFrom(
                  backgroundColor: MafwPalette.accent,
                  foregroundColor: MafwPalette.black,
                  disabledBackgroundColor: MafwPalette.badgeBg,
                  disabledForegroundColor: MafwPalette.faint,
                  padding: const EdgeInsets.symmetric(vertical: 11),
                ),
                onPressed: _busy ? null : () => unawaited(_submit()),
                child: Text(_busy ? '提交中…' : '提交回答'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
