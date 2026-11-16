/// Orcalore Goal 详情页（Task 8 重写）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.3 —— Goal 详情 = Muse 式审计轨迹：头部（title / 中性阶段徽标 / revision /
/// strategy）+ 需要你操作区（组件位）+ 节点时间线 + 当前行动 + revision 历史 +
/// 结果证据（含打回入口）+「与 Tech Lead 讨论」底部 CTA。
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 8.
///
/// 数据面（全部按 gateway 路由实读，不再消费 legacy `/api/goals/:id`）：
/// - `GET /api/goals/:id/timeline` → 节点级 trace（`{goal,nodes,artifacts,outcome}`）；
///   404 = 还没有 state（讨论/规划阶段）→ 可操作空态，不是整页错误。
/// - `GET /api/pods/:podId/goals/:goalId/revisions` → append-only revision 历史。
/// - `GET /api/pods/:podId/goals/:goalId/result` → 结果证据（验收/条件/任务/产物）。
/// - `POST /api/pods/:podId/goals/:goalId/reject {feedback}` → 开启 revision N+1。
/// - `GET /api/goals/:id/plan` → 待批准计划（仅 `stageKind == 'plan_approval'`，
///   Task 9）；404（还没有 state）= 诚实空态，不是整页错误。
///
/// 调色板纪律（spec §3）：mint 只用于 ① active 节点环 ② CTA ③ 需要你；
/// 阶段徽标 / revision / verdict / 节点 done / 节点 pending 全部中性
/// （verdict = 白 ✓ / 灰 ✕，不引入绿红）。
///
/// 组件位：
/// - [GoalDetailPage.attentionSlot]：需要你操作区的**附加**内容（Task 13 组合
///   语义）——内置卡按 `stageKind` 渲染（plan_approval → PlanApprovalCard、
///   direction_review → DirectionPanel、question → QuestionCard），外部 builder
///   的输出与之**同时**渲染；两者都没有才整块隐藏。`attentionSlot` 的返回值
///   不再吃掉内置卡（Task 9 接缝修复）。
/// - [GoalDetailPage.onDiscussWithTechLead]：底部 CTA（Task 12 已接通 ——
///   回调带解析后的 `(podId, goalId)`，外壳据此 push `TechLeadDiscussionPage`）；
///   缺省时按钮是诚实的占位（snackbar + 一行说明）。
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../models/pod_models.dart';
import '../models/plan_models.dart';
import '../network/gateway_client.dart';
import '../theme.dart';
import '../widgets/direction_panel.dart';
import '../widgets/plan_approval_card.dart';
import '../widgets/question_card.dart';
// 阶段词表单源：工作 tab 的 `stageKind → 中文` 映射（Task 7 定义）。
import 'work_tab.dart' show kWorkStageLabels, projectBasename;

// ── 纯词表 / 纯函数（widget 测试直接引用）──────────────────────────────────

/// 时间线节点展示名（与 gateway 的 `plan | probe | execute | review` 一一对应）。
const Map<String, String> kGoalNodeLabels = <String, String>{
  'plan': '规划',
  'probe': '探针',
  'execute': '实施',
  'review': '评审',
};

/// 时间线的规范节点顺序（probe 是可选节点，只有真的跑过/排到才出现）。
const List<String> kGoalNodeOrder = <String>['plan', 'probe', 'execute', 'review'];

/// Revision 状态展示名（`pod_goal_revisions.status`）。
const Map<String, String> kRevisionStatusLabels = <String, String>{
  'discussing': '讨论中',
  'direction_review': '方向待裁定',
  'planning': '规划中',
  'plan_review': '计划待批准',
  'queued': '排队',
  'implementing': '实施中',
  'reviewing': '评审中',
  'completed': '已完成',
  'aborted': '已中止',
  'discarded': '已丢弃',
};

String goalNodeLabel(String node) =>
    kGoalNodeLabels[node] ?? (node.isEmpty ? '节点' : node);

/// 时间线节点三态（+ 失败态：白底勾 / 灰叉，与 verdict 同规）。
enum GoalTimelineNodeState { done, active, failed, pending }

/// 一个节点的一次聚合行：同一 `(loop, node)` 的多次 attempt 合成一行。
class GoalTimelineRow {
  final int loop;
  final String node;
  final GoalTimelineNodeState state;

  /// 该节点的全部 attempt（attempt 升序）；pending 行为空。
  final List<GoalNodeRun> attempts;

  const GoalTimelineRow({
    required this.loop,
    required this.node,
    required this.state,
    required this.attempts,
  });

  /// 最近一次 attempt（pending 行没有；调用方需先判断 [state]）。
  GoalNodeRun? get latest => attempts.isEmpty ? null : attempts.last;
}

GoalTimelineNodeState _stateOfStatus(String status) {
  switch (status) {
    case 'running':
      return GoalTimelineNodeState.active;
    case 'succeeded':
      return GoalTimelineNodeState.done;
    case 'failed':
    case 'timeout':
      return GoalTimelineNodeState.failed;
    default:
      return GoalTimelineNodeState.pending;
  }
}

