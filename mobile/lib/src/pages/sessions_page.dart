import 'dart:async';

import 'package:flutter/material.dart';

import '../config/app_info.dart';
import '../models/mafw_models.dart';
import '../models/session_list_events.dart';
import '../network/gateway_client.dart';
import '../services/active_project.dart';
import '../services/diagnostics.dart';
import '../services/lead_handoff.dart';
import '../services/work_refresh_bus.dart';
import '../theme.dart';
import '../widgets/mafw_bottom_nav.dart';
import 'debug_page.dart';
import 'work_tab.dart';

/// Orcalore 底部 Tab 枚举（3-tab 结构，spec §7.2）。
///
/// - [work]：首页，工作活动流（Task 7 填充 [WorkTab]）
/// - [chat]：普通会话列表（自由讨论 / 新话题）
/// - [me]：连接设置 + 扫码配对 + 记忆检索
///
/// 旧 4-tab（会话 / Goal / 记忆 / 我的）里的 Goal tab 已退役：Goal 只从
/// 「工作」tab 的 Goal 卡片 / 需要你进入（Task 7 接通）。记忆检索迁入 [me]。
enum SessionsTab { work, chat, me }

/// 聊天 tab「新话题」：在 **active 项目目录** 创建会话（spec §7.7）。
///
/// 不传 `directory` 时 gateway 会把 enriched 消息落到第一个注册项目——跨项目
/// 语义不可接受，所以目录是必填参数；调用方先在「工作」tab 选好项目。
Future<MafwSession> createTopicSession(
  GatewayClient client, {
  required String directory,
}) async {
  final id = await client.createSession(directory: directory);
  if (id.isEmpty) {
    throw GatewayException('createSession: gateway returned no session id');
  }
  return MafwSession(
    id: id,
    title: '新话题',
    projectID: directory,
    directory: directory,
  );
}

/// 底部 Tab 导航页（3-tab：工作 / 聊天 / 我的）。
class SessionsPage extends StatefulWidget {
  final List<MafwSession> sessions;
  final void Function(MafwSession) onOpen;
  final void Function() onSettings;
  final Future<void> Function()? onScan;
  final void Function()? onTriage;
  final bool isOffline;
  final String? baseUrl;
  final bool isConnecting;
  final GatewayClient? client;
  final DiagnosticsSink? diagnostics;
  final bool Function()? wsConnected;

  /// 当前项目选择（「工作」tab 的项目切换器持久化在这里）。
  final ActiveProjectStore? activeProject;

  /// 工作 tab 刷新总线（`main.dart` 接 WS 重连与事件）。
  final WorkRefreshBus? refreshBus;

  /// 工作 tab 的 Goal 详情入口（`main.dart` 负责导航）。
  final void Function(String projectId, String goalId)? onOpenGoal;

  /// 工作 tab 的 Lead 对话入口（Task 14）：`(projectDir, sessionID)`，宿主持有
  /// ws / cache，用 ChatPage 的裸 sessionID 入口打开。
  final void Function(String projectDir, String sessionId)? onOpenLead;

  /// 「＋ 新建讨论」占位（Task 11 接 composer）。
  final VoidCallback? onCreateDiscussion;

  /// Live gateway event stream（`main.dart` 传 `_ws?.events`）。
  ///
  /// 可选：旧壳 / 未连接时传 null，聊天列表维持「显式动作才拉取」的老行为。
  /// WS 重建后 `main.dart` 会用新的 stream 重建页面，`didUpdateWidget` 重订阅。
  final Stream<MafwEvent>? events;

  const SessionsPage({
    super.key,
    required this.sessions,
    required this.onOpen,
    required this.onSettings,
    this.onScan,
    this.onTriage,
    this.isOffline = false,
    this.baseUrl,
    this.isConnecting = false,
    this.client,
    this.diagnostics,
    this.wsConnected,
    this.activeProject,
    this.refreshBus,
    this.onOpenGoal,
    this.onOpenLead,
    this.onCreateDiscussion,
    this.events,
  });

  @override
  State<SessionsPage> createState() => _SessionsPageState();
}

