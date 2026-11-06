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
/// 3. Lead 入口条（占位，Task 14 接通）；
/// 4. 五桶活动流（needs_you / queued / in_progress / result_ready / ended，
///    中性 counts 徽标，goal 卡：title / stage / revision / strategy / verdict）；
/// 5. FAB「＋ 新建讨论」（占位，Task 11 接 composer）。
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

  /// FAB「＋ 新建讨论」（Task 11 接 composer；缺省提示）。
  final VoidCallback? onCreateDiscussion;

  /// Lead 入口条（Task 14 接通；缺省提示）。
  final VoidCallback? onOpenLead;

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
    _poll = Timer.periodic(widget.pollInterval, (_) => _onRefreshSignal());
  }

  /// 刷新信号（轮询 / 重连 / 事件）→ 合并窗口 → 一次重拉。
  void _onRefreshSignal() {
    final goalId = _bus.lastEvent?.goalId;
    if (goalId != null && goalId.isNotEmpty) _pendingGoalIds.add(goalId);
    _debounce?.cancel();
    _debounce = Timer(widget.refreshDebounce, () => unawaited(_flushRefresh()));
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

  void _onCreateDiscussion() {
    final handler = widget.onCreateDiscussion;
    if (handler != null) {
      handler();
      return;
    }
    _snack('新建讨论将在下一版本启用');
  }

  void _onOpenLead() {
    final handler = widget.onOpenLead;
    if (handler != null) {
      handler();
      return;
    }
    _snack('Lead 对话将在下一版本接通');
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
    return SafeArea(
      child: Stack(
        children: [
          RefreshIndicator(
            onRefresh: () => _refresh(),
            color: MafwPalette.accent,
            backgroundColor: MafwPalette.surface,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
              children: _buildChildren(),
            ),
          ),
          Positioned(
            right: 16,
            bottom: 16,
            child: FloatingActionButton.extended(
              key: const Key('work-fab'),
              onPressed: _onCreateDiscussion,
              icon: const Icon(Icons.add, size: 20),
              label: const Text(
                '新建讨论',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _buildChildren() {
    final children = <Widget>[_buildBrandRow(), const SizedBox(height: 18)];

    final presence = _presence;
    final attention = presence?.attention ?? const <AttentionItem>[];
    final unread = presence?.unreadResultsCount ?? 0;
    if (attention.isNotEmpty || unread > 0) {
      children.addAll(_buildAttentionSection(attention, unread));
      children.add(const SizedBox(height: 4));
    }

    children.add(_buildLeadEntry());
    children.add(const SizedBox(height: 18));

    if (_status == WorkTabStatus.loading && _overview == null) {
      children.add(const Padding(
        padding: EdgeInsets.symmetric(vertical: 48),
        child: Center(child: CircularProgressIndicator()),
      ));
      return children;
    }
    if (_overview == null) {
      children.add(_buildEmptyState());
      return children;
    }

    children.addAll(_buildBuckets());
    return children;
  }

  Widget _buildBrandRow() {
    final active = _activeDir;
    final name = active == null || active.isEmpty ? '未选择项目' : projectBasename(active);
    return Row(
      children: [
        ClipOval(
          child: Image.asset(
            'assets/lore/Lore_avatar_20.png',
            width: 22,
            height: 22,
            filterQuality: FilterQuality.medium,
            // fail-open：资源缺失时品牌位仍可用（测试另有 asset bundle 断言）。
            errorBuilder: (_, _, _) =>
                const Icon(Icons.spa_outlined, size: 20, color: MafwPalette.accent),
          ),
        ),
        const SizedBox(width: 8),
        const Text(
          'Orcalore',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.2,
            color: MafwPalette.text,
          ),
        ),
        const Spacer(),
        Flexible(
          child: InkWell(
            key: const Key('work-project-switcher'),
            onTap: _openProjectPicker,
            borderRadius: BorderRadius.circular(999),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: MafwPalette.badgeBg,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: MafwPalette.border),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12, color: MafwPalette.badgeText),
                    ),
                  ),
                  const SizedBox(width: 4),
                  const Icon(Icons.unfold_more, size: 14, color: MafwPalette.dim),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  List<Widget> _buildAttentionSection(List<AttentionItem> items, int unread) {
    final widgets = <Widget>[
      Row(
        children: [
          const Text(
            '现在需要你',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: MafwPalette.text),
          ),
          const SizedBox(width: 8),
          if (items.isNotEmpty) _CountBadge(count: items.length, accent: true),
        ],
      ),
      const SizedBox(height: 8),
    ];

    for (final item in items) {
      final project = item.projectId;
      final crossProject = project != null && project.isNotEmpty && project != _activeDir;
      final subtitle = crossProject
          ? '${workAttentionKindLabel(item.kind)} · ${projectBasename(project)}'
          : workAttentionKindLabel(item.kind);
      widgets.add(_AttentionCard(
        item: item,
        subtitle: subtitle,
        onTap: () => unawaited(_openGoal(goalId: item.goalId, projectId: item.projectId)),
      ));
    }

    if (unread > 0) {
      widgets.add(Padding(
        padding: const EdgeInsets.only(top: 2, bottom: 10),
        child: Row(
          children: [
            const Icon(Icons.inbox_outlined, size: 14, color: MafwPalette.dim),
            const SizedBox(width: 6),
            Text(
              '$unread 个结果待查看',
              style: const TextStyle(fontSize: 12, color: MafwPalette.dim),
            ),
          ],
        ),
      ));
    }
    return widgets;
  }

  Widget _buildLeadEntry() {
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        key: const Key('work-lead-entry'),
        leading: const CircleAvatar(
          radius: 14,
          backgroundColor: MafwPalette.badgeBg,
          child: Text(
            'L',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: MafwPalette.text),
          ),
        ),
        title: const Text(
          '跟 Lead 说件事',
          style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: MafwPalette.text),
        ),
        subtitle: const Text(
          'Lead 对话将在下一版本接通',
          style: TextStyle(fontSize: 11, color: MafwPalette.dim),
        ),
        trailing: const Icon(Icons.chevron_right, size: 18, color: MafwPalette.faint),
        onTap: _onOpenLead,
      ),
    );
  }

  List<Widget> _buildBuckets() {
    final overview = _overview!;
    final widgets = <Widget>[];
    for (final bucket in workBuckets) {
      final rows = overview.bucket(bucket);
      final count = overview.counts[bucket] ?? rows.length;
      widgets.add(_BucketHeader(label: kWorkBucketLabels[bucket] ?? bucket, count: count));
      for (final goal in rows) {
        widgets.add(_GoalCard(
          key: ValueKey('work-goal:${goal.goalId}'),
          goal: goal,
          bucket: bucket,
          onTap: () => unawaited(_openGoal(goalId: goal.goalId)),
        ));
      }
      widgets.add(const SizedBox(height: 10));
    }
    return widgets;
  }

  Widget _buildEmptyState() {
    switch (_status) {
      case WorkTabStatus.unconfigured:
        return _EmptyPanel(
          icon: Icons.cloud_off_outlined,
          title: '未配置 Gateway',
          body: '在「我的」里填写地址或扫码配对后，这里会显示项目工作流。',
          actionLabel: widget.onOpenSettings == null ? null : '去设置',
          onAction: widget.onOpenSettings,
        );
      case WorkTabStatus.noProject:
        return const _EmptyPanel(
          icon: Icons.folder_open_outlined,
          title: '还没有已注册的项目',
          body: '在桌面端注册一个项目，或在「我的」里重新配对连接。',
        );
      case WorkTabStatus.noPod:
        return const _EmptyPanel(
          icon: Icons.workspaces_outline,
          title: '这个项目还没有鲸群',
          body: '在桌面端为该项目创建鲸群（Pod）；创建后这里会显示 Goal 活动流。',
        );
      case WorkTabStatus.gatewayOutdated:
        return _EmptyPanel(
          icon: Icons.system_update_alt,
          title: '网关版本过旧',
          body: '当前 gateway 还没有工作视图路由，请升级后再试（桌面端自更新或 `mafw update`）。',
          actionLabel: '重试',
          onAction: () => unawaited(_reloadAll()),
        );
      case WorkTabStatus.error:
        return _EmptyPanel(
          icon: Icons.cloud_off_outlined,
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
}

// ── 小组件 ──────────────────────────────────────────────────────────────────

class _CountBadge extends StatelessWidget {
  final int count;
  final bool accent;

  const _CountBadge({required this.count, this.accent = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
      decoration: BoxDecoration(
        color: accent ? MafwPalette.accentDim : MafwPalette.badgeBg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: accent ? MafwPalette.accent.withValues(alpha: 0.45) : MafwPalette.border,
        ),
      ),
      child: Text(
        '$count',
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w600,
          color: accent ? MafwPalette.accent : MafwPalette.badgeText,
        ),
      ),
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
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: MafwPalette.text,
            ),
          ),
          const SizedBox(width: 8),
          _CountBadge(count: count),
        ],
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  final String text;
  final bool emphasized;

  const _MetaChip({required this.text, this.emphasized = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: MafwPalette.badgeBg,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: MafwPalette.border),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 10,
          fontWeight: emphasized ? FontWeight.w700 : FontWeight.w500,
          color: MafwPalette.badgeText,
        ),
      ),
    );
  }
}