/// 把 `timeline.nodes` 聚合成渲染行：loop 升序 → 规范节点顺序，并为「还没跑到」
/// 的节点补 pending 行（只在非终态时补，绝不臆造已归档 Goal 的节点）。
///
/// [strategy] 来自 `PodGoalView.strategy`：`quick` 计划不进独立 Reviewer，
/// 因此不给它补 pending 的 review 行；probe 只有 `nextNode == 'probe'` 时才是
/// 既定下一步，否则不显示这个可选节点。
List<GoalTimelineRow> buildGoalTimelineRows(
  GoalTimeline timeline, {
  String? strategy,
}) {
  final grouped = <int, Map<String, List<GoalNodeRun>>>{};
  for (final run in timeline.nodes) {
    if (run.node.isEmpty) continue;
    (grouped[run.loop] ??= <String, List<GoalNodeRun>>{})
        .putIfAbsent(run.node, () => <GoalNodeRun>[])
        .add(run);
  }
  for (final nodes in grouped.values) {
    for (final attempts in nodes.values) {
      attempts.sort((a, b) => a.attempt.compareTo(b.attempt));
    }
  }

  final loops = grouped.keys.toList()..sort();
  final rows = <GoalTimelineRow>[];
  for (final loop in loops) {
    final nodes = grouped[loop]!;
    for (final node in kGoalNodeOrder) {
      final attempts = nodes[node];
      if (attempts == null || attempts.isEmpty) continue;
      rows.add(GoalTimelineRow(
        loop: loop,
        node: node,
        state: _stateOfStatus(attempts.last.status),
        attempts: List<GoalNodeRun>.unmodifiable(attempts),
      ));
    }
  }

  if (timeline.terminal) return rows;

  final loop = loops.isEmpty ? 1 : loops.last;
  final nodes = grouped[loop] ?? const <String, List<GoalNodeRun>>{};
  final attempted = kGoalNodeOrder.where(nodes.containsKey).toList();

  int from;
  if (attempted.isEmpty) {
    final next = timeline.nextNode;
    final index = next == null ? -1 : kGoalNodeOrder.indexOf(next);
    from = index >= 0 ? index : 0;
  } else {
    from = kGoalNodeOrder.indexOf(attempted.last) + 1;
  }

  for (var i = from; i < kGoalNodeOrder.length; i++) {
    final node = kGoalNodeOrder[i];
    if (nodes.containsKey(node)) continue;
    if (node == 'probe' && timeline.nextNode != 'probe') continue;
    if (node == 'review' && strategy == 'quick') continue;
    rows.add(GoalTimelineRow(
      loop: loop,
      node: node,
      state: GoalTimelineNodeState.pending,
      attempts: const <GoalNodeRun>[],
    ));
  }
  return rows;
}

/// 耗时展示：`900ms` / `12.5s` / `2m 5s`；缺失是 `—`（不猜）。
String formatGoalDuration(int? milliseconds) {
  if (milliseconds == null || milliseconds < 0) return '—';
  if (milliseconds < 1000) return '${milliseconds}ms';
  if (milliseconds < 60000) {
    return '${(milliseconds / 1000).toStringAsFixed(1)}s';
  }
  final minutes = milliseconds ~/ 60000;
  final seconds = (milliseconds % 60000) ~/ 1000;
  return '${minutes}m ${seconds}s';
}

/// 当前行动条文案（`timeline.goal.nextAction`）。未知值原样返回，不吞信息。
String goalActionLabel(String? nextAction) {
  if (nextAction == null || nextAction.isEmpty) return '';
  const fixed = <String, String>{
    'WAIT_PROBE': '等待探针结果',
    'WAIT_USER_ANSWER': '等待你回答',
    'AWAIT_PLAN_APPROVAL': '计划待批准',
    'PAUSED': '已暂停',
    'COMPLETED': '已完成',
    'FAILED': '已失败',
    'CANCELLED': '已取消',
    'ARCHIVED': '已归档',
  };
  final direct = fixed[nextAction];
  if (direct != null) return direct;
  if (nextAction.startsWith('RUNNING_')) {
    return '正在${goalNodeLabel(nextAction.substring('RUNNING_'.length))}';
  }
  if (nextAction.startsWith('NEXT_')) {
    return '下一步：${goalNodeLabel(nextAction.substring('NEXT_'.length))}';
  }
  return nextAction;
}

/// 当前 revision（append-only 历史的最后一行；无历史时 `null`）。
RevisionInfo? latestRevision(List<RevisionInfo> revisions) {
  RevisionInfo? latest;
  for (final revision in revisions) {
    if (latest == null || revision.revision > latest.revision) latest = revision;
  }
  return latest;
}

/// Goal 是否已终态。revision 行是权威（打回后 r2 还在讨论 → 不再终态）；
/// 没有 revision 数据时回退 timeline 的 `nextAction`，再回退列表行的状态。
bool goalDetailIsTerminal({
  PodGoalView? goal,
  GoalTimeline? timeline,
  List<RevisionInfo> revisions = const <RevisionInfo>[],
}) {
  final current = latestRevision(revisions);
  if (current != null) {
    return current.status == 'completed' ||
        current.status == 'aborted' ||
        current.status == 'discarded';
  }
  if (timeline != null) return timeline.terminal;
  if (goal == null) return false;
  final verdict = goal.verdict;
  return goal.status == 'done' ||
      goal.status == 'aborted' ||
      goal.resultReady ||
      (verdict != null && verdict.isNotEmpty);
}

/// 需要你操作区的挂载参数（Task 9 计划批准 / Task 13 方向、问答用）。
///
/// [podId] 是页面解析后的真实 Pod（可能为 `null`：项目还没有 Pod）；
/// [revision] 是当前 revision（打回后会变），组件位据此取当前版的计划/问题。
class GoalAttentionContext {
  final String? podId;
  final String goalId;
  final int revision;
  final String? stageKind;

  const GoalAttentionContext({
    required this.podId,
    required this.goalId,
    required this.revision,
    required this.stageKind,
  });
}

/// 需要你操作区组件位：返回 `null` 表示当前没有要人做的事（整块不渲染）。
typedef GoalAttentionSlotBuilder = Widget? Function(
  BuildContext context,
  GoalAttentionContext slotContext,
);

/// 「与 Tech Lead 讨论」入口（Task 12）：由外壳接线打开讨论页。
///
/// 回调带上页面解析后的 `podId`（Goal 列表行可能没有 Pod id，页面自己
/// `podLookup` 解析），讨论页据此 `openTechLead` / `sendTechLeadMessage`。
typedef GoalDiscussHandler = void Function(String podId, String goalId);

// ── 页面 ────────────────────────────────────────────────────────────────────

class GoalDetailPage extends StatefulWidget {
  /// 已有 Pod id；为 `null` 时页面用 [projectDir] 自行 `podLookup` 解析。
  final String? podId;
  final String goalId;
  final GatewayClient? client;

  /// WorkTab 的 `projectId`（项目目录）：解析 Pod + 刷新 revision 用。
  final String? projectDir;

  /// 工作列表已有的行（首帧头像/标题不闪空；随后仍会按 podLookup 刷新）。
  final PodGoalView? initial;

  /// 需要你操作区组件位（Task 9 计划批准 / Task 13 方向、问答挂入）。
  final GoalAttentionSlotBuilder? attentionSlot;

  /// 「与 Tech Lead 讨论」（Task 12 接通）；缺省时按钮为诚实占位。
  final GoalDiscussHandler? onDiscussWithTechLead;

