/// Orcalore Plan 批准卡（「需要你」形态一，Task 9）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.4 —— 计划待批准时在 Goal 详情内嵌审阅：waves 摘要（可展开）+ Goal Eval
/// 条目 + 批准（mint CTA）/ 驳回（描边 + 必填反馈）。
///
/// 契约（实读 `gateway/src/routes/goal-plan.ts` / `core/goal/driver.ts`）：
/// - 批准 = `{approve:true, approvalId, planHash, evalHash}`；内容被改写时服务端
///   409 `{code:'stale_plan'}` 并回传新哈希 → 本卡显示「计划已更新，请重拉」并
///   触发 [onRefresh]（绝不拿旧哈希偷偷重试）；
/// - 驳回 = 同端点 `{approve:false, ..., feedback}`；`feedback` 非空是服务端硬
///   要求（400 `reject requires feedback`），所以空输入本地拦下、不发请求；
/// - 计划内容不可读（waves/eval 都缺失）时不提供「批准」——不能批准看不见的计划，
///   诚实的动作是写反馈驳回让 Tech Lead 重出；
/// - 调色板纪律：mint 只用于批准 CTA（以及外层「需要你」框）；waves / Goal Eval /
///   revision 等全部中性色（text / dim / faint / badgeText）。
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../models/plan_models.dart';
import '../network/gateway_client.dart';
import '../theme.dart';

/// 计划批准 / 驳回卡。
///
/// [plan] 来自 `GoalPlanInfo`（`GET /api/goals/:id/plan`）；[onApproved] /
/// [onRejected] 由宿主页面负责刷新与提示；[onRefresh] 只用于 `stale_plan` 后
/// 重新拉取计划（宿主页面传 `reload`）。
class PlanApprovalCard extends StatefulWidget {
  final GatewayClient client;
  final String goalId;
  final GoalPlanInfo plan;
  final VoidCallback? onApproved;
  final VoidCallback? onRejected;
  final VoidCallback? onRefresh;

  const PlanApprovalCard({
    super.key,
    required this.client,
    required this.goalId,
    required this.plan,
    this.onApproved,
    this.onRejected,
    this.onRefresh,
  });

  @override
  State<PlanApprovalCard> createState() => _PlanApprovalCardState();
}

class _PlanApprovalCardState extends State<PlanApprovalCard> {
  final Set<String> _expandedWaves = <String>{};
  final TextEditingController _feedback = TextEditingController();

  bool _busy = false;
  bool _rejectOpen = false;
  bool _stale = false;
  String? _error;
  String? _rejectError;

  @override
  void didUpdateWidget(covariant PlanApprovalCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    // 刷新后是另一版计划：旧的 stale/错误提示不能跟到新内容上。
    final changed = oldWidget.plan.planHash != widget.plan.planHash ||
        oldWidget.plan.evalHash != widget.plan.evalHash ||
        oldWidget.plan.approvalId != widget.plan.approvalId;
    if (changed) {
      _stale = false;
      _error = null;
      _rejectError = null;
      _rejectOpen = false;
      _feedback.clear();
    }
  }

  @override
  void dispose() {
    _feedback.dispose();
    super.dispose();
  }

  void _toggleWave(String id) {
    setState(() {
      if (!_expandedWaves.remove(id)) _expandedWaves.add(id);
    });
  }

