/// Orcalore「工作」tab（首页）：品牌行、需要你、五桶 Goal 活动流。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.2（3-tab 结构）/ §7.3（工作 tab）/ §7.1（单一 active 项目）。
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 7。
///
/// 布局（自上而下）：
/// 1. 品牌行：Lore 20px 圆形图标 + `Orcalore` 字标（左），项目切换器（右，
///    `projects()` → 底部弹层）；
/// 2. 「现在需要你」：`presence().attention` 跨项目条目（mint 描边）+ 未看结果数；
/// 3. Lead 入口条（Task 14：解析当前项目 Pod → `ensureLeadSessionId` → 宿主用
///    裸 sessionID 打开 ChatPage）；
/// 4. 五桶活动流（needs_you / queued / in_progress / result_ready / ended，
///    中性 counts 徽标，goal 卡：title / stage / revision / strategy / verdict）；
/// 5. FAB「＋ 新建讨论」：解析项目 Pod（无 Pod 时 `podEnsure`）→ 打开 Goal
///    composer；创建成功 → `onOpenGoal(dir, goalId)` 进入 Goal 详情。
///
/// 刷新（spec §7.3）：15s 轮询 + [WorkRefreshBus]（WS 重连 / 命中事件）。
/// 事件刷新是「重拉数据 + 按 goalId 局部替换」，不重建页面状态；携带 goalId 的
/// 事件只替换涉及该 Goal 的桶，其余卡片保持原对象（由 [patchWorkOverview] 定义）。
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../models/pod_models.dart';
import '../network/gateway_client.dart';
import '../services/active_project.dart';
import '../services/work_refresh_bus.dart';
import '../theme.dart';
import 'goal_composer_page.dart';

// ── 纯词表 / 纯函数（widget 测试直接引用）──────────────────────────────────

/// 五桶的展示名（顺序 = [workBuckets]）。
const Map<String, String> kWorkBucketLabels = <String, String>{
  'needs_you': '需要你',
  'queued': '排队中',
  'in_progress': '进行中',
  'result_ready': '结果待看',
  'ended': '历史',
};

/// `PodGoalView.stageKind` → 阶段徽标文案（spec §7.3 的 discussing/planning/
/// implementing/reviewing/… 词汇）。
const Map<String, String> kWorkStageLabels = <String, String>{
  'discussing': '讨论中',
  'direction_review': '方向待裁定',
  'planning': '规划中',
  'plan_approval': '计划待批准',
  'probing': '探针中',
  'queued': '排队',
  'implementing': '实施中',
  'reviewing': '评审中',
  'result_notified': '结果已通知',
  'working': '工作中',
  'waiting': '等待',
  'blocked': '阻塞',
  'question': '待回答',
  'ended': '已结束',
};

/// 需要你条目的类别文案（`PodAttentionItem.kind`）。
String workAttentionKindLabel(String kind) {
  switch (kind) {
    case 'plan_approval':
      return '计划待批准';
    case 'direction_review':
      return '方向待裁定';
    case 'question':
      return '待回答';
    case 'blocked':
      return '被阻塞';
    default:
      return kind.isEmpty ? '需要你' : kind;
  }
}