class _SessionsPageState extends State<SessionsPage> {
  SessionsTab _tab = SessionsTab.work;
  String _query = '';

  // 聊天 tab：按 active 项目拉取（`listSessions(projectID:)`，Task 14）。
  List<MafwSession>? _chatSessions;
  bool _chatLoading = false;
  bool _chatDirty = true;
  bool _creatingTopic = false;
  int _chatSeq = 0;

  /// Bumped on every `_markChatDirty()`; snapshotted when a fetch starts.
  ///
  /// It separates "the dirty flag this fetch redeems" from "a dirty flag that
  /// arrived while the fetch was in flight": the latter must survive the
  /// completion and schedule one more debounced fetch, otherwise a topic created
  /// mid-fetch stays invisible until the next explicit action (E6-4 review L1).
  int _chatDirtyGen = 0;

  /// 会话列表的事件订阅（`widget.events`；WS 重建后重订阅）。
  StreamSubscription<MafwEvent>? _eventsSub;

  /// `session.created` 缺字段 → 合并 250ms 后做一次全量刷新。
  Timer? _chatRefreshDebounce;

  /// 「交给 Lead」在飞：防双击重复建 Goal。
  bool _handoffBusy = false;

  // 记忆检索（「我的」tab，懒加载）
  List<Map<String, dynamic>> _memories = [];
  bool _loadingMemories = false;
  final _memSearchCtrl = TextEditingController();
  Timer? _memDebounce;

  String? get _activeProjectDir {
    final dir = widget.activeProject?.current();
    return dir == null || dir.isEmpty ? null : dir;
  }

  /// 聊天 tab 的列表来源。
  ///
  /// 没有 client（未配置 / 旧壳）时维持宿主传入的列表；有 client 但首屏还没
  /// 回来时不拿跨项目的旧列表冒充过滤结果（返回空 → 加载态）。
  List<MafwSession> get _chatSource {
    final sessions = _chatSessions;
    if (sessions != null) return sessions;
    return widget.client == null ? widget.sessions : const <MafwSession>[];
  }

  bool get _showAllProjectsNote =>
      widget.activeProject != null && _activeProjectDir == null;

  bool get _canCreateTopic =>
      widget.client != null && _activeProjectDir != null;

  List<MafwSession> get _filtered {
    final source = _chatSource;
    if (_query.isEmpty) return source;
    final q = _query.toLowerCase();
    return source
        .where((s) => s.displayTitle.toLowerCase().contains(q) || s.id.contains(q))
        .toList();
  }

  @override
  void initState() {
    super.initState();
    widget.activeProject?.addListener(_onActiveProjectChanged);
    _subscribeEvents();
    if (_tab == SessionsTab.chat) _ensureChatLoaded();
  }