  Future<void> _submit({required bool approve}) async {
    final feedback = _feedback.text.trim();
    if (!approve && feedback.isEmpty) {
      setState(() => _rejectError = '请填写驳回原因');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _stale = false;
      _rejectError = null;
    });
    try {
      await widget.client.planApproval(
        widget.goalId,
        approve: approve,
        approvalId: widget.plan.approvalId,
        planHash: widget.plan.planHash,
        evalHash: widget.plan.evalHash,
        planFeedback: approve ? null : feedback,
      );
      if (!mounted) return;
      _feedback.clear();
      setState(() {
        _busy = false;
        _rejectOpen = false;
      });
      if (approve) {
        widget.onApproved?.call();
      } else {
        widget.onRejected?.call();
      }
    } on StalePlanException {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _stale = true;
      });
      widget.onRefresh?.call();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _serverMessage(e);
      });
    }
  }

  /// 优先展示服务端 `{error}` 文案（例如 `plan approval is not pending`）。
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
    final plan = widget.plan;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (plan.planFeedback != null && plan.planFeedback!.isNotEmpty)
          _notice(
            key: const Key('plan-previous-feedback'),
            text: '上一轮驳回：${plan.planFeedback}',
            color: MafwPalette.dim,
          ),
        if (_stale)
          _notice(
            key: const Key('plan-stale-notice'),
            text: '计划已更新，请重拉最新计划后再批准。',
            color: MafwPalette.text,
            icon: Icons.refresh,
          ),
        if (_error != null)
          _notice(
            key: const Key('plan-error'),
            text: _error!,
            color: Theme.of(context).colorScheme.error,
          ),
        _buildWaves(plan),
        _buildGoalEval(plan),
        const Divider(height: 20),
        if (_rejectOpen) ..._buildRejectForm(),
        _buildActions(plan),
      ],
    );
  }

  // ── waves ──

  Widget _buildWaves(GoalPlanInfo plan) {
    if (plan.waves.isEmpty) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Text(
          '计划内容暂不可读（waves 缺失）；可写反馈驳回让 Tech Lead 重出。',
          key: const Key('plan-waves-empty'),
          style: const TextStyle(fontSize: 11.5, height: 1.45, color: MafwPalette.faint),
        ),
      );
    }
    final revision = plan.revision;
    final meta = revision == null
        ? '${plan.waves.length} 个 wave · ${plan.taskCount} 个任务'
        : 'r$revision · ${plan.waves.length} 个 wave · ${plan.taskCount} 个任务';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _Label('执行计划'),
        Text(
          meta,
          style: const TextStyle(fontSize: 10.5, height: 1.4, color: MafwPalette.faint),
        ),
        const SizedBox(height: 2),
        for (final wave in plan.waves) _buildWave(wave),
      ],
    );
  }

  Widget _buildWave(WaveInfo wave) {
    final expanded = _expandedWaves.contains(wave.id);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          key: Key('plan-wave:${wave.id}'),
          onTap: () => _toggleWave(wave.id),
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 7, horizontal: 2),
            child: Row(
              children: [
                Icon(
                  expanded ? Icons.expand_less : Icons.expand_more,
                  size: 15,
                  color: MafwPalette.faint,
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    wave.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: MafwPalette.text,
                    ),
                  ),
                ),
                Text(
                  '${wave.tasks.length} 个任务',
                  style: const TextStyle(fontSize: 10.5, color: MafwPalette.faint),
                ),
              ],
            ),
          ),
        ),
        if (expanded) ...[
          for (final task in wave.tasks) _buildTask(task),
          if (wave.riskNote.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 21, bottom: 6),
              child: Text(
                '风险：${wave.riskNote}',
                style: const TextStyle(fontSize: 10.5, height: 1.45, color: MafwPalette.faint),
              ),
            ),
        ],
      ],
    );
  }

  Widget _buildTask(PlanTaskInfo task) {
    return Padding(
      padding: const EdgeInsets.only(left: 21, bottom: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            task.taskId.isEmpty ? task.title : '${task.taskId} · ${task.title}',
            style: const TextStyle(fontSize: 12, height: 1.45, color: MafwPalette.dim),
          ),
          for (final item in task.acceptance)
            Padding(
              padding: const EdgeInsets.only(left: 10, top: 1),
              child: Text(
                '验收：$item',
                style: const TextStyle(fontSize: 10.5, height: 1.45, color: MafwPalette.faint),
              ),
            ),
        ],
      ),
    );
  }

  // ── Goal Eval ──

  Widget _buildGoalEval(GoalPlanInfo plan) {
    final evalDoc = plan.goalEval;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: 6),
          child: _Label('Goal Eval'),
        ),
        if (evalDoc == null)
          Text(
            '本计划没有可解析的 Goal Eval；批准前需 Tech Lead 补齐。',
            key: const Key('plan-goal-eval-missing'),
            style: const TextStyle(fontSize: 11.5, height: 1.45, color: MafwPalette.faint),
          )
        else ...[
          Text(
            evalDoc.outcome,
            style: const TextStyle(fontSize: 12.5, height: 1.45, color: MafwPalette.text),
          ),
          for (final condition in evalDoc.conditions) _buildCondition(condition),
          if (evalDoc.failureConditions.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '失败条件：${evalDoc.failureConditions.join('；')}',
                style: const TextStyle(fontSize: 10.5, height: 1.45, color: MafwPalette.faint),
              ),
            ),
        ],
      ],
    );
  }

  Widget _buildCondition(GoalEvalConditionInfo condition) {
    final detail = <String>[
      if (condition.evidence.isNotEmpty) '证据：${condition.evidence}',
      if (condition.method.isNotEmpty) '验证：${condition.method}',
    ];
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _NeutralTag(text: condition.required ? '必需' : '可选'),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  condition.statement,
                  style: const TextStyle(fontSize: 12, height: 1.45, color: MafwPalette.dim),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(left: 2, top: 1),
            child: Text(
              [condition.id, ...detail].join(' · '),
              style: const TextStyle(fontSize: 10.5, height: 1.45, color: MafwPalette.faint),
            ),
          ),
        ],
      ),
    );
  }

  // ── 驳回表单 + 动作 ──

  List<Widget> _buildRejectForm() {
    return [
      TextField(
        key: const Key('plan-reject-input'),
        controller: _feedback,
        minLines: 1,
        maxLines: 3,
        enabled: !_busy,
        style: const TextStyle(fontSize: 13, color: MafwPalette.text),
        decoration: const InputDecoration(hintText: '驳回原因（必填，会反馈给 Tech Lead）'),
      ),
      if (_rejectError != null)
        Padding(
          padding: const EdgeInsets.only(top: 5),
          child: Text(
            _rejectError!,
            key: const Key('plan-reject-error'),
            style: TextStyle(
              fontSize: 11,
              color: Theme.of(context).colorScheme.error,
            ),
          ),
        ),
      const SizedBox(height: 6),
      Align(
        alignment: Alignment.centerRight,
        child: TextButton(
          key: const Key('plan-reject-cancel'),
          onPressed: _busy
              ? null
              : () {
                  _feedback.clear();
                  setState(() {
                    _rejectOpen = false;
                    _rejectError = null;
                  });
                },
          child: const Text('取消'),
        ),
      ),
    ];
  }

  Widget _buildActions(GoalPlanInfo plan) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: FilledButton(
                key: const Key('plan-approve'),
                // mint 只属于 CTA：这里是卡片里唯一的彩色面。
                style: FilledButton.styleFrom(
                  backgroundColor: MafwPalette.accent,
                  foregroundColor: MafwPalette.black,
                  disabledBackgroundColor: MafwPalette.badgeBg,
                  disabledForegroundColor: MafwPalette.faint,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
                onPressed: (_busy || _stale || !plan.hasContent)
                    ? null
                    : () => unawaited(_submit(approve: true)),
                child: Text(_busy && !_rejectOpen ? '提交中…' : '批准计划'),
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton(
              key: const Key('plan-reject'),
              style: OutlinedButton.styleFrom(
                foregroundColor: MafwPalette.text,
                side: const BorderSide(color: MafwPalette.border),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
              onPressed: _busy
                  ? null
                  : () => setState(() {
                        _rejectOpen = !_rejectOpen;
                        _rejectError = null;
                      }),
              child: const Text('驳回'),
            ),
          ],
        ),
        if (_rejectOpen)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              children: [
                const Spacer(),
                FilledButton(
                  key: const Key('plan-reject-submit'),
                  onPressed: _busy ? null : () => unawaited(_submit(approve: false)),
                  child: Text(_busy ? '提交中…' : '提交驳回'),
                ),
              ],
            ),
          ),
        if (!plan.hasContent && plan.waves.isEmpty)
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text(
              '计划内容不可读时不提供批准；请写反馈驳回，让 Tech Lead 重出计划。',
              style: TextStyle(fontSize: 10.5, height: 1.45, color: MafwPalette.faint),
            ),
          ),
      ],
    );
  }

  Widget _notice({
    required String text,
    required Color color,
    Key? key,
    IconData? icon,
  }) {
    return Container(
      key: key,
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: MafwPalette.black,
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: MafwPalette.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 13, color: MafwPalette.dim),
            const SizedBox(width: 6),
          ],
          Expanded(
            child: Text(
              text,
              style: TextStyle(fontSize: 11, height: 1.45, color: color),
            ),
          ),
        ],
      ),
    );
  }
}

/// 分区标题（中性，`badgeText` 字）。
class _Label extends StatelessWidget {
  final String text;

  const _Label(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6, bottom: 4),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.3,
          color: MafwPalette.badgeText,
        ),
      ),
    );
  }
}

/// 中性小标签（必需/可选）：badgeBg 底 + badgeText 字，不用 mint。
class _NeutralTag extends StatelessWidget {
  final String text;

  const _NeutralTag({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: MafwPalette.badgeBg,
        borderRadius: BorderRadius.circular(5),
        border: Border.all(color: MafwPalette.border),
      ),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w500,
          color: MafwPalette.badgeText,
        ),
      ),
    );
  }
}