/// 目录的 basename（项目展示名）。Windows 绝对路径同时出现 `\` 与 `/`。
String projectBasename(String dir) {
  var value = dir.trim();
  while (value.endsWith('/') || value.endsWith(r'\')) {
    value = value.substring(0, value.length - 1);
  }
  if (value.isEmpty) return dir;
  final index = value.lastIndexOf(RegExp(r'[\\/]'));
  return index >= 0 ? value.substring(index + 1) : value;
}

/// 事件触发的局部更新：只替换**包含** `goalIds` 的桶，其余桶保持 [current]
/// 的列表对象（不整页重建、不打断未受影响的卡片）。
///
/// `goalIds` 为空 = 完整快照（[fresh]）。落在其它桶的新 Goal 会等下一次轮询/整份
/// 刷新进入视图——这是「局部更新」的已知取舍（避免事件风暴下的全量重建）。
WorkOverview patchWorkOverview(
  WorkOverview current,
  WorkOverview fresh,
  Set<String> goalIds,
) {
  if (goalIds.isEmpty) return fresh;

  final groups = <String, List<PodGoalView>>{};
  final counts = <String, int>{};
  final buckets = <String>{
    ...workBuckets,
    ...current.groups.keys,
    ...fresh.groups.keys,
  };

  for (final bucket in buckets) {
    final currentRows = current.bucket(bucket);
    final freshRows = fresh.bucket(bucket);
    final touched = currentRows.any((goal) => goalIds.contains(goal.goalId)) ||
        freshRows.any((goal) => goalIds.contains(goal.goalId));
    groups[bucket] = touched ? freshRows : currentRows;
    counts[bucket] = touched
        ? (fresh.counts[bucket] ?? freshRows.length)
        : (current.counts[bucket] ?? currentRows.length);
  }

  var total = 0;
  for (final count in counts.values) {
    total += count;
  }

  return WorkOverview(
    projectDir: fresh.projectDir.isEmpty ? current.projectDir : fresh.projectDir,
    podId: fresh.podId.isEmpty ? current.podId : fresh.podId,
    groups: groups,
    counts: counts,
    total: total,
  );
}

/// 工作 tab 的渲染状态（spec §7.3 的三空态 + 网关过旧 + 连接失败）。
enum WorkTabStatus {
  loading,
  ready,
  unconfigured,
  noProject,
  noPod,
  gatewayOutdated,
  error,
}

// ── 页面 ────────────────────────────────────────────────────────────────────

class WorkTab extends StatefulWidget {
  /// Gateway client；`null` = 尚未配置连接（未配置空态）。
  final GatewayClient? client;

  /// 当前项目选择（缺省时自建一个，仅供本 tab 使用）。
  final ActiveProjectStore? activeProject;

  /// 刷新总线（`main.dart` 注入，接线 WS 重连与事件）。
  final WorkRefreshBus? refreshBus;

  /// Goal 卡片 / 需要你条目 → Goal 详情。跨项目条目会先切换 active 项目。
  final void Function(String projectId, String goalId)? onOpenGoal;

  /// FAB「＋ 新建讨论」的显式覆盖（宿主自定义入口）。
  ///
  /// 缺省时走内建流程：当前项目 → `podLookup`（404 → `podEnsure`）→
  /// [GoalComposerPage] → 成功后 `onOpenGoal(projectDir, goalId)`。
  final VoidCallback? onCreateDiscussion;

  /// Lead 对话入口（Task 14）：条点击 → 当前项目 Pod（`work.overview.podId`，
  /// 缺失时 `podLookup`）→ `ensureLeadSessionId` → 把 `(projectDir, sessionID)`
  /// 交给宿主，用「裸 sessionID」入口打开 ChatPage。
  final void Function(String projectDir, String sessionId)? onOpenLead;

  /// 「未配置」空态里的去设置入口。
  final VoidCallback? onOpenSettings;

  /// 兜底轮询间隔（spec §7.3：15s）。
  final Duration pollInterval;

  /// 事件合并窗口：事件风暴只触发一次重拉。
  final Duration refreshDebounce;

  const WorkTab({
    super.key,
    this.client,
    this.activeProject,
    this.refreshBus,
    this.onOpenGoal,
    this.onCreateDiscussion,
    this.onOpenLead,
    this.onOpenSettings,
    this.pollInterval = const Duration(seconds: 15),
    this.refreshDebounce = const Duration(milliseconds: 250),
  });

  @override
  State<WorkTab> createState() => _WorkTabState();
}

class _WorkTabState extends State<WorkTab> {
  ActiveProjectStore? _ownedStore;
  WorkRefreshBus? _ownedBus;
  WorkRefreshBus? _boundBus;

  ActiveProjectStore get _store =>
      widget.activeProject ?? (_ownedStore ??= ActiveProjectStore());
  WorkRefreshBus get _bus =>
      widget.refreshBus ?? (_ownedBus ??= WorkRefreshBus());

  List<ProjectInfo> _projects = const <ProjectInfo>[];
  String? _activeDir;
  WorkOverview? _overview;
  PresenceInfo? _presence;
  WorkTabStatus _status = WorkTabStatus.loading;
  String? _error;

  Timer? _poll;
  Timer? _debounce;
  final Set<String> _pendingGoalIds = <String>{};

  /// Lead 会话解析中（防双击并发 ensure）。
  bool _leadBusy = false;

  /// 请求代际：切换项目 / 连续刷新时丢弃过期响应。
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _bindBus();
    _startPolling();
    unawaited(_start());
  }

  @override
  void didUpdateWidget(covariant WorkTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.refreshBus, widget.refreshBus)) _bindBus();
    if (!identical(oldWidget.client, widget.client) ||
        !identical(oldWidget.activeProject, widget.activeProject)) {
      unawaited(_start());
    }
    if (oldWidget.pollInterval != widget.pollInterval) _startPolling();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _debounce?.cancel();
    _boundBus?.removeListener(_onRefreshSignal);
    _ownedBus?.dispose();
    _ownedStore?.dispose();
    super.dispose();
  }

  // ── 接线 ──

  void _bindBus() {
    final next = _bus;
    if (identical(next, _boundBus)) return;
    _boundBus?.removeListener(_onRefreshSignal);
    _boundBus = next..addListener(_onRefreshSignal);
  }

  void _startPolling() {
    _poll?.cancel();
    // The fallback poll is authoritative: it never inherits an event's goalId.
    _poll = Timer.periodic(widget.pollInterval, (_) => _onPollTick());
  }

  /// 事件 / 重连信号 → 合并窗口 → 一次重拉。
  ///
  /// [WorkRefreshBus.consumeEvent] 在信号处取走事件：事件只驱动**紧接着的一次**
  /// 局部 patch，随后总线不再保留 goalId（否则 15s 兜底轮询会退化）。
  void _onRefreshSignal() {
    final goalId = _bus.consumeEvent()?.goalId;
    if (goalId != null && goalId.isNotEmpty) _pendingGoalIds.add(goalId);
    _debounce?.cancel();
    _debounce = Timer(widget.refreshDebounce, () => unawaited(_flushRefresh()));
  }

  /// 15s 兜底轮询：全量刷新。
  ///
  /// 丢弃尚未兑现的局部 patch 目标——全量快照已覆盖它们，而且这样任何桶的新
  /// Goal 都能在一个轮询周期内出现。
  void _onPollTick() {
    _pendingGoalIds.clear();
    _debounce?.cancel();
    unawaited(_flushRefresh());
  }

  Future<void> _flushRefresh() async {
    final goals = Set<String>.of(_pendingGoalIds);
    _pendingGoalIds.clear();
    await _refresh(goals: goals);
  }

  // ── 数据 ──

  Future<void> _start() async {
    // Unconfigured gateway has nothing to fetch and nothing to remember: skip
    // project/prefs work entirely so mounting the tab offline stays inert.
    if (widget.client == null) {
      if (!mounted) return;
      _applyFailure(WorkTabStatus.unconfigured, null);
      return;
    }
    await _store.load();
    if (!mounted) return;
    await _reloadAll();
  }

  /// 全量加载：项目列表 → 当前项目 → 五桶概览 → 跨项目需要你。
  Future<void> _reloadAll() async {
    final client = widget.client;
    if (client == null) {
      _applyFailure(WorkTabStatus.unconfigured, null);
      return;
    }

    final seq = ++_seq;

    List<ProjectInfo> projects;
    try {
      projects = await client.projects();
    } on GatewayRouteMissingException catch (e) {
      _applyFailure(WorkTabStatus.gatewayOutdated, e.message, seq: seq);
      return;
    } catch (e) {
      _applyFailure(WorkTabStatus.error, _messageOf(e), seq: seq);
      return;
    }
    if (!mounted || seq != _seq) return;

    final active = _store.resolve(projects);
    if (active == null) {
      setState(() {
        _projects = projects;
        _activeDir = null;
        _overview = null;
        _presence = null;
        _status = WorkTabStatus.noProject;
        _error = null;
      });
      return;
    }

    // 记住解析出的默认值，下次启动直接恢复。
    if (_store.current() != active) unawaited(_store.set(active));
    setState(() {
      _projects = projects;
      _activeDir = active;
    });

    await _loadWork(active, seq: seq);
    if (!mounted || seq != _seq) return;
    unawaited(_loadPresence(seq));
  }

  Future<void> _loadWork(String dir, {int? seq}) async {
    final client = widget.client;
    if (client == null) return;
    final mine = seq ?? ++_seq;
    try {
      final overview = await client.workOverview(dir);
      if (!mounted || mine != _seq) return;
      setState(() {
        _overview = overview;
        _status = WorkTabStatus.ready;
        _error = null;
        _activeDir = dir;
      });
    } on NoPodException {
      if (!mounted || mine != _seq) return;
      setState(() {
        _overview = null;
        _status = WorkTabStatus.noPod;
        _error = null;
        _activeDir = dir;
      });
    } on GatewayRouteMissingException catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() {
        _overview = null;
        _status = WorkTabStatus.gatewayOutdated;
        _error = e.message;
        _activeDir = dir;
      });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() {
        _overview = null;
        _status = WorkTabStatus.error;
        _error = _messageOf(e);
        _activeDir = dir;
      });
    }
  }

  Future<void> _loadPresence(int seq) async {
    final client = widget.client;
    if (client == null) return;
    try {
      final presence = await client.presence();
      if (!mounted || seq != _seq) return;
      setState(() => _presence = presence);
    } catch (_) {
      // 需要你是附加信息：失败不影响五桶渲染，下次轮询再试。
    }
  }

  /// 重拉当前项目的五桶。`goals` 非空时只把涉及这些 Goal 的桶替换为最新数据。
  Future<void> _refresh({Set<String> goals = const <String>{}}) async {
    final client = widget.client;
    final dir = _activeDir;
    if (client == null || dir == null) {
      await _reloadAll();
      return;
    }
    final seq = ++_seq;
    try {
      final fresh = await client.workOverview(dir);
      if (!mounted || seq != _seq) return;
      final current = _overview;
      setState(() {
        _overview = current == null || _status != WorkTabStatus.ready
            ? fresh
            : patchWorkOverview(current, fresh, goals);
        _status = WorkTabStatus.ready;
        _error = null;
      });
      unawaited(_loadPresence(seq));
    } on NoPodException {
      if (!mounted || seq != _seq) return;
      setState(() {
        _overview = null;
        _status = WorkTabStatus.noPod;
      });
    } on GatewayRouteMissingException catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _overview = null;
        _status = WorkTabStatus.gatewayOutdated;
        _error = e.message;
      });
    } catch (_) {
      // 静默刷新失败：保留屏上数据，下一轮轮询重试。
    }
  }

  void _applyFailure(WorkTabStatus status, String? message, {int? seq}) {
    if (!mounted || (seq != null && seq != _seq)) return;
    setState(() {
      _status = status;
      _error = message;
      _overview = null;
      _presence = null;
    });
  }

  // ── 交互 ──

  Future<void> _switchProject(String dir) async {
    if (dir.isEmpty || dir == _activeDir) return;
    await _store.set(dir);
    if (!mounted) return;
    setState(() {
      _activeDir = dir;
      _overview = null;
      _status = WorkTabStatus.loading;
      _error = null;
    });
    await _loadWork(dir);
  }

  Future<void> _openProjectPicker() async {
    final projects = _projects;
    if (projects.isEmpty) {
      _snack('还没有已注册的项目');
      return;
    }
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Text(
                  '切换项目',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.4,
                    color: MafwPalette.dim,
                  ),
                ),
              ),
              for (final project in projects)
                ListTile(
                  key: ValueKey('work-project-option:${project.dir}'),
                  title: Text(
                    projectBasename(project.dir),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 14, color: MafwPalette.text),
                  ),
                  subtitle: Text(
                    project.dir,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: MafwPalette.faint),
                  ),
                  trailing: project.dir == _activeDir
                      ? const Icon(Icons.check, size: 18, color: MafwPalette.accent)
                      : null,
                  onTap: () => Navigator.of(sheetContext).pop(project.dir),
                ),
            ],
          ),
        );
      },
    );
    if (picked == null || !mounted) return;
    await _switchProject(picked);
  }

  /// Goal 详情入口：跨项目条目先切项目（并重拉该项目的五桶），再交给外壳导航。
  Future<void> _openGoal({required String goalId, String? projectId}) async {
    if (goalId.isEmpty) return;
    final target = (projectId != null && projectId.isNotEmpty) ? projectId : _activeDir;
    if (target == null) return;
    if (target != _activeDir) {
      await _store.set(target);
      if (!mounted) return;
      setState(() {
        _activeDir = target;
        _overview = null;
        _status = WorkTabStatus.loading;
        _error = null;
      });
      unawaited(_loadWork(target));
    }
    widget.onOpenGoal?.call(target, goalId);
  }

  /// FAB「＋ 新建讨论」：解析当前项目 Pod（无 Pod 时 ensure）→ composer →
  /// 成功创建后交给外壳打开 Goal 详情（`onOpenGoal(projectDir, goalId)`）。
  ///
  /// 错误必须可操作且可区分（Task 11）：
  /// - 网关过旧（ensure 路由缺失）→「网关版本过旧」；
  /// - 项目未注册/服务端拒绝 →「创建鲸群失败：<服务端原文>」；
  /// - 未配置 / 没有项目 → 直接说清缺什么。
  Future<void> _onCreateDiscussion() async {
    final handler = widget.onCreateDiscussion;
    if (handler != null) {
      handler();
      return;
    }

    final client = widget.client;
    if (client == null) {
      _snack('未配置 Gateway');
      return;
    }
    final dir = _store.current() ?? _activeDir;
    if (dir == null || dir.isEmpty) {
      _snack('还没有已注册的项目');
      return;
    }

    PodInfo? pod;
    try {
      pod = await client.podLookup(dir);
    } catch (e) {
      if (!mounted) return;
      _snack('读取项目失败：${goalComposerErrorMessage(e)}');
      return;
    }

    if (pod == null) {
      // `podLookup` 对「项目没有 Pod」和「网关过旧」都返回 404；ensure 的
      // 404 分类（GatewayRouteMissingException）才是这两者的权威区分点。
      try {
        pod = await client.podEnsure(dir);
      } on GatewayRouteMissingException {
        if (!mounted) return;
        _snack('网关版本过旧：缺少创建鲸群的路由，请升级 gateway 后重试');
        return;
      } catch (e) {
        if (!mounted) return;
        _snack('创建鲸群失败：${goalComposerErrorMessage(e)}');
        return;
      }
      // Pod 刚建好：即使用户取消 composer，「这个项目还没有鲸群」也不该继续
      // 挂在屏上（15s 轮询会迟到）。
      if (!mounted) return;
      unawaited(_refresh());
    }

    if (!mounted) return;
    if (pod.id.isEmpty) {
      _snack('创建鲸群失败：网关没有返回 Pod id');
      return;
    }
    final podId = pod.id;

    CreateGoalResult? created;
    await Navigator.of(context).push<CreateGoalResult>(
      MaterialPageRoute(
        builder: (_) => GoalComposerPage(
          podId,
          client: client,
          onCreated: (result) => created = result,
        ),
      ),
    );
    if (!mounted) return;

    final result = created;
    if (result == null || result.goalId.isEmpty) return;
    // 新 Goal 立刻出现在活动流里（用户从详情返回时不用等下一次 15s 轮询）。
    unawaited(_refresh());
    widget.onOpenGoal?.call(dir, result.goalId);
  }

  void _onOpenLead() {
    final handler = widget.onOpenLead;
    if (handler == null) {
      _snack('Lead 对话入口未接通');
      return;
    }
    unawaited(_openLead(handler));
  }

  /// Lead 条（Task 14）：Pod 解析 + `ensureLeadSessionId` 之后再交给宿主，
  /// 失败全部落成可操作提示（未配置 / 无项目 / 无 Pod / 网关过旧）。
  Future<void> _openLead(
    void Function(String projectDir, String sessionId) handler,
  ) async {
    if (_leadBusy) return;
    final client = widget.client;
    if (client == null) {
      _snack('未配置 Gateway');
      return;
    }
    final dir = _activeDir ?? _store.current();
    if (dir == null || dir.isEmpty) {
      _snack('还没有已注册的项目');
      return;
    }

    setState(() => _leadBusy = true);
    try {
      // 当前项目的 Pod 就在五桶概览里，先省一次往返；概览缺失（还没有 Pod /
      // 加载失败）时再 lookup 一次。
      var podId = _overview?.podId ?? '';
      if (podId.isEmpty) {
        try {
          podId = (await client.podLookup(dir))?.id ?? '';
        } on GatewayRouteMissingException {
          if (!mounted) return;
          _snack('网关版本过旧：缺少 Pod 路由，请升级 gateway 后重试');
          return;
        } catch (e) {
          if (!mounted) return;
          _snack('读取项目失败：${_messageOf(e) ?? e}');
          return;
        }
      }
      if (podId.isEmpty) {
        if (!mounted) return;
        _snack('这个项目还没有鲸群，先在桌面端创建鲸群');
        return;
      }

      final sessionID = await client.ensureLeadSessionId(podId);
      if (!mounted) return;
      handler(dir, sessionID);
    } on GatewayRouteMissingException {
      if (!mounted) return;
      _snack('网关版本过旧：缺少 Lead 会话路由，请升级 gateway 后重试');
    } on GatewayException catch (e) {
      if (!mounted) return;
      _snack(e.statusCode == 404
          ? '网关版本过旧：缺少 Lead 会话路由，请升级 gateway 后重试'
          : '打开 Lead 会话失败：${_messageOf(e) ?? e}');
    } catch (e) {
      if (!mounted) return;
      _snack('打开 Lead 会话失败：${_messageOf(e) ?? e}');
    } finally {
      if (mounted) setState(() => _leadBusy = false);
    }
  }

  void _snack(String message) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message), duration: const Duration(seconds: 2)));
  }

  String? _messageOf(Object error) {
    final text = error is GatewayException ? error.message : error.toString();
    return text.isEmpty ? null : text;
  }

  // ── 渲染 ──

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () => _refresh(),
      color: MafwPalette.accent,
      backgroundColor: MafwPalette.black,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(MafwSpace.xl, 20, MafwSpace.xl, MafwSpace.xxl),
        children: _buildChildren(),
      ),
    );
  }

  List<Widget> _buildChildren() {
    final children = <Widget>[
      _buildMasthead(),
      const SizedBox(height: MafwSpace.xxl),
    ];

    final presence = _presence;
    final attention = presence?.attention ?? const <AttentionItem>[];
    final unread = presence?.unreadResultsCount ?? 0;
    if (attention.isNotEmpty || unread > 0) {
      children.addAll(_buildAttentionSection(attention, unread));
      children.add(const SizedBox(height: MafwSpace.xxl));
    }

    children.add(_buildLeadEntry());
    children.add(const SizedBox(height: MafwSpace.xxl));

    if (_status == WorkTabStatus.loading && _overview == null) {
      children.add(const _WorkSkeleton());
      return children;
    }
    if (_overview == null) {
      children.add(_buildEmptyState());
      return children;
    }

    children.addAll(_buildBuckets());
    return children;
  }

  String _dateLabel() {
    final now = DateTime.now();
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    final mm = now.month.toString().padLeft(2, '0');
    final dd = now.day.toString().padLeft(2, '0');
    return '$mm.$dd  ${days[now.weekday - 1]}';
  }

  Widget _buildMasthead() {
    final active = _activeDir;
    final name = active == null || active.isEmpty ? '未选择项目' : projectBasename(active);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            ClipOval(
              child: Image.asset(
                'assets/lore/Lore_avatar_20.png',
                width: 18,
                height: 18,
                filterQuality: FilterQuality.medium,
                // fail-open：资源缺失时品牌位仍可用（测试另有 asset bundle 断言）。
                errorBuilder: (_, _, _) =>
                    const Icon(Icons.spa_outlined, size: 16, color: MafwPalette.accent),
              ),
            ),
            const SizedBox(width: MafwSpace.sm),
            const Text(
              'ORCALORE',
              style: TextStyle(
                fontSize: 9,
                letterSpacing: 2.2,
                color: MafwPalette.faint,
              ),
            ),
            const Spacer(),
            Text(
              _dateLabel(),
              style: const TextStyle(
                fontSize: 9,
                letterSpacing: 1.2,
                color: MafwPalette.faint,
                fontFamily: 'monospace',
              ),
            ),
            const SizedBox(width: 12),
            Semantics(
              button: true,
              label: '新建讨论',
              child: InkWell(
                key: const Key('work-new-discussion'),
                onTap: () => unawaited(_onCreateDiscussion()),
                customBorder: const CircleBorder(),
                child: Container(
                  width: 26,
                  height: 26,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: MafwPalette.border),
                  ),
                  child: const Icon(Icons.add, size: 14, color: MafwPalette.text),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        const Text(
          'Orcalore',
          style: TextStyle(
            fontFamily: MafwFonts.serif,
            fontSize: MafwType.display,
            height: 1.0,
            letterSpacing: -1.6,
            color: MafwPalette.text,
          ),
        ),
        const SizedBox(height: 13),
        Semantics(
          // container: 独立语义节点，避免和左侧字标合并成一个不可聚焦的整体。
          container: true,
          button: true,
          label: '切换项目，当前 $name',
          // excludeSemantics 会连同 InkWell 的 tap 动作一起裁掉，必须显式补回。
          onTap: _openProjectPicker,
          excludeSemantics: true,
          child: InkWell(
            key: const Key('work-project-switcher'),
            onTap: _openProjectPicker,
            borderRadius: BorderRadius.circular(4),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: MafwType.meta,
                        fontWeight: FontWeight.w500,
                        color: MafwPalette.text,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  const Text(
                    '›',
                    style: TextStyle(fontSize: 17, height: 1, color: MafwPalette.faint),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 15),
        const Divider(height: 1, color: MafwPalette.border),
      ],
    );
  }

  List<Widget> _buildAttentionSection(List<AttentionItem> items, int unread) {
    if (items.isEmpty) {
      return [_buildUnreadRow(unread)];
    }
    final widgets = <Widget>[
      _Overline(label: '现在需要你', count: items.length, accent: true),
      const SizedBox(height: MafwSpace.sm),
      Container(
        decoration: const BoxDecoration(
          border: Border(left: BorderSide(color: MafwPalette.accent, width: 2)),
        ),
        padding: const EdgeInsets.only(left: 14),
        child: Column(
          children: [
            for (var i = 0; i < items.length; i++) ...[
              _AttentionRow(
                item: items[i],
                subtitle: _attentionSubtitle(items[i]),
                onTap: () => unawaited(_openGoal(
                  goalId: items[i].goalId,
                  projectId: items[i].projectId,
                )),
              ),
              if (i != items.length - 1)
                const Divider(height: 1, color: MafwPalette.border),
            ],
          ],
        ),
      ),
    ];
    if (unread > 0) {
      widgets.add(_buildUnreadRow(unread));
    }
    return widgets;
  }

  String _attentionSubtitle(AttentionItem item) {
    final project = item.projectId;
    final crossProject = project != null && project.isNotEmpty && project != _activeDir;
    return crossProject
        ? '${workAttentionKindLabel(item.kind)} · ${projectBasename(project)}'
        : workAttentionKindLabel(item.kind);
  }

  Widget _buildUnreadRow(int unread) {
    return InkWell(
      key: const Key('work-unread-row'),
      onTap: () => unawaited(_openResultsSheet()),
      child: Padding(
        padding: const EdgeInsets.only(top: 14, bottom: 4, left: 14),
        child: Row(
          children: [
            Text(
              '$unread 个结果待查看',
              style: const TextStyle(fontSize: MafwType.meta, color: MafwPalette.dim),
            ),
            const SizedBox(width: 6),
            const Text(
              '›',
              style: TextStyle(fontSize: 15, height: 1, color: MafwPalette.faint),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLeadEntry() {
    return InkWell(
      key: const Key('work-lead-entry'),
      onTap: _onOpenLead,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: const BoxDecoration(
          border: Border(
            top: BorderSide(color: MafwPalette.border),
            bottom: BorderSide(color: MafwPalette.border),
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 26,
              height: 26,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: MafwPalette.border),
              ),
              child: _leadBusy
                  ? const SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(strokeWidth: 1.5),
                    )
                  : const Text(
                      'L',
                      style: TextStyle(
                        fontSize: 10,
                        fontFamily: 'monospace',
                        color: MafwPalette.dim,
                      ),
                    ),
            ),
            const SizedBox(width: MafwSpace.md),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '跟 Lead 说件事',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: MafwPalette.text,
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    '讨论，或交给 Lead 推进',
                    style: TextStyle(fontSize: 11, color: MafwPalette.dim),
                  ),
                ],
              ),
            ),
            const Text(
              '›',
              style: TextStyle(fontSize: 18, height: 1, color: MafwPalette.faint),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildBuckets() {
    final overview = _overview!;
    final widgets = <Widget>[];
    for (final bucket in const ['needs_you', 'in_progress', 'result_ready', 'queued']) {
      final rows = overview.bucket(bucket);
      if (rows.isEmpty) continue;
      final count = overview.counts[bucket] ?? rows.length;
      widgets.add(_BucketHeader(label: kWorkBucketLabels[bucket] ?? bucket, count: count));
      for (final goal in rows) {
        widgets.add(_GoalRow(
          key: ValueKey('work-goal:${goal.goalId}'),
          goal: goal,
          bucket: bucket,
          onTap: () => unawaited(_openGoal(goalId: goal.goalId)),
        ));
      }
      widgets.add(const SizedBox(height: MafwSpace.xxl));
    }

    final ended = overview.bucket('ended');
    final endedCount = overview.counts['ended'] ?? ended.length;
    if (endedCount > 0) {
      widgets.add(_HistoryRow(count: endedCount, onTap: () => unawaited(_openHistorySheet())));
    }
    if (widgets.isEmpty) {
      widgets.add(const _QuietEmpty());
    }
    return widgets;
  }

  Widget _buildEmptyState() {
    switch (_status) {
      case WorkTabStatus.unconfigured:
        return _EmptyPanel(
          title: '未配置 Gateway',
          body: '在「我的」里填写地址或扫码配对后，这里会显示项目工作流。',
          actionLabel: widget.onOpenSettings == null ? null : '去设置',
          onAction: widget.onOpenSettings,
        );
      case WorkTabStatus.noProject:
        return const _EmptyPanel(
          title: '还没有已注册的项目',
          body: '在桌面端注册一个项目，或在「我的」里重新配对连接。',
        );
      case WorkTabStatus.noPod:
        return const _EmptyPanel(
          title: '这个项目还没有鲸群',
          body: '在桌面端为该项目创建鲸群（Pod）；创建后这里会显示 Goal 活动流。',
        );
      case WorkTabStatus.gatewayOutdated:
        return _EmptyPanel(
          title: '网关版本过旧',
          body: '当前 gateway 还没有工作视图路由，请升级后再试（桌面端自更新或 `mafw update`）。',
          actionLabel: '重试',
          onAction: () => unawaited(_reloadAll()),
        );
      case WorkTabStatus.error:
        return _EmptyPanel(
          title: '无法连接 Gateway',
          body: _error ?? '请求失败，请检查连接后重试。',
          actionLabel: '重试',
          onAction: () => unawaited(_reloadAll()),
        );
      case WorkTabStatus.loading:
      case WorkTabStatus.ready:
        return const SizedBox.shrink();
    }
  }

  Future<void> _openResultsSheet() async {
    final results = _overview?.groups['result_ready'] ?? const <PodGoalView>[];
    await _openGoalSheet(
      title: '结果待查看',
      goals: results,
      emptyText: '当前项目没有可打开的结果；未读结果可能在其它项目。',
      keyPrefix: 'work-unread-goal',
    );
  }

  Future<void> _openHistorySheet() async {
    final ended = _overview?.groups['ended'] ?? const <PodGoalView>[];
    await _openGoalSheet(
      title: '历史',
      goals: ended,
      emptyText: '这个项目还没有已结束的 Goal。',
      keyPrefix: 'work-history-goal',
    );
  }

  Future<void> _openGoalSheet({
    required String title,
    required List<PodGoalView> goals,
    required String emptyText,
    required String keyPrefix,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: MafwPalette.black,
      isScrollControlled: true,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              MafwSpace.xl,
              MafwSpace.xl,
              MafwSpace.xl,
              MafwSpace.sm,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontFamily: MafwFonts.serif,
                    fontSize: 26,
                    height: 1.1,
                    color: MafwPalette.text,
                  ),
                ),
                const SizedBox(height: MafwSpace.md),
                if (goals.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: MafwSpace.md),
                    child: Text(
                      emptyText,
                      style: const TextStyle(
                        fontSize: 12,
                        height: 1.5,
                        color: MafwPalette.dim,
                      ),
                    ),
                  )
                else
                  Flexible(
                    child: ListView(
                      shrinkWrap: true,
                      children: [
                        for (final goal in goals)
                          _SheetGoalRow(
                            key: Key('$keyPrefix-${goal.goalId}'),
                            goal: goal,
                            onTap: () {
                              Navigator.of(sheetContext).pop();
                              unawaited(_openGoal(goalId: goal.goalId));
                            },
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _Overline extends StatelessWidget {
  final String label;
  final int? count;
  final bool accent;

  const _Overline({
    required this.label,
    this.count,
    this.accent = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: MafwType.overline,
            letterSpacing: 1.9,
            color: accent ? MafwPalette.accent : MafwPalette.dim,
          ),
        ),
        if (count != null) ...[
          const SizedBox(width: MafwSpace.sm),
          Text(
            count!.toString().padLeft(2, '0'),
            style: const TextStyle(
              fontSize: 9,
              letterSpacing: 0.5,
              fontFamily: 'monospace',
              color: MafwPalette.faint,
            ),
          ),
        ],
      ],
    );
  }
}

class _BucketHeader extends StatelessWidget {
  final String label;
  final int count;

  const _BucketHeader({required this.label, required this.count});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: MafwSpace.xs),
      child: _Overline(label: label, count: count),
    );
  }
}

class _AttentionRow extends StatelessWidget {
  final AttentionItem item;
  final String subtitle;
  final VoidCallback onTap;

  const _AttentionRow({
    required this.item,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 13),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title.isEmpty ? '需要你' : item.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      height: 1.3,
                      color: MafwPalette.text,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    style: const TextStyle(fontSize: 11, color: MafwPalette.dim),
                  ),
                ],
              ),
            ),
            const SizedBox(width: MafwSpace.sm),
            const Text(
              '›',
              style: TextStyle(fontSize: 18, height: 1, color: MafwPalette.faint),
            ),
          ],
        ),
      ),
    );
  }
}