  /// 重连信号（final fix wave Finding 1）：断线期间的 WS 事件不重放，收到信号
  /// 后静默重载时间线 / revision / 结果（保留屏上内容，不重新进入 loading）。
  final Listenable? reconnect;

  const GoalDetailPage(
    this.podId,
    this.goalId, {
    super.key,
    this.client,
    this.projectDir,
    this.initial,
    this.attentionSlot,
    this.onDiscussWithTechLead,
    this.reconnect,
  });

  @override
  State<GoalDetailPage> createState() => _GoalDetailPageState();
}

class _GoalDetailPageState extends State<GoalDetailPage> {
  PodGoalView? _goal;
  GoalTimeline? _timeline;
  bool _timelineMissing = false;
  List<RevisionInfo> _revisions = const <RevisionInfo>[];
  GoalResultInfo? _result;

  /// 待批准的计划（`GET /api/goals/:id/plan`）；只在 `stageKind == 'plan_approval'`
  /// 时读取 —— 别的阶段没有要人审批的计划，不该多发一次请求。
  GoalPlanInfo? _plan;
  String? _planError;

  /// 阶段说「计划待批准」但 plan 路由 404（还没有 Goal state）——诚实空态，
  /// 不是失败，也不是"正在加载"。
  bool _planMissing = false;
  String? _podId;

  /// 待回答的 Goal 问题（`stageKind == 'question'` 时从 `GET /api/approvals`
  /// 读出；其它阶段清空，避免拿旧问题继续催人）。
  GoalQuestionInfo? _question;
  String? _questionError;

  /// 问题列表是否已经读过（区分「正在读取」和「确实没有待回答问题」）。
  bool _questionLoaded = false;

  bool _loading = true;
  String? _error;

  /// 请求代际：连续刷新/打回时丢弃过期响应。
  int _seq = 0;

  /// 已批量标记过已读的结果 revision（同一 revision 不重复 POST）。
  int? _seenResultRevision;

  final Set<String> _expanded = <String>{};
  final TextEditingController _rejectController = TextEditingController();
  bool _rejectFormOpen = false;
  bool _rejecting = false;
  String? _rejectError;