class _GoalCard extends StatelessWidget {
  final PodGoalView goal;
  final String bucket;
  final VoidCallback onTap;

  const _GoalCard({
    super.key,
    required this.goal,
    required this.bucket,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final stage = kWorkStageLabels[goal.stageKind ?? ''] ?? (goal.stageKind ?? '');
    final strategy = goal.strategy ?? '';
    final verdict = goal.verdict ?? '';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  // mint 只表示「进行中」这一种激活态（徽标本身保持中性）。
                  if (bucket == 'in_progress') ...[
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(
                        color: MafwPalette.accent,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                  ],
                  Expanded(
                    child: Text(
                      goal.title.isEmpty ? '未命名目标' : goal.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        height: 1.35,
                        color: MafwPalette.text,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  if (stage.isNotEmpty) _MetaChip(text: stage),
                  _MetaChip(text: 'r${goal.revision}'),
                  if (strategy.isNotEmpty) _MetaChip(text: strategy),
                  if (verdict.isNotEmpty) _MetaChip(text: verdict, emphasized: true),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AttentionCard extends StatelessWidget {
  final AttentionItem item;
  final String subtitle;
  final VoidCallback onTap;

  const _AttentionCard({
    required this.item,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: MafwPalette.accentDim,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: MafwPalette.accent.withValues(alpha: 0.45)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            child: Row(
              children: [
                const Icon(Icons.priority_high, size: 18, color: MafwPalette.accent),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.title.isEmpty ? '需要你' : item.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          height: 1.35,
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
                const Icon(Icons.chevron_right, size: 18, color: MafwPalette.faint),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptyPanel extends StatelessWidget {
  final IconData icon;
  final String title;
  final String body;
  final String? actionLabel;
  final VoidCallback? onAction;

  const _EmptyPanel({
    required this.icon,
    required this.title,
    required this.body,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 8),
      child: Column(
        children: [
          Icon(icon, size: 36, color: MafwPalette.faint),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: MafwPalette.text,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            body,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, height: 1.5, color: MafwPalette.dim),
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
      ),
    );
  }
}