class _GoalRow extends StatelessWidget {
  final PodGoalView goal;
  final String bucket;
  final VoidCallback onTap;

  const _GoalRow({
    super.key,
    required this.goal,
    required this.bucket,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final active = bucket == 'in_progress';
    final stage = kWorkStageLabels[goal.stageKind ?? ''] ?? (goal.stageKind ?? '');
    final strategy = goal.strategy ?? '';
    final verdict = goal.verdict ?? '';
    final meta = [
      if (stage.isNotEmpty) stage,
      'r${goal.revision}',
      if (strategy.isNotEmpty) strategy,
    ].join(' · ');
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 13),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: MafwPalette.border)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 6,
              height: 6,
              margin: const EdgeInsets.only(top: 7),
              decoration: BoxDecoration(
                color: active ? MafwPalette.accent : Colors.transparent,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    goal.title.isEmpty ? '未命名目标' : goal.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                      height: 1.3,
                      color: MafwPalette.text,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          meta,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 11, color: MafwPalette.dim),
                        ),
                      ),
                      if (verdict.isNotEmpty) ...[
                        const SizedBox(width: MafwSpace.sm),
                        Text(
                          verdict,
                          style: const TextStyle(
                            fontSize: 9,
                            letterSpacing: 0.8,
                            color: MafwPalette.badgeText,
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 6),
            const Text(
              '›',
              style: TextStyle(fontSize: 18, height: 1, color: MafwPalette.faint),
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryRow extends StatelessWidget {
  final int count;
  final VoidCallback onTap;

  const _HistoryRow({required this.count, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      key: const Key('work-history-row'),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 15),
        child: Row(
          children: [
            const Text(
              '历史',
              style: TextStyle(fontSize: MafwType.meta, color: MafwPalette.dim),
            ),
            const Spacer(),
            Text(
              count.toString().padLeft(2, '0'),
              style: const TextStyle(
                fontSize: 9,
                fontFamily: 'monospace',
                color: MafwPalette.faint,
              ),
            ),
            const SizedBox(width: 6),
            const Text(
              '›',
              style: TextStyle(fontSize: 16, height: 1, color: MafwPalette.faint),
            ),
          ],
        ),
      ),
    );
  }
}

class _SheetGoalRow extends StatelessWidget {
  final PodGoalView goal;
  final VoidCallback onTap;

  const _SheetGoalRow({super.key, required this.goal, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final stage = kWorkStageLabels[goal.stageKind ?? ''] ?? (goal.stageKind ?? '');
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 13),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: MafwPalette.border)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    goal.title.isEmpty ? '未命名目标' : goal.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 14, color: MafwPalette.text),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    [
                      if (stage.isNotEmpty) stage,
                      'r${goal.revision}',
                      if ((goal.verdict ?? '').isNotEmpty) goal.verdict!,
                    ].join(' · '),
                    style: const TextStyle(fontSize: 11, color: MafwPalette.dim),
                  ),
                ],
              ),
            ),
            const Text(
              '›',
              style: TextStyle(fontSize: 18, height: 1, color: MafwPalette.faint),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuietEmpty extends StatelessWidget {
  const _QuietEmpty();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: MafwSpace.xl),
      child: Text(
        '这个项目暂时没有活动中的 Goal。',
        style: TextStyle(fontSize: 12, color: MafwPalette.dim),
      ),
    );
  }
}