  @override
  void initState() {
    super.initState();
    _goal = widget.initial;
    widget.reconnect?.addListener(_onReconnect);
    unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant GoalDetailPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.reconnect, widget.reconnect)) {
      oldWidget.reconnect?.removeListener(_onReconnect);
      widget.reconnect?.addListener(_onReconnect);
    }
  }

  @override
  void dispose() {
    widget.reconnect?.removeListener(_onReconnect);
    _rejectController.dispose();
    super.dispose();
  }

  /// 重连成功：静默重载（断线期间的事件不重放）。
  void _onReconnect() {
    if (!mounted) return;
    unawaited(_load(silent: true));
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
    // 只有「屏上什么都还没有」的非静默加载才进入整页 loading；重连后的静默
    // 重载必须保留旧数据（final fix wave Finding 1）。
    if (!silent && !_loading && _goal == null && _timeline == null) {
      setState(() => _loading = true);
    }

    var podId = widget.podId ?? _podId;
    var goal = widget.initial ?? _goal;

    // Pod（以及它携带的最新 Goal 行）是 revision/结果/打回的来源。
    final dir = widget.projectDir;
    if (dir != null && dir.isNotEmpty) {
      try {
        final pod = await client.podLookup(dir);
        if (pod != null) {
          if (pod.id.isNotEmpty) podId = pod.id;
          goal = _findGoal(pod.goals, widget.goalId) ?? goal;
        }
      } catch (_) {
        // 头部信息是附加面：Pod 查询失败不影响时间线渲染。
      }
      if (!mounted || seq != _seq) return;
    }

    GoalTimeline? timeline;
    var missing = false;
    String? error;
    try {
      timeline = await client.goalTimeline(widget.goalId);
    } on GoalStateMissingException {
      missing = true;
    } catch (e) {
      error = _messageOf(e);
    }
    if (!mounted || seq != _seq) return;

    // 计划待批准是唯一需要 plan 的阶段（Task 9「需要你」形态一）。
    // 读不到计划（还没有 state / 旧网关）不算整页错误：卡片让位，头部与时间线照常。
    var plan = _plan;
    String? planError;
    var planMissing = false;
    final stageKind = goal?.stageKind ?? _goal?.stageKind ?? '';
    if (stageKind == 'plan_approval') {
      try {
        plan = await client.goalPlan(widget.goalId);
        planError = null;
      } on GoalStateMissingException {
        plan = null;
        planError = null;
        planMissing = true;
      } catch (e) {
        planError = _messageOf(e);
      }
      if (!mounted || seq != _seq) return;
    } else {
      // 离开批准阶段后不再保留旧计划（避免对已变更内容再次批准）。
      plan = null;
      planError = null;
    }

    // 问答阶段（Task 13「需要你」形态三）。
    //
    // 权威来源是 Goal 视图自带的 driver `pendingQuestion`（questionId + 正文，
    // 与 `POST /api/goals/:id/questions/:qid/respond` 同 id）。`/api/approvals`
    // 是另一套来源（MCP `mafw_ask_user` 的 user-questions 文件），只作为旧网关
    // /视图没有 pendingQuestion 时的回退——它的 id 与 driver 问题不互通，读了
    // 也答不上，因此有完整 pendingQuestion 时不再发这次请求。
    var question = _question;
    String? questionError;
    var questionLoaded = _questionLoaded;
    if (stageKind == 'question') {
      questionLoaded = false;
      final goalQuestion = goal?.pendingQuestion;
      final hasGoalQuestion = goalQuestion != null
          && goalQuestion.questionId.isNotEmpty
          && goalQuestion.text.isNotEmpty;
      if (hasGoalQuestion) {
        question = null;
        questionError = null;
        questionLoaded = true;
      } else {
        // 回退只依赖 goalId（`/api/approvals` 扫描），不需要 Pod；
        // 没有 Pod 只是不回写事件已读（`markAttentionSeen` 会跳过）。
        try {
          final items = await client.pendingGoalQuestions(widget.goalId);
          question = items.isEmpty ? null : items.first;
          questionError = null;
          questionLoaded = true;
        } catch (e) {
          question = null;
          questionError = _messageOf(e);
          questionLoaded = true;
        }
        if (!mounted || seq != _seq) return;
      }
    } else {
      question = null;
      questionError = null;
      questionLoaded = true;
    }

    var revisions = _revisions;
    var result = _result;
    if (podId != null) {
      try {
        revisions = await client.goalRevisions(podId, widget.goalId);
      } catch (_) {
        // 旧网关没有该路由：保留上一次数据（版本历史降级为空）。
      }
      if (!mounted || seq != _seq) return;
      try {
        result = await client.goalResult(podId, widget.goalId);
      } catch (_) {
        // 结果不可读时保留上一次（终态展示有兜底）。
      }
      if (!mounted || seq != _seq) return;
    }

    // 只有「时间线读不到 + 没有任何头部数据」才是整页错误；软刷新失败保留屏上内容。
    final hasTimeline = timeline != null || _timeline != null;
    setState(() {
      _loading = false;
      _podId = podId;
      _goal = goal;
      if (timeline != null) {
        _timeline = timeline;
        _timelineMissing = false;
      } else if (missing) {
        _timeline = null;
        _timelineMissing = true;
      }
      _revisions = revisions;
      _result = result;
      _plan = plan;
      _planError = planError;
      _planMissing = planMissing;
      _question = question;
      _questionError = questionError;
      _questionLoaded = questionLoaded;
      _error = error != null && !hasTimeline && goal == null ? error : null;
    });

    // 终态结果成功加载 = 人已经看到结果：批量把该 (goalId, revision) 的结果
    // 事件标记已读，工作 tab 的「N 个结果待查看」才会回落（final fix wave
    // Finding 4）。非终态 / 结果不可读都不写。
    if (podId != null && result != null && _isTerminal && !_isCancelled) {
      unawaited(_markResultEventsSeen(podId));
    }
  }

  /// `POST /api/pods/:podId/events/seen {goalId, revision}`——结果事件（p1
  /// `goal.result`）没有单条 id 可点，工作 tab 的 unread 徽标只有这条批量
  /// 写回能清掉。fail-open：旧网关 404 / 网络失败都不阻塞结果渲染。
  Future<void> _markResultEventsSeen(String podId) async {
    final client = widget.client;
    if (client == null) return;
    final revision = _revision;
    if (_seenResultRevision == revision) return;
    try {
      await client.markPodEventsSeenAll(podId, widget.goalId, revision);
      _seenResultRevision = revision;
    } catch (_) {
      // Best-effort：角标会在下一次 presence 轮询/刷新时恢复（服务端权威）。
    }
  }

  PodGoalView? _findGoal(List<PodGoalView> goals, String goalId) {
    for (final goal in goals) {
      if (goal.goalId == goalId) return goal;
    }
    return null;
  }

  Future<void> _submitReject() async {
    final feedback = _rejectController.text.trim();
    if (feedback.isEmpty) {
      setState(() => _rejectError = '请填写打回原因');
      return;
    }
    final client = widget.client;
    final podId = _podId;
    if (client == null || podId == null) return;

    setState(() {
      _rejecting = true;
      _rejectError = null;
    });
    try {
      final rejected = await client.rejectGoal(podId, widget.goalId, feedback);
      if (!mounted) return;
      final nextRevision = rejected.revision > 0 ? rejected.revision : _revision + 1;
      _rejectController.clear();
      setState(() {
        _rejecting = false;
        _rejectFormOpen = false;
      });
      _snack('已开启 revision $nextRevision');
      await _load();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _rejecting = false;
        _rejectError = _serverMessage(e);
      });
    }
  }

  void _openRejectForm() {
    setState(() {
      _rejectFormOpen = true;
      _rejectError = null;
    });
  }

  void _closeRejectForm() {
    _rejectController.clear();
    setState(() {
      _rejectFormOpen = false;
      _rejectError = null;
    });
  }

  void _toggleNode(String key) {
    setState(() {
      if (!_expanded.remove(key)) _expanded.add(key);
    });
  }

  void _onDiscussWithTechLead() {
    final handler = widget.onDiscussWithTechLead;
    if (handler == null) {
      _snack('与 Tech Lead 讨论将在下一版本接通');
      return;
    }
    // 讨论页需要 Pod id（`openTechLead` / `sendTechLeadMessage` 的路径段）。
    final podId = _podId ?? widget.podId;
    if (podId == null || podId.isEmpty) {
      _snack('还没有鲸群，无法打开讨论');
      return;
    }
    handler(podId, widget.goalId);
  }

  void _snack(String message) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(message),
        duration: const Duration(seconds: 2),
      ));
  }

  String _messageOf(Object error) =>
      error is GatewayException ? error.message : error.toString();

  /// 打回失败时优先展示服务端的 `{error}` 文案（「feedback is required」等）。
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

  // ── 派生值（revision 行是当前状态权威）──

  String get _title {
    final fromGoal = (_goal?.title ?? '').trim();
    if (fromGoal.isNotEmpty) return fromGoal;
    final fromTimeline = (_timeline?.title ?? '').trim();
    if (fromTimeline.isNotEmpty) return fromTimeline;
    return '未命名目标';
  }

  int get _revision => latestRevision(_revisions)?.revision ?? _goal?.revision ?? 1;

  String? get _verdict {
    final current = latestRevision(_revisions);
    if (current != null) {
      final value = current.verdict;
      return value == null || value.isEmpty ? null : value;
    }
    final fromGoal = _goal?.verdict;
    if (fromGoal != null && fromGoal.isNotEmpty) return fromGoal;
    final fromTimeline = _timeline?.verdict;
    if (fromTimeline != null && fromTimeline.isNotEmpty) return fromTimeline;
    return null;
  }

  String get _stageLabel {
    final kind = _goal?.stageKind ?? '';
    if (kind.isNotEmpty) return kWorkStageLabels[kind] ?? kind;
    final timeline = _timeline;
    if (timeline != null && timeline.terminal) return '已结束';
    return '';
  }

  bool get _isTerminal => goalDetailIsTerminal(
        goal: _goal,
        timeline: _timeline,
        revisions: _revisions,
      );

  /// 取消/中止的 Goal 没有可验收的结果（桌面同规：不渲染结果卡与打回）。
  bool get _isCancelled {
    final current = latestRevision(_revisions);
    if (current != null && current.status == 'aborted') return true;
    if (_verdict == 'CANCELLED') return true;
    return _goal?.status == 'aborted';
  }

  // ── 渲染 ──

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Goal 详情', style: TextStyle(fontSize: 15)),
        actions: [
          IconButton(
            key: const Key('goal-refresh'),
            icon: const Icon(Icons.refresh, size: 20),
            tooltip: '刷新',
            onPressed: () => unawaited(_load()),
          ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => _load(),
          color: MafwPalette.accent,
          backgroundColor: MafwPalette.surface,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(MafwSpace.xl, 12, MafwSpace.xl, MafwSpace.xxl),
            children: _buildChildren(),
          ),
        ),
      ),
    );
  }

  List<Widget> _buildChildren() {
    if (_loading && _goal == null && _timeline == null && !_timelineMissing) {
      return const [
        Padding(
          padding: EdgeInsets.symmetric(vertical: 64),
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    }

    final children = <Widget>[_buildHeader(), const SizedBox(height: 14)];
    if (_error != null) {
      children.add(_buildErrorPanel(_error!));
      children.addAll(_buildTail());
      return children;
    }

    final slotContext = GoalAttentionContext(
      podId: _podId,
      goalId: widget.goalId,
      revision: _revision,
      stageKind: _goal?.stageKind,
    );
    // 组合语义（Task 13 接缝修复）：内置卡按 stageKind 渲染，外部 builder 的
    // 输出与之**同时**渲染；两者都为 null 才整块隐藏（不再二选一）。
    final builtIn = _defaultAttentionSlot(slotContext);
    final custom = widget.attentionSlot?.call(context, slotContext);
    final slots = <Widget>[
      ?builtIn,
      ?custom,
    ];
    if (slots.isNotEmpty) {
      children.add(_buildAttention(slots));
      children.add(const SizedBox(height: 14));
    }

    children.addAll(_buildTimelineSection());
    children.addAll(_buildActionSection());
    children.addAll(_buildRevisionSection());
    children.addAll(_buildResultSection());
    children.addAll(_buildTail());
    return children;
  }

  Widget _buildHeader() {
    final stage = _stageLabel;
    final verdict = _verdict;
    final strategy = _goal?.strategy ?? '';
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'GOAL',
            style: TextStyle(fontSize: 9, letterSpacing: 2.2, color: MafwPalette.faint),
          ),
          const SizedBox(height: 10),
          Text(
            _title,
            style: const TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.w600,
              height: 1.2,
              letterSpacing: -0.6,
              color: MafwPalette.text,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              if (stage.isNotEmpty)
                _Tag(
                  key: const Key('goal-stage-badge'),
                  text: stage,
                ),
              _Tag(text: 'r$_revision'),
              if (strategy.isNotEmpty) _Tag(text: strategy),
              if (verdict != null) _Tag(text: verdict, emphasized: true),
            ],
          ),
        ],
      ),
    );
  }

  /// 缺省「需要你」内容（Task 9/13）：按 `stageKind` 分发内置卡。
  ///
  /// - `plan_approval` → [PlanApprovalCard]（计划可读且仍 pending 时）；
  /// - `direction_review` → [DirectionPanel]（候选来自 revision 的
  ///   `direction_json` 镜像，没有候选也能写自由文本）；
  /// - `question` → [QuestionCard]（正文来自 `GET /api/approvals`）；
  /// - 其它阶段 / 没有可做的事 → `null`（该卡不渲染，不是给一个空框）。
  ///
  /// 注意：这是**内置**内容；外部 `attentionSlot` 的输出由 [_buildChildren]
  /// 叠加在同一「需要你」框里，二者不再二选一。
  Widget? _defaultAttentionSlot(GoalAttentionContext slot) {
    switch (slot.stageKind) {
      case 'plan_approval':
        return _planAttention();
      case 'direction_review':
        return _directionAttention(slot);
      case 'question':
        return _questionAttention(slot);
      default:
        return null;
    }
  }

  /// 计划待批准（Task 9）。
  Widget? _planAttention() {
    final client = widget.client;
    if (client == null) return null;
    final plan = _plan;
    if (plan == null) {
      final error = _planError;
      if (error == null) {
        return Text(
          _planMissing
              ? '计划还没有生成（还没有 Goal state）；Tech Lead 可能还在规划，下拉刷新重试。'
              : '正在读取计划…',
          key: Key(_planMissing ? 'plan-missing' : 'plan-loading'),
          style: const TextStyle(
            fontSize: 11.5,
            height: 1.45,
            color: MafwPalette.dim,
          ),
        );
      }
      return Text(
        '计划读取失败：$error\n下拉刷新重试。',
        key: const Key('plan-load-error'),
        style: const TextStyle(fontSize: 11.5, height: 1.45, color: MafwPalette.dim),
      );
    }
    // 已批准 / 已驳回的审批记录不再催人（阶段会随下一次刷新迁移）。
    if (!plan.pending) return null;
    return PlanApprovalCard(
      key: const Key('plan-approval-card'),
      client: client,
      goalId: widget.goalId,
      plan: plan,
      podId: _podId,
      revision: _revision,
      onApproved: () => _afterAttentionAction('计划已批准，Tech Lead 开始实施'),
      onRejected: () => _afterAttentionAction('已驳回，Tech Lead 会按反馈重出计划'),
      onRefresh: () => unawaited(_load()),
    );
  }

  /// 方向待裁定（Task 13 形态二）。
  Widget? _directionAttention(GoalAttentionContext slot) {
    final client = widget.client;
    if (client == null) return null;
    final podId = slot.podId;
    if (podId == null || podId.isEmpty) {
      return const Text(
        '还没有鲸群，无法记录方向；先在工作页创建鲸群。',
        key: Key('direction-no-pod'),
        style: TextStyle(fontSize: 11.5, height: 1.45, color: MafwPalette.dim),
      );
    }
    return DirectionPanel(
      podId,
      widget.goalId,
      client: client,
      revision: slot.revision,
      state: _directionStateInfo,
      onDecided: _afterDirectionDecision,
    );
  }

  /// 待回答问题（Task 13 形态三）。
  ///
  /// 顺序（Important review 修复）：
  /// 1. Goal 视图的 driver `pendingQuestion`（权威 id + 正文）；
  /// 2. `/api/approvals` 的待答问题（旧网关 / MCP 问题）：当 Goal 视图也给了
  ///    questionId 时，只采信 **同 id** 的正文，绝不拿别的问题正文配错 id；
  /// 3. 只有 questionId 没有正文（当前网关只下发 `stage.action.questionId`）：
  ///    仍然渲染卡片——回答会落到正确的 driver questionId，正文等网关补齐；
  /// 4. 其余才是读取失败 / 正在读取 / 已不在列表。
  Widget? _questionAttention(GoalAttentionContext slot) {
    final client = widget.client;
    if (client == null) return null;

    QuestionCard cardFor(String questionId, String question) {
      return QuestionCard(
        widget.goalId,
        questionId,
        question,
        client: client,
        podId: slot.podId,
        revision: slot.revision,
        onAnswered: () => _afterAttentionAction('已提交回答'),
      );
    }

    final goalQuestionId = _goal?.questionId;
    final pending = _goal?.pendingQuestion;
    if (pending != null && pending.questionId.isNotEmpty && pending.text.isNotEmpty) {
      return cardFor(pending.questionId, pending.text);
    }

    final question = _question;
    if (question != null &&
        (goalQuestionId == null || question.id == goalQuestionId)) {
      return cardFor(goalQuestionId ?? question.id, question.question);
    }

    if (goalQuestionId != null) {
      return cardFor(goalQuestionId, 'Tech Lead 在等待你的回答。');
    }

    final error = _questionError;
    if (error != null) {
      return Text(
        '问题读取失败：$error\n下拉刷新重试。',
        key: const Key('question-load-error'),
        style: const TextStyle(fontSize: 11.5, height: 1.45, color: MafwPalette.dim),
      );
    }
    if (!_questionLoaded) {
      return const Text(
        '正在读取问题…',
        key: Key('question-loading'),
        style: TextStyle(fontSize: 11.5, height: 1.45, color: MafwPalette.dim),
      );
    }
    return const Text(
      '这个问题已经不在待回答列表里（可能已被回答）。下拉刷新重试。',
      key: Key('question-missing'),
      style: TextStyle(fontSize: 11.5, height: 1.45, color: MafwPalette.dim),
    );
  }

  /// 当前 revision 的方向状态（`direction_json` 镜像；坏值 = 没有候选）。
  DirectionStateInfo? get _directionStateInfo {
    final current = latestRevision(_revisions);
    if (current == null) return null;
    return DirectionStateInfo.parse(current.directionJson);
  }

  /// 方向决定已落库后的阶段处理（Task 13 诚实接缝）。
  ///
  /// `planningStarted == false` 时**不刷新**：服务端已经把 revision 推进到
  /// planning，刷新会让 `direction_review` 面板整体消失，[DirectionPanel]
  /// 里的 `planningError` 就永远看不到。决定已经 append-only 落库，保留旧面板
  /// 展示失败原因，用户可下拉刷新查看新阶段。
  void _afterDirectionDecision(DirectionDecisionResult result) {
    if (!result.planningStarted) return;
    _afterAttentionAction('已记录方向，Tech Lead 会继续规划');
  }

  void _afterAttentionAction(String message) {
    _snack(message);
    unawaited(_load());
  }

  Widget _buildAttention(List<Widget> slots) {
    return Container(
      key: const Key('goal-attention-slot'),
      padding: const EdgeInsets.only(left: 14, top: 2, bottom: 2),
      decoration: const BoxDecoration(
        border: Border(left: BorderSide(color: MafwPalette.accent, width: 2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '现在需要你',
            style: TextStyle(
              fontSize: 10,
              letterSpacing: 1.9,
              color: MafwPalette.accent,
            ),
          ),
          const SizedBox(height: 8),
          for (var i = 0; i < slots.length; i++) ...[
            if (i > 0) const SizedBox(height: 10),
            slots[i],
          ],
        ],
      ),
    );
  }

  List<Widget> _buildTimelineSection() {
    final timeline = _timeline;
    final rows = timeline == null
        ? const <GoalTimelineRow>[]
        : buildGoalTimelineRows(timeline, strategy: _goal?.strategy);

    final children = <Widget>[const _SectionTitle('时间线')];
    if (rows.isEmpty) {
      children.add(_timelineEmpty());
      return children;
    }
    children.add(Column(
      children: [
        for (var i = 0; i < rows.length; i++) ...[
          if (i > 0) const Divider(height: 1),
          _buildNodeRow(rows[i]),
        ],
      ],
    ));
    return children;
  }

  Widget _timelineEmpty() {
    if (_timelineMissing) {
      return const _EmptyNote(
        key: Key('goal-timeline-empty'),
        icon: Icons.timeline,
        title: '还没有执行记录',
        body: 'Goal 还在讨论 / 规划阶段。开始执行后，'
            '这里会出现 规划 → 实施 → 评审 的节点时间线。',
      );
    }
    return const _EmptyNote(
      key: Key('goal-timeline-empty'),
      icon: Icons.timeline,
      title: '执行记录不可用',
      body: '时间线暂时读不到；下拉刷新或稍后再试。',
    );
  }

  Widget _buildNodeRow(GoalTimelineRow row) {
    final key = '${row.loop}:${row.node}';
    final expanded = _expanded.contains(key);
    final label = row.loop > 1
        ? '${goalNodeLabel(row.node)} · 第 ${row.loop} 轮'
        : goalNodeLabel(row.node);
    final summary = switch (row.state) {
      GoalTimelineNodeState.done => row.latest?.outcome ?? '完成',
      GoalTimelineNodeState.active => '进行中',
      GoalTimelineNodeState.failed => '失败',
      GoalTimelineNodeState.pending => '待开始',
    };
    final summaryColor = switch (row.state) {
      GoalTimelineNodeState.active => MafwPalette.accent,
      GoalTimelineNodeState.pending => MafwPalette.faint,
      _ => MafwPalette.dim,
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          key: Key('goal-node:$key'),
          onTap: () => _toggleNode(key),
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 2),
            child: Row(
              children: [
                _NodeMarker(
                  key: Key('goal-node-marker:$key'),
                  state: row.state,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: MafwPalette.text,
                    ),
                  ),
                ),
                // 结论文本（PASS / waves=3 / receipts=2）有宽度上限，避免长 outcome
                // 挤掉节点名或撑破行（Row 里非 flex 子项不会自动收缩）。
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 140),
                  child: Text(
                    summary,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11, color: summaryColor),
                  ),
                ),
                const SizedBox(width: 4),
                Icon(
                  expanded ? Icons.expand_less : Icons.expand_more,
                  size: 16,
                  color: MafwPalette.faint,
                ),
              ],
            ),
          ),
        ),
        if (expanded)
          for (final run in row.attempts)
            Padding(
              padding: const EdgeInsets.only(left: 28, bottom: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'attempt ${run.attempt} · '
                    '${formatGoalDuration(run.durationMs)} · '
                    '${run.outcome ?? run.status}',
                    style: const TextStyle(fontSize: 11, color: MafwPalette.dim),
                  ),
                  if (run.error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        run.error!,
                        style: const TextStyle(
                          fontSize: 11,
                          height: 1.4,
                          color: MafwPalette.faint,
                        ),
                      ),
                    ),
                ],
              ),
            ),
      ],
    );
  }

  List<Widget> _buildActionSection() {
    final timeline = _timeline;
    if (timeline == null) return const [];
    final action = goalActionLabel(timeline.nextAction);
    if (action.isEmpty) return const [];

    return [
      const SizedBox(height: 14),
      Container(
        key: const Key('goal-action-bar'),
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: const BoxDecoration(
          border: Border(
            top: BorderSide(color: MafwPalette.border),
            bottom: BorderSide(color: MafwPalette.border),
          ),
        ),
        child: Row(
          children: [
            const Icon(Icons.bolt, size: 15, color: MafwPalette.dim),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                action,
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
              '第 ${timeline.round} 轮',
              style: const TextStyle(fontSize: 11, color: MafwPalette.faint),
            ),
          ],
        ),
      ),
      if (timeline.lastError != null)
        Padding(
          padding: const EdgeInsets.only(top: 6, left: 2),
          child: Text(
            timeline.lastError!,
            style: const TextStyle(fontSize: 11, height: 1.4, color: MafwPalette.dim),
          ),
        ),
    ];
  }

  List<Widget> _buildRevisionSection() {
    if (_revisions.isEmpty) return const [];
    final sorted = List<RevisionInfo>.of(_revisions)
      ..sort((a, b) => b.revision.compareTo(a.revision));

    return [
      const _SectionTitle('版本历史'),
      Column(
        children: [
          for (var i = 0; i < sorted.length; i++) ...[
            if (i > 0) const Divider(height: 1),
            _buildRevisionRow(sorted[i]),
          ],
        ],
      ),
    ];
  }

  Widget _buildRevisionRow(RevisionInfo revision) {
    final status = kRevisionStatusLabels[revision.status] ??
        (revision.status.isEmpty ? '未知' : revision.status);
    final verdict = revision.verdict;
    final feedback = revision.feedback;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'r${revision.revision} · $status',
                  style: const TextStyle(fontSize: 12.5, color: MafwPalette.text),
                ),
              ),
              if (verdict != null && verdict.isNotEmpty) _Tag(text: verdict),
            ],
          ),
          if (feedback != null && feedback.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                feedback,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 11,
                  height: 1.45,
                  color: MafwPalette.dim,
                ),
              ),
            ),
        ],
      ),
    );
  }

  List<Widget> _buildResultSection() {
    final result = _result;
    final terminal = _isTerminal;
    // 非终态（含「已打回、新 revision 正在讨论」）不展示结果区；
    // 取消/中止的 Goal 没有可验收的结果。
    if (!terminal || _isCancelled) return const [];

    final verdict = result?.verdict ?? _verdict ?? '—';
    final assessment = result?.assessment ?? '';
    final acceptance = result?.acceptance ?? const <String>[];
    final conditions = result?.conditions ?? const <GoalConditionResult>[];
    final tasks = result?.tasks ?? const <GoalTaskResult>[];
    final artifacts = result?.artifacts ?? const <String>[];
    final feedback = result?.feedback ?? '';
    final failure = result?.failure;

    return [
      const _SectionTitle('结果'),
      Column(
        key: const Key('goal-result-card'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
              Row(
                children: [
                  Text(
                    verdict,
                    key: const Key('goal-result-verdict'),
                    style: const TextStyle(
                      fontFamily: MafwFonts.serif,
                      fontSize: 28,
                      height: 1.0,
                      color: MafwPalette.text,
                    ),
                  ),
                  const SizedBox(width: 10),
                  if (assessment.isNotEmpty) _Tag(text: _assessmentLabel(assessment)),
                ],
              ),
              if (failure != null) ...[
                const SizedBox(height: 8),
                Text(
                  '结果不可信：$failure',
                  style: const TextStyle(fontSize: 11.5, color: MafwPalette.dim),
                ),
              ],
              if (result == null) ...[
                const SizedBox(height: 8),
                const Text(
                  '没有可读取的结果产物（goal result not found）。',
                  style: TextStyle(fontSize: 11.5, color: MafwPalette.faint),
                ),
              ],
              if (acceptance.isNotEmpty) ...[
                const _SubTitle('验收'),
                for (final item in acceptance) _Bullet(item),
              ],
              if (conditions.isNotEmpty) ...[
                const _SubTitle('验收条件'),
                for (final condition in conditions) _buildConditionRow(condition),
              ],
              if (tasks.isNotEmpty) ...[
                const _SubTitle('证据'),
                for (final task in tasks) _buildTaskRow(task),
              ],
              if (artifacts.isNotEmpty) ...[
                const _SubTitle('产物'),
                for (final artifact in artifacts)
                  _Bullet(projectBasename(artifact), icon: Icons.description_outlined),
              ],
              if (feedback.isNotEmpty) ...[
                const _SubTitle('评审反馈'),
                Text(
                  feedback,
                  style: const TextStyle(
                    fontSize: 12,
                    height: 1.5,
                    color: MafwPalette.dim,
                  ),
                ),
              ],
              if (_canReject) ..._buildRejectControls(),
        ],
      ),
    ];
  }

  String _assessmentLabel(String assessment) {
    switch (assessment) {
      case 'reviewed':
        return '独立评审';
      case 'unreviewed':
        return '未评审';
      default:
        return assessment;
    }
  }

  Widget _buildConditionRow(GoalConditionResult condition) {
    final result = condition.result ?? '未判定';
    final suffix = condition.required ? '' : '（可选）';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${condition.id} · $result · ${condition.statement}$suffix',
            style: const TextStyle(
              fontSize: 11.5,
              height: 1.45,
              color: MafwPalette.dim,
            ),
          ),
          if (condition.evidence != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                '证据：${condition.evidence}',
                style: const TextStyle(
                  fontSize: 11,
                  height: 1.4,
                  color: MafwPalette.faint,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildTaskRow(GoalTaskResult task) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        '${task.taskId} · ${task.result} · ${task.evidence}',
        style: const TextStyle(
          fontSize: 11.5,
          height: 1.45,
          color: MafwPalette.dim,
        ),
      ),
    );
  }

  bool get _canReject =>
      widget.client != null && _podId != null && _isTerminal && !_isCancelled;

  List<Widget> _buildRejectControls() {
    if (!_rejectFormOpen) {
      return [
        const Divider(height: 24),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton(
            key: const Key('goal-reject'),
            onPressed: _openRejectForm,
            child: const Text('打回'),
          ),
        ),
      ];
    }
    return [
      const Divider(height: 24),
      TextField(
        key: const Key('goal-reject-input'),
        controller: _rejectController,
        minLines: 2,
        maxLines: 4,
        style: const TextStyle(fontSize: 13, color: MafwPalette.text),
        decoration: const InputDecoration(hintText: '打回原因（必填）'),
      ),
      if (_rejectError != null)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            _rejectError!,
            style: TextStyle(
              fontSize: 11.5,
              color: Theme.of(context).colorScheme.error,
            ),
          ),
        ),
      const SizedBox(height: 8),
      Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          TextButton(
            key: const Key('goal-reject-cancel'),
            onPressed: _rejecting ? null : _closeRejectForm,
            child: const Text('取消'),
          ),
          const SizedBox(width: 8),
          FilledButton(
            key: const Key('goal-reject-submit'),
            onPressed: _rejecting ? null : () => unawaited(_submitReject()),
            child: Text(_rejecting ? '提交中…' : '提交打回'),
          ),
        ],
      ),
    ];
  }

  List<Widget> _buildTail() {
    return [
      const SizedBox(height: 20),
      SizedBox(
        width: double.infinity,
        child: FilledButton(
          key: const Key('goal-tech-lead'),
          onPressed: _onDiscussWithTechLead,
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.forum_outlined, size: 16),
              SizedBox(width: 8),
              Text('与 Tech Lead 讨论'),
            ],
          ),
        ),
      ),
      if (widget.onDiscussWithTechLead == null)
        const Padding(
          padding: EdgeInsets.only(top: 6),
          child: Center(
            child: Text(
              '讨论页将在下个版本接通',
              style: TextStyle(fontSize: 11, color: MafwPalette.faint),
            ),
          ),
        ),
    ];
  }

  Widget _buildErrorPanel(String message) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '无法加载 Goal 详情',
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
            OutlinedButton(
              key: const Key('goal-retry'),
              onPressed: () => unawaited(_load()),
              child: const Text('重试'),
            ),
          ],
        ),
      ),
    );
  }
}