  @override
  void didUpdateWidget(covariant SessionsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.events, widget.events)) {
      _subscribeEvents();
    }
    if (!identical(oldWidget.activeProject, widget.activeProject)) {
      oldWidget.activeProject?.removeListener(_onActiveProjectChanged);
      widget.activeProject?.addListener(_onActiveProjectChanged);
      _resetChatSessions();
    }
    if (!identical(oldWidget.client, widget.client)) {
      _resetChatSessions();
    }
    if (_tab == SessionsTab.chat) _ensureChatLoaded();
  }

  void _subscribeEvents() {
    _eventsSub?.cancel();
    _eventsSub = widget.events?.listen(_onSessionListEvent);
  }

  /// 会话列表的增量更新（E6-4）。
  ///
  /// 只处理看起来已经加载过的列表（`_chatSessions != null`）：未加载时进 tab
  /// 本来就会全量拉取。`updated/deleted` 直接就地 patch，不再打 gateway；
  /// `created` 只有「完整」才 append，而三种不完整的情形**处理方式不同**：
  /// - 能证明属于别的项目 → 与当前列表无关，直接忽略（不置 dirty）；
  /// - 属于内部会话（[isHiddenSessionRow]：子会话 / worker 标题 / 内部 agent /
  ///   Lead 角色）→ `/api/sessions` 本来就不会返回它，同样忽略，不置 dirty；
  /// - 其余缺字段（没有 id / 没有 title / 没有目录）→ 置 dirty 并 debounce 一次
  ///   全量拉取——id-only 的幽灵行比短暂延迟更糟。
  void _onSessionListEvent(MafwEvent event) {
    if (!mounted) return;
    final current = _chatSessions;
    if (current == null) return;

    switch (event.innerType) {
      case kSessionUpdatedEvent:
      case kSessionDeletedEvent:
        final next = applySessionListEvent(current, event);
        if (!identical(next, current)) {
          setState(() => _chatSessions = next);
        }
        return;
      case kSessionCreatedEvent:
        // 隐藏会话先判：这是完整判定，不是「信息不足」，所以不触发全量刷新。
        if (_hiddenCreatedEvent(event)) return;
        // 项目过滤在服务端（`listSessions(projectID:)`）；增量路径必须自己
        // 兜住「别的项目新建了会话」，否则它会漏进当前项目的列表且没有后续
        // 刷新纠正。目录未知时交给全量刷新判定。
        if (_foreignCreatedEvent(event)) return;
        final next = applySessionListEvent(current, event);
        if (identical(next, current)) {
          _scheduleChatRefresh();
        } else {
          setState(() => _chatSessions = next);
        }
        return;
      default:
        return;
    }
  }

  /// 这个 `session.created` 是否描述一个 `/api/sessions` 会隐藏的会话。
  ///
  /// 与纯函数共用同一判定（[isHiddenSessionRow]），只是提前到「完整性」判断
  /// 之前：隐藏行不需要全量刷新去纠正，也不会出现在服务端返回里。
  bool _hiddenCreatedEvent(MafwEvent event) {
    final info = sessionInfoOf(event);
    if (info == null) return false;
    return isHiddenSessionRow(MafwSession.fromJson(info));
  }

  /// 这次 `session.created` 是否属于「当前项目」列表。
  ///
  /// 未选择项目（显示全部）时没有过滤条件；目录未知时不当外来事件处理，
  /// 由纯函数/全量刷新决定。**能证明是别的项目 → 直接忽略、不置 dirty**：它
  /// 永远不会出现在当前项目的列表里，为它多打一次 gateway 只是噪音。
  bool _foreignCreatedEvent(MafwEvent event) {
    final active = _activeProjectDir;
    if (active == null) return false;
    final info = sessionInfoOf(event);
    final candidate = info?['projectID'] ?? info?['directory'] ?? event.directory;
    if (candidate is! String || candidate.isEmpty) return false;
    return !_sameProjectDir(candidate, active);
  }

  /// 目录比较忽略分隔符方向、大小写与尾部分隔符（Windows 客户端常见差异）。
  static bool _sameProjectDir(String a, String b) {
    String norm(String path) {
      var value = path.replaceAll('\\', '/').toLowerCase();
      while (value.length > 1 && value.endsWith('/')) {
        value = value.substring(0, value.length - 1);
      }
      return value;
    }

    return norm(a) == norm(b);
  }

  /// 标记「还有一次未兑现的拉取请求」（dirty + 代数递增）。
  void _markChatDirty() {
    _chatDirty = true;
    _chatDirtyGen++;
  }

  void _scheduleChatRefresh() {
    _markChatDirty();
    _chatRefreshDebounce?.cancel();
    _chatRefreshDebounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      _ensureChatLoaded();
    });
  }

  /// 丢弃当前聊天页数据（在飞响应由 `_chatSeq` 作废）。
  void _resetChatSessions() {
    _chatSessions = null;
    _chatLoading = false;
    _markChatDirty();
    _chatSeq++;
  }

  /// active 项目切换（工作 tab 项目切换器 / 默认解析）→ 聊天列表重拉。
  void _onActiveProjectChanged() {
    if (!mounted) return;
    setState(_resetChatSessions);
    if (_tab == SessionsTab.chat) _ensureChatLoaded();
  }

  void _ensureChatLoaded() {
    if (widget.client == null) return;
    // `_chatDirty` 是「还有一次未兑现的拉取请求」的唯一权威：
    // - 显式动作（进 tab / 切项目 / client 变更 / 新建后）把它置 true；
    // - 拉取**开始**时就兑现（清 false），结束时只在飞行期间又有新请求时重新置位。
    // 所以失败后普通父级 rebuild（WS 状态变化等）不会自动重试——离线是移动端
    // 主场景，反复发起无超时请求 + 反复加载态比空态更糟；下一次显式动作再试。
    if (_chatLoading || !_chatDirty) return;
    unawaited(_loadChatSessions());
  }

  Future<void> _loadChatSessions() async {
    final client = widget.client;
    if (client == null) return;
    final dir = _activeProjectDir;
    final seq = ++_chatSeq;
    // 一开始就兑现 dirty 并记下代数：飞行期间到达的 created 会让代数变化，
    // 结束时据此补一次 debounce 重试（否则它会被无条件清 dirty 吞掉）。
    final gen = _chatDirtyGen;
    _chatDirty = false;
    setState(() => _chatLoading = true);
    try {
      final list = await client.listSessions(projectID: dir);
      if (!mounted || seq != _chatSeq) return;
      list.sort(compareSessionRows);
      setState(() {
        _chatSessions = list;
        _chatLoading = false;
      });
    } catch (_) {
      if (!mounted || seq != _chatSeq) return;
      // 失败保留旧列表（离线时比空白更诚实）；没有旧列表就是空态。
      setState(() => _chatLoading = false);
    }
    // 只有「确实来了新事件」才补拉一次（coalesced 250ms）；普通 rebuild 永不
    // 自动重试，失败也不会变成重试环（代数没变就不再排）。
    if (mounted && seq == _chatSeq && _chatDirtyGen != gen) {
      _scheduleChatRefresh();
    }
  }

  /// 聊天 tab「新话题」：active 项目目录显式创建（spec §7.7），直接进 ChatPage。
  Future<void> _onCreateTopic() async {
    final client = widget.client;
    final dir = _activeProjectDir;
    if (client == null || dir == null) {
      _snack('未选择项目：请先在「工作」tab 选择项目');
      return;
    }
    setState(() => _creatingTopic = true);
    try {
      final session = await createTopicSession(client, directory: dir);
      if (!mounted) return;
      setState(() => _creatingTopic = false);
      widget.onOpen(session);
      // 新会话已在网关：返回列表时它应该出现（不阻塞打开 ChatPage）。
      _markChatDirty();
      _ensureChatLoaded();
    } catch (e) {
      if (!mounted) return;
      setState(() => _creatingTopic = false);
      _snack('新建会话失败: $e');
    }
  }

  void _snack(String message) {
    ScaffoldMessenger.maybeOf(context)
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message), duration: const Duration(seconds: 2)));
  }

  // ── 交给 Lead（handoff，Task 15）──

  /// Lead 会话本身就是目的地；子代理行不是用户讨论——两者都不能交接。
  bool _canHandoff(MafwSession session) =>
      !session.isLead && session.parentID == null;

  /// 会话所属项目：会话目录 > projectID > 当前项目（聊天列表按项目过滤时三者
  /// 通常相同；没有当前项目的「显示全部」视图必须靠会话自己的目录）。
  String? _handoffProjectDir(MafwSession session) {
    for (final candidate in <String?>[
      session.directory,
      session.projectID,
      _activeProjectDir,
    ]) {
      final dir = candidate?.trim() ?? '';
      if (dir.isNotEmpty) return dir;
    }
    return null;
  }

  void _showSessionActions(MafwSession session) {
    if (!_canHandoff(session)) {
      _snack(session.isLead ? 'Lead 会话不能交给 Lead' : '子代理会话不能交给 Lead');
      return;
    }
    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: Text(
                session.displayTitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: const Text('把这段讨论交给 Lead，变成项目里的 Goal'),
            ),
            const Divider(height: 1),
            ListTile(
              key: const Key('session-handoff-to-lead'),
              leading: const Icon(Icons.handshake_outlined),
              title: const Text('交给 Lead'),
              subtitle: const Text('Lead 会先跟你对齐方向，再规划与实施'),
              onTap: () {
                Navigator.pop(ctx);
                unawaited(_handoffToLead(session));
              },
            ),
          ],
        ),
      ),
    );
  }

  /// 先读会话历史，再解析项目 Pod（无 Pod 时创建），最后 POST handoff。
  ///
  /// 失败全部落成可操作提示（[leadHandoffErrorMessage]）：无 Pod 创建失败 /
  /// 旧网关 / 网络错误各有自己的话，绝不静默。
  Future<void> _handoffToLead(MafwSession session) async {
    if (_handoffBusy) {
      _snack('正在交给 Lead…');
      return;
    }
    final client = widget.client;
    if (client == null) {
      _snack('未配置 Gateway，请先在「我的」里连接');
      return;
    }
    final dir = _handoffProjectDir(session);
    if (dir == null) {
      _snack('无法确定会话所属项目，请先在「工作」tab 选择项目');
      return;
    }

    _handoffBusy = true;
    try {
      final result = await LeadHandoffService(client).handoff(
        session.id,
        projectDir: dir,
        sessionTitle: session.title,
      );
      if (!mounted) return;
      _snack('已交给 Lead');
      // 新 Goal 立刻可看：外壳打开详情（`main.dart` 的 `onOpenGoal`）。
      widget.onOpenGoal?.call(dir, result.goalId);
    } catch (e) {
      if (!mounted) return;
      _snack(leadHandoffErrorMessage(e));
    } finally {
      _handoffBusy = false;
    }
  }

  @override
  void dispose() {
    widget.activeProject?.removeListener(_onActiveProjectChanged);
    _eventsSub?.cancel();
    _chatRefreshDebounce?.cancel();
    _memDebounce?.cancel();
    _memSearchCtrl.dispose();
    super.dispose();
  }

  void _onMemoryQuery(String q) {
    _memDebounce?.cancel();
    _memDebounce = Timer(const Duration(milliseconds: 400), () async {
      final c = widget.client;
      if (c == null) return;
      if (q.trim().isEmpty) {
        if (mounted) setState(() => _memories = []);
        return;
      }
      if (mounted) setState(() => _loadingMemories = true);
      try {
        final res = await c.memorySearch(q.trim(), topK: 10);
        if (!mounted) return;
        setState(() {
          _memories = res;
          _loadingMemories = false;
        });
      } catch (_) {
        if (!mounted) return;
        setState(() => _loadingMemories = false);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // 三个 tab 都有自己的编辑式 masthead；壳不再压 AppBar。
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            if (widget.isOffline) _buildOfflineBanner(context),
            Expanded(child: _buildTabBody(context)),
          ],
        ),
      ),
      bottomNavigationBar: _buildBottomNav(context),
    );
  }

  Widget _buildOfflineBanner(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: MafwPalette.black,
      child: InkWell(
        onTap: widget.onSettings,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(
            horizontal: MafwSpace.xl,
            vertical: 9,
          ),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: MafwPalette.border)),
          ),
          child: Row(
            children: [
              Container(
                width: 5,
                height: 5,
                decoration: BoxDecoration(color: scheme.error, shape: BoxShape.circle),
              ),
              const SizedBox(width: MafwSpace.sm),
              Expanded(
                child: Text(
                  (widget.baseUrl ?? '').isEmpty
                      ? 'Gateway 未配置'
                      : 'Gateway 未连接 · ${widget.baseUrl}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10.5, color: MafwPalette.dim),
                ),
              ),
              const SizedBox(width: MafwSpace.sm),
              const Text(
                '去设置  ›',
                style: TextStyle(fontSize: 10.5, color: MafwPalette.text),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBottomNav(BuildContext context) {
    return MafwBottomNav(
      selectedIndex: _tab.index,
      onSelected: (i) {
        setState(() => _tab = SessionsTab.values[i]);
        if (_tab == SessionsTab.chat) {
          // 显式进入聊天 tab = 重拉一次（列表可能被其它端改动/新建过）。
          _markChatDirty();
          _ensureChatLoaded();
        }
      },
    );
  }

  Widget _buildTabBody(BuildContext context) {
    switch (_tab) {
      case SessionsTab.work:
        return WorkTab(
          client: widget.client,
          activeProject: widget.activeProject,
          refreshBus: widget.refreshBus,
          onOpenGoal: widget.onOpenGoal,
          onOpenLead: widget.onOpenLead,
          onCreateDiscussion: widget.onCreateDiscussion,
          onOpenSettings: widget.onSettings,
        );
      case SessionsTab.chat:
        return _buildChatTab(context);
      case SessionsTab.me:
        return _buildMeTab(context);
    }
  }

  // ── 聊天 Tab（按 active 项目过滤的普通会话列表）──
  Widget _buildChatTab(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(MafwSpace.xl, 16, 12, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'CHATS',
                      style: TextStyle(
                        fontSize: 9,
                        letterSpacing: 2.2,
                        color: MafwPalette.faint,
                      ),
                    ),
                    SizedBox(height: 6),
                    Text(
                      '会话',
                      style: TextStyle(
                        fontSize: 28,
                        height: 1.1,
                        fontWeight: FontWeight.w600,
                        letterSpacing: -0.8,
                        color: MafwPalette.text,
                      ),
                    ),
                  ],
                ),
              ),
              if (widget.onScan != null)
                IconButton(
                  icon: const Icon(Icons.qr_code_scanner, size: 20),
                  tooltip: '扫码配对',
                  style: IconButton.styleFrom(foregroundColor: MafwPalette.dim),
                  onPressed: widget.onScan,
                ),
              IconButton(
                icon: const Icon(Icons.settings, size: 20),
                tooltip: '连接设置',
                style: IconButton.styleFrom(foregroundColor: MafwPalette.dim),
                onPressed: widget.onSettings,
              ),
              IconButton(
                key: const Key('chat-new-topic'),
                icon: _creatingTopic
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 1.5),
                      )
                    : const Icon(Icons.add, size: 20),
                tooltip: _canCreateTopic ? '新话题' : '先在「工作」选择项目',
                style: IconButton.styleFrom(foregroundColor: MafwPalette.text),
                onPressed: _canCreateTopic && !_creatingTopic ? _onCreateTopic : null,
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(MafwSpace.xl, 0, MafwSpace.xl, MafwSpace.sm),
          child: TextField(
            onChanged: (v) => setState(() => _query = v),
            decoration: const InputDecoration(
              hintText: '搜索会话…',
              prefixIcon: Icon(Icons.search, size: 18),
              isDense: true,
            ),
          ),
        ),
        if (_showAllProjectsNote) _buildAllProjectsNote(),
        Expanded(
          child: (_chatLoading && _chatSessions == null) ||
                  (widget.isConnecting && _filtered.isEmpty)
              ? const Center(child: CircularProgressIndicator())
              : _filtered.isEmpty
                  ? _EmptyState(
                      icon: Icons.chat_bubble_outline,
                      title: widget.isOffline ? '未连接到 Gateway' : '暂无会话',
                      subtitle: widget.isOffline
                          ? '点右上角扫码或设置连接地址'
                          : _showAllProjectsNote
                              ? '未选择项目，显示全部会话；在「工作」选择项目后可新建话题'
                              : '点右下角 + 新建会话',
                      actionLabel: widget.isOffline ? '去设置连接' : null,
                      onAction: widget.isOffline ? widget.onSettings : null,
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: MafwSpace.xl),
                      itemCount: _filtered.length,
                      itemBuilder: (ctx, i) => _SessionTile(
                        session: _filtered[i],
                        onOpen: widget.onOpen,
                        onLongPress: _showSessionActions,
                      ),
                    ),
        ),
      ],
    );
  }

  /// 「未选择项目 · 显示全部」提示（spec §7.1：聊天 tab 按当前项目过滤；
  /// 没有当前项目时保持可用，但必须说清不是过滤结果）。
  Widget _buildAllProjectsNote() {
    return Container(
      key: const Key('chat-all-projects-note'),
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(MafwSpace.xl, 2, MafwSpace.xl, 6),
      child: const Row(
        children: [
          Icon(Icons.info_outline, size: 12, color: MafwPalette.faint),
          SizedBox(width: 6),
          Text(
            '未选择项目 · 显示全部',
            style: TextStyle(fontSize: 10, letterSpacing: 0.5, color: MafwPalette.dim),
          ),
        ],
      ),
    );
  }

  // ── 我的 Tab（记忆检索 + 连接设置 / 扫码配对 / 调试）──
  Widget _buildMeTab(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(MafwSpace.xl, 20, MafwSpace.xl, MafwSpace.xxl),
      children: [
        _buildMeBrandHeader(),
        const SizedBox(height: MafwSpace.xxl),
        _sectionLabel('记忆'),
        const SizedBox(height: MafwSpace.sm),
        TextField(
          controller: _memSearchCtrl,
          onChanged: _onMemoryQuery,
          decoration: const InputDecoration(
            hintText: '搜索记忆…',
            prefixIcon: Icon(Icons.search, size: 18),
            isDense: true,
          ),
        ),
        const SizedBox(height: MafwSpace.sm),
        if (_loadingMemories)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (_memories.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 10),
            child: Text(
              '输入关键词，从谐波记忆召回相关条目',
              style: TextStyle(fontSize: 11, color: MafwPalette.faint),
            ),
          )
        else
          for (final mem in _memories) _MemoryCard(mem: mem),
        const SizedBox(height: MafwSpace.xxl),
        _sectionLabel('连接'),
        const SizedBox(height: MafwSpace.sm),
        _MeMenuRow(
          icon: Icons.dns_outlined,
          title: 'Gateway',
          subtitle: widget.baseUrl ?? '未配置',
          onTap: widget.onSettings,
        ),
        if (widget.onScan != null)
          _MeMenuRow(
            icon: Icons.qr_code_scanner,
            title: '扫码配对',
            subtitle: '扫描桌面端的配对二维码',
            onTap: widget.onScan,
          ),
        if (widget.onTriage != null)
          _MeMenuRow(
            icon: Icons.pending_actions,
            title: 'Triage 待决项',
            subtitle: '审批 / 待决项列表',
            onTap: widget.onTriage,
          ),
        if (debugPanelEnabled)
          _MeMenuRow(
            icon: Icons.bug_report_outlined,
            title: '调试',
            subtitle: '连接诊断 · 事件检查器 · 诊断包（dev-only）',
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => DebugPage(
                diagnostics: widget.diagnostics,
                client: widget.client,
                baseUrl: widget.baseUrl,
                wsConnected: widget.wsConnected,
              ),
            )),
          ),
        const SizedBox(height: MafwSpace.xxl),
        _sectionLabel('关于'),
        const SizedBox(height: MafwSpace.sm),
        _MeMenuRow(
          icon: Icons.info_outline,
          title: 'Orcalore Mobile',
          subtitle: 'v$kAppVersion · MAFW Gateway 客户端',
          onTap: null,
        ),
      ],
    );
  }

  /// 「我的」页顶部品牌 lockup：小 Lore + 字标 + 一句定位。
  Widget _buildMeBrandHeader() {
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
                errorBuilder: (_, _, _) => const Icon(
                  Icons.spa_outlined,
                  size: 16,
                  color: MafwPalette.accent,
                ),
              ),
            ),
            const SizedBox(width: MafwSpace.sm),
            const Text(
              'ORCALORE / PROFILE',
              style: TextStyle(
                fontSize: 9,
                letterSpacing: 2.2,
                color: MafwPalette.faint,
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        const Text(
          kAppName,
          style: TextStyle(
            fontFamily: MafwFonts.serif,
            fontSize: 32,
            height: 1.0,
            letterSpacing: -1.2,
            color: MafwPalette.text,
          ),
        ),
        const SizedBox(height: 10),
        const Text(
          kAppTagline,
          style: TextStyle(fontSize: 11, color: MafwPalette.dim),
        ),
        const SizedBox(height: 15),
        const Divider(height: 1, color: MafwPalette.border),
      ],
    );
  }

  Widget _sectionLabel(String text) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 10,
        letterSpacing: 1.9,
        color: MafwPalette.dim,
      ),
    );
  }
}