class _EmptyPanel extends StatelessWidget {
  final String title;
  final String body;
  final String? actionLabel;
  final VoidCallback? onAction;

  const _EmptyPanel({
    required this.title,
    required this.body,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: MafwSpace.xxl, horizontal: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'STATUS',
            style: TextStyle(
              fontSize: 9,
              letterSpacing: 2.2,
              color: MafwPalette.faint,
            ),
          ),
          const SizedBox(height: MafwSpace.md),
          Text(
            title,
            style: const TextStyle(
              fontSize: MafwType.heading,
              fontWeight: FontWeight.w600,
              color: MafwPalette.text,
            ),
          ),
          const SizedBox(height: MafwSpace.sm),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 300),
            child: Text(
              body,
              style: const TextStyle(fontSize: 12, height: 1.6, color: MafwPalette.dim),
            ),
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: MafwSpace.lg),
            TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                foregroundColor: MafwPalette.text,
                padding: const EdgeInsets.symmetric(horizontal: 0, vertical: 6),
                minimumSize: const Size(0, 36),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Text('$actionLabel  ›'),
            ),
          ],
        ],
      ),
    );
  }
}

class _WorkSkeleton extends StatelessWidget {
  const _WorkSkeleton();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '正在加载项目工作流',
      child: Column(
        key: const Key('work-loading-skeleton'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SkeletonBar(width: 82, height: 9),
          const SizedBox(height: 14),
          for (var i = 0; i < 4; i++)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 15),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: MafwPalette.border)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SkeletonBar(width: 190, height: 12),
                  const SizedBox(height: 8),
                  const _SkeletonBar(width: 110, height: 8),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _SkeletonBar extends StatelessWidget {
  final double width;
  final double height;

  const _SkeletonBar({required this.width, this.height = 10});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: MafwPalette.badgeBg,
        borderRadius: BorderRadius.circular(3),
      ),
    );
  }
}