// ── 小组件 ──────────────────────────────────────────────────────────────────

/// 中性标签：阶段 / revision / strategy / verdict / 评审方式共用。
class _Tag extends StatelessWidget {
  final String text;
  final bool emphasized;

  const _Tag({super.key, required this.text, this.emphasized = false});

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(
        fontSize: 11,
        fontWeight: emphasized ? FontWeight.w600 : FontWeight.w400,
        letterSpacing: 0.2,
        color: emphasized ? MafwPalette.badgeText : MafwPalette.dim,
      ),
    );
  }
}

/// 节点三态标记：done = 白实心 ✓ / active = mint 环 / pending = 灰空心 /
/// failed = 灰空心 ✕（verdict 纪律：白勾灰叉，不引入绿红）。
class _NodeMarker extends StatelessWidget {
  final GoalTimelineNodeState state;

  const _NodeMarker({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    switch (state) {
      case GoalTimelineNodeState.done:
        return Container(
          width: 18,
          height: 18,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: MafwPalette.dim, width: 1.2),
          ),
          child: const Icon(Icons.check, size: 11, color: MafwPalette.dim),
        );
      case GoalTimelineNodeState.active:
        return Container(
          width: 18,
          height: 18,
          decoration: BoxDecoration(
            color: MafwPalette.accentDim,
            shape: BoxShape.circle,
            border: Border.all(color: MafwPalette.accent, width: 2),
          ),
          child: Center(
            child: Container(
              width: 5,
              height: 5,
              decoration: const BoxDecoration(
                color: MafwPalette.accent,
                shape: BoxShape.circle,
              ),
            ),
          ),
        );
      case GoalTimelineNodeState.failed:
        return Container(
          width: 18,
          height: 18,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: MafwPalette.dim, width: 1.5),
          ),
          child: const Icon(Icons.close, size: 11, color: MafwPalette.dim),
        );
      case GoalTimelineNodeState.pending:
        return Container(
          width: 18,
          height: 18,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: MafwPalette.faint, width: 1.5),
          ),
        );
    }
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;

  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 26, bottom: 10),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 10,
          letterSpacing: 1.9,
          color: MafwPalette.dim,
        ),
      ),
    );
  }
}

class _SubTitle extends StatelessWidget {
  final String text;

  const _SubTitle(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 6),
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

class _Bullet extends StatelessWidget {
  final String text;
  final IconData icon;

  const _Bullet(this.text, {this.icon = Icons.circle});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Icon(icon, size: icon == Icons.circle ? 5 : 13, color: MafwPalette.faint),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 12,
                height: 1.45,
                color: MafwPalette.dim,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyNote extends StatelessWidget {
  final IconData icon;
  final String title;
  final String body;

  const _EmptyNote({
    super.key,
    required this.icon,
    required this.title,
    required this.body,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 4),
      child: Column(
        children: [
          Icon(icon, size: 28, color: MafwPalette.faint),
          const SizedBox(height: 10),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: MafwPalette.text,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            body,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 11.5,
              height: 1.5,
              color: MafwPalette.dim,
            ),
          ),
        ],
      ),
    );
  }
}
