/// Orcalore「新建讨论」Goal composer（Task 11）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.5（创建讨论）：工作 tab FAB → composer（title + objective + 可选 acceptance，
/// 字段最少）→ `POST /api/pods/:podId/goals`（`source:'mobile'`）→ 创建成功后由
/// 调用方跳 Goal 详情 / 讨论。
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 11.
///
/// 契约（实读 gateway `routes/pods.ts:393-401`，不按草图猜）：
/// - `title` 与 `objective`（或 charter）都是服务端硬要求；composer 没有 charter
///   字段，所以两者都在本地先挡住（同一契约，别让用户白等一次 400）。
/// - `acceptance` 可选，输入是「一行一条」，空行/首尾空白丢弃。
/// - `source:'mobile'` 由 [GatewayClient.createGoal] 保证（本页不重复拼 body）。
/// - 成功 → [GoalComposerPage.onCreated]（携带 `sessionID`/`revision`），随后退回
///   调用方；失败 → 页面留在原处，错误条展示**服务端自己的话**，可改再试。
///
/// 调色板（spec §3）：mint 只用于 CTA（`FilledButton` = theme primary）；
/// 表单/说明/错误全部走中性 token（错误用 theme `colorScheme.error`，不引入
/// 「verdict 绿红」）。
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../models/pod_models.dart';
import '../network/gateway_client.dart';
import '../theme.dart';

// ── 纯函数（widget 测试直接引用）──────────────────────────────────────────────

/// 把「一行一条」的验收输入解析成数组：按行切分、去首尾空白、丢空行。
///
/// 不做去重/改写——用户写的原文就是验收标准，服务端与 Reviewer 都按原文核对。
List<String> parseAcceptanceLines(String raw) {
  final out = <String>[];
  for (final line in raw.split(RegExp(r'\r?\n'))) {
    final text = line.trim();
    if (text.isNotEmpty) out.add(text);
  }
  return List<String>.unmodifiable(out);
}

/// 从一次请求失败里挑出最可读的一句话。
///
/// 优先服务端 `{"error": "..."}` 正文（网关在业务失败时把原因写在 body 里，
/// 例如 `project is not registered: ...` / `goal queue unavailable`），
/// 其次 [GatewayException.message]（HTTP 状态），最后才是异常本身。
String goalComposerErrorMessage(Object error) {
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
        // 非 JSON 正文（HTML/纯文本）：退回异常 message，不把整页 HTML 糊到 UI。
      }
    }
    return error.message;
  }
  return error.toString();
}

// ── 页面 ────────────────────────────────────────────────────────────────────

class GoalComposerPage extends StatefulWidget {
  /// Goal 所属 Pod（WorkTab 先 `podLookup` / `podEnsure` 解析好）。
  final String podId;

  /// Gateway client；`null` = 未配置连接（提交时给可操作错误，不假装成功）。
  final GatewayClient? client;

  /// 创建成功回调：调用方据此跳 Goal 详情（Task 8）并进入讨论入口。
  ///
  /// 页面在回调后自行 `maybePop` 并带回结果——作为路由打开时调用方的
  /// `await Navigator.push<CreateGoalResult>` 同时拿到同一个结果。
  final void Function(CreateGoalResult created)? onCreated;

  const GoalComposerPage(
    this.podId, {
    super.key,
    this.client,
    this.onCreated,
  });

  @override
  State<GoalComposerPage> createState() => _GoalComposerPageState();
}

class _GoalComposerPageState extends State<GoalComposerPage> {
  final TextEditingController _title = TextEditingController();
  final TextEditingController _objective = TextEditingController();
  final TextEditingController _acceptance = TextEditingController();

  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    _objective.dispose();
    _acceptance.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) return;

    final title = _title.text.trim();
    if (title.isEmpty) {
      setState(() => _error = '请先写一个标题');
      return;
    }
    // `routes/pods.ts:401`：objective（或 charter）必填。composer 没有 charter
    // 字段，所以这里按服务端同一契约做本地校验（不是发明新规则）。
    final objective = _objective.text.trim();
    if (objective.isEmpty) {
      setState(() => _error = '再写一句目标（Gateway 要求 title 与 objective 都非空）');
      return;
    }

    final client = widget.client;
    if (client == null) {
      setState(() => _error = '未配置 Gateway，请先在「我的」里连接');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final created = await client.createGoal(
        widget.podId,
        title: title,
        objective: objective,
        acceptance: parseAcceptanceLines(_acceptance.text),
      );
      if (!mounted) return;
      setState(() => _submitting = false);
      widget.onCreated?.call(created);
      if (!mounted) return;
      // 作为路由打开时退回调用方并带回结果；被宿主内嵌（root route）时
      // maybePop 是 no-op，页面保持可用。
      await Navigator.of(context).maybePop(created);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = '创建失败：${goalComposerErrorMessage(e)}';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('新建讨论')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          const Text(
            '说清要做什么，Tech Lead 会先跟你对齐方向，再进入规划与实施。',
            style: TextStyle(fontSize: 12, height: 1.5, color: MafwPalette.dim),
          ),
          const SizedBox(height: 18),
          const _FieldLabel('标题'),
          const SizedBox(height: 6),
          TextField(
            key: const Key('goal-composer-title'),
            controller: _title,
            autofocus: true,
            minLines: 1,
            maxLines: 2,
            textInputAction: TextInputAction.next,
            style: const TextStyle(fontSize: 14.5, height: 1.4, color: MafwPalette.text),
            decoration: const InputDecoration(hintText: '一句话说清这次要做什么'),
          ),
          const SizedBox(height: 16),
          const _FieldLabel('目标'),
          const SizedBox(height: 6),
          TextField(
            key: const Key('goal-composer-objective'),
            controller: _objective,
            minLines: 3,
            maxLines: 6,
            keyboardType: TextInputType.multiline,
            style: const TextStyle(fontSize: 14.5, height: 1.45, color: MafwPalette.text),
            decoration: const InputDecoration(hintText: '为什么做、期望什么结果（一句话即可）'),
          ),
          const SizedBox(height: 16),
          const _FieldLabel('验收标准（可选）'),
          const SizedBox(height: 6),
          TextField(
            key: const Key('goal-composer-acceptance'),
            controller: _acceptance,
            minLines: 3,
            maxLines: 8,
            keyboardType: TextInputType.multiline,
            style: const TextStyle(fontSize: 14.5, height: 1.45, color: MafwPalette.text),
            decoration: const InputDecoration(hintText: '一行一条；越具体越好，Reviewer 会逐条核对'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 14),
            _buildErrorBanner(_error!),
          ],
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              key: const Key('goal-composer-submit'),
              onPressed: _submitting ? null : () => unawaited(_submit()),
              child: Text(_submitting ? '创建中…' : '开始讨论'),
            ),
          ),
          const SizedBox(height: 10),
          const Text(
            '创建后会先进入讨论；方向明确后 Tech Lead 才会规划与派工。',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11, height: 1.4, color: MafwPalette.faint),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorBanner(String message) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      key: const Key('goal-composer-error'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.error.withValues(alpha: 0.45)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, size: 16, color: scheme.onErrorContainer),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(fontSize: 12.5, height: 1.45, color: scheme.onErrorContainer),
            ),
          ),
        ],
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  final String text;

  const _FieldLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.4,
        color: MafwPalette.dim,
      ),
    );
  }
}