/// 「我的」里的编辑式入口行：细线图标 + 标题/说明 + hairline，无卡片。
class _MeMenuRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  const _MeMenuRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: MafwPalette.border)),
        ),
        child: Row(
          children: [
            Icon(icon, size: 18, color: MafwPalette.dim),
            const SizedBox(width: MafwSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: MafwPalette.text,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, height: 1.4, color: MafwPalette.dim),
                  ),
                ],
              ),
            ),
            if (onTap != null)
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

// ── 会话条目（Lead 中性胶囊 / 子代理灰紫胶囊）──
class _SessionTile extends StatelessWidget {
  final MafwSession session;
  final void Function(MafwSession) onOpen;
  final void Function(MafwSession)? onLongPress;

  const _SessionTile({
    required this.session,
    required this.onOpen,
    this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    final s = session;
    final isLead = s.isLead;
    final isSubagent = !isLead && s.parentID != null;
    return InkWell(
      onTap: () => onOpen(s),
      onLongPress: onLongPress == null ? null : () => onLongPress!(s),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: MafwPalette.border)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      if (isLead) ...[
                        const Text(
                          'LEAD',
                          style: TextStyle(
                            fontSize: 8,
                            letterSpacing: 1.2,
                            fontFamily: 'monospace',
                            color: MafwPalette.dim,
                          ),
                        ),
                        const SizedBox(width: 8),
                      ] else if (isSubagent) ...[
                        const Text(
                          'SUB',
                          style: TextStyle(
                            fontSize: 8,
                            letterSpacing: 1.2,
                            fontFamily: 'monospace',
                            color: MafwPalette.faint,
                          ),
                        ),
                        const SizedBox(width: 8),
                      ],
                      Expanded(
                        child: Text(
                          s.displayTitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: isLead ? FontWeight.w600 : FontWeight.w500,
                            height: 1.3,
                            color: MafwPalette.text,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    s.id,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: MafwPalette.dim),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
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

// ── 记忆卡片（primary_abstraction + cueAnchors + energy 条）──
class _MemoryCard extends StatelessWidget {
  final Map<String, dynamic> mem;
  const _MemoryCard({required this.mem});

  @override
  Widget build(BuildContext context) {
    final abstraction = (mem['primary_abstraction'] ?? mem['abstraction'] ?? '').toString();
    final value = (mem['memory_value'] ?? mem['value'] ?? mem['content'] ?? '').toString();
    final anchors = mem['cue_anchors'] is List
        ? (mem['cue_anchors'] as List).map((e) => e.toString()).where((e) => e.isNotEmpty).toList()
        : <String>[];
    final energy = (mem['energy'] is num) ? (mem['energy'] as num).toDouble() : null;
    final type = (mem['type'] ?? mem['memory_type'] ?? '').toString();

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: MafwPalette.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  abstraction,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: MafwPalette.text,
                    height: 1.4,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (type.isNotEmpty) ...[
                const SizedBox(width: MafwSpace.sm),
                Text(
                  type,
                  style: const TextStyle(
                    fontSize: 8,
                    letterSpacing: 1,
                    fontFamily: 'monospace',
                    color: MafwPalette.faint,
                  ),
                ),
              ],
            ],
          ),
          if (value.isNotEmpty) ...[
            const SizedBox(height: 5),
            Text(
              value,
              style: const TextStyle(fontSize: 11.5, color: MafwPalette.dim, height: 1.5),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          if (anchors.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              anchors.join(' · '),
              style: const TextStyle(fontSize: 10, height: 1.4, color: MafwPalette.faint),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          if (energy != null) ...[
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(1),
              child: LinearProgressIndicator(
                value: energy.clamp(0.0, 1.0),
                minHeight: 2,
                backgroundColor: MafwPalette.border,
                color: mafwEnergyColor(energy),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;

  const _EmptyState({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topLeft,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(MafwSpace.xl, 48, MafwSpace.xl, MafwSpace.xl),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 300),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 18, color: MafwPalette.faint),
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
              Text(
                subtitle,
                style: const TextStyle(fontSize: 12, height: 1.6, color: MafwPalette.dim),
              ),
              if (actionLabel != null && onAction != null) ...[
                const SizedBox(height: MafwSpace.md),
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
        ),
      ),
    );
  }
}
