import 'dart:async';

import 'package:flutter/material.dart';

import '../models/mafw_models.dart';
import '../network/gateway_client.dart';
import '../services/active_project.dart';
import '../services/diagnostics.dart';
import '../services/work_refresh_bus.dart';
import '../theme.dart';
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
  });

  @override
  State<SessionsPage> createState() => _SessionsPageState();
}

class _SessionsPageState extends State<SessionsPage> {
  SessionsTab _tab = SessionsTab.work;
  String _query = '';

  // 聊天 tab：按 active 项目拉取（`listSessions(projectID:)`，Task 14）。
  List<MafwSession>? _chatSessions;
  bool _chatLoaded = false;
  bool _chatLoading = false;
  bool _chatDirty = true;
  bool _creatingTopic = false;
  int _chatSeq = 0;

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
    if (_tab == SessionsTab.chat) _ensureChatLoaded();
  }

  @override
  void didUpdateWidget(covariant SessionsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
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

  /// 丢弃当前聊天页数据（在飞响应由 `_chatSeq` 作废）。
  void _resetChatSessions() {
    _chatSessions = null;
    _chatLoaded = false;
    _chatLoading = false;
    _chatDirty = true;
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
    // 只有「需要拉取」时才发请求：显式进入 tab / 切换项目 / client 变更会把
    // `_chatDirty` 置位；失败后不自动重试，避免离线时每个父级 rebuild 都打网关。
    if (_chatLoading || (_chatLoaded && !_chatDirty)) return;
    _chatDirty = false;
    unawaited(_loadChatSessions());
  }

  Future<void> _loadChatSessions() async {
    final client = widget.client;
    if (client == null) return;
    final dir = _activeProjectDir;
    final seq = ++_chatSeq;
    setState(() => _chatLoading = true);
    try {
      final list = await client.listSessions(projectID: dir);
      if (!mounted || seq != _chatSeq) return;
      list.sort(_compareSessions);
      setState(() {
        _chatSessions = list;
        _chatLoaded = true;
        _chatLoading = false;
      });
    } catch (_) {
      if (!mounted || seq != _chatSeq) return;
      // 失败保留旧列表（离线时比空白更诚实）；没有旧列表就是空态，下次
      // 进入聊天 tab 会重试。
      setState(() => _chatLoading = false);
    }
  }

  static int _compareSessions(MafwSession a, MafwSession b) {
    if (a.isLead != b.isLead) return a.isLead ? -1 : 1;
    return (b.timeCreated ?? 0).compareTo(a.timeCreated ?? 0);
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
      _chatDirty = true;
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

  @override
  void dispose() {
    widget.activeProject?.removeListener(_onActiveProjectChanged);
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

  String get _title {
    switch (_tab) {
      case SessionsTab.work:
        return 'Orcalore';
      case SessionsTab.chat:
        return '聊天';
      case SessionsTab.me:
        return '我的';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // 「工作」tab 自带品牌行（Task 7），壳不再压一条 AppBar 在它上面。
      appBar: _tab == SessionsTab.work
          ? null
          : AppBar(
              title: Text(_title),
              actions: [
                if (_tab == SessionsTab.chat) ...[
                  if (widget.onScan != null)
                    IconButton(
                      icon: const Icon(Icons.qr_code_scanner),
                      tooltip: '扫码配对',
                      onPressed: widget.onScan,
                    ),
                  IconButton(
                    icon: const Icon(Icons.settings),
                    tooltip: '连接设置',
                    onPressed: widget.onSettings,
                  ),
                ],
              ],
            ),
      body: Column(
        children: [
          if (widget.isOffline) _buildOfflineBanner(context),
          Expanded(child: _buildTabBody(context)),
        ],
      ),
      // 新建会话（新话题入口）属于「聊天」tab；按 active 项目目录创建。
      floatingActionButton: _tab == SessionsTab.chat
          ? FloatingActionButton(
              key: const Key('chat-new-topic'),
              tooltip: _canCreateTopic ? '新话题' : '先在「工作」选择项目',
              onPressed: _canCreateTopic && !_creatingTopic ? _onCreateTopic : null,
              child: _creatingTopic
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.add),
            )
          : null,
      bottomNavigationBar: _buildBottomNav(context),
    );
  }

  Widget _buildOfflineBanner(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.error,
      child: InkWell(
        onTap: widget.onSettings,
        child: SafeArea(
          bottom: false,
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                Icon(Icons.cloud_off, size: 14, color: scheme.onError),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    (widget.baseUrl ?? '').isEmpty
                        ? 'Gateway 未配置 — 点此去设置'
                        : 'Gateway 未连接（${widget.baseUrl}）— 点此去设置',
                    style: TextStyle(color: scheme.onError, fontSize: 12),
                  ),
                ),
                Icon(
                  Icons.chevron_right,
                  size: 16,
                  color: scheme.onError.withValues(alpha: 0.7),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildBottomNav(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return NavigationBar(
      selectedIndex: _tab.index,
      onDestinationSelected: (i) {
        setState(() => _tab = SessionsTab.values[i]);
        if (_tab == SessionsTab.chat) {
          // 显式进入聊天 tab = 重拉一次（列表可能被其它端改动/新建过）。
          _chatDirty = true;
          _ensureChatLoaded();
        }
      },
      backgroundColor: scheme.surface,
      indicatorColor: MafwPalette.accentDim,
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.space_dashboard_outlined),
          selectedIcon: Icon(Icons.space_dashboard),
          label: '工作',
        ),
        NavigationDestination(
          icon: Icon(Icons.chat_bubble_outline),
          selectedIcon: Icon(Icons.chat_bubble),
          label: '聊天',
        ),
        NavigationDestination(
          icon: Icon(Icons.person_outline),
          selectedIcon: Icon(Icons.person),
          label: '我的',
        ),
      ],
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
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: TextField(
            onChanged: (v) => setState(() => _query = v),
            decoration: const InputDecoration(
              hintText: '搜索会话…',
              prefixIcon: Icon(Icons.search),
              isDense: true,
              border: OutlineInputBorder(),
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
                              : '点击右下角 + 新建会话',
                      actionLabel: widget.isOffline ? '去设置连接' : null,
                      onAction: widget.isOffline ? widget.onSettings : null,
                    )
                  : ListView.builder(
                      itemCount: _filtered.length,
                      itemBuilder: (ctx, i) => _SessionTile(session: _filtered[i], onOpen: widget.onOpen),
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      color: MafwPalette.badgeBg,
      child: const Row(
        children: [
          Icon(Icons.info_outline, size: 14, color: MafwPalette.dim),
          SizedBox(width: 6),
          Text(
            '未选择项目 · 显示全部',
            style: TextStyle(fontSize: 11, color: MafwPalette.dim),
          ),
        ],
      ),
    );
  }

  // ── 我的 Tab（记忆检索 + 连接设置 / 扫码配对 / 调试）──
  Widget _buildMeTab(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: [
        _sectionLabel('记忆'),
        const SizedBox(height: 8),
        TextField(
          controller: _memSearchCtrl,
          onChanged: _onMemoryQuery,
          decoration: const InputDecoration(
            hintText: '搜索记忆…',
            prefixIcon: Icon(Icons.search),
            isDense: true,
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 8),
        if (_loadingMemories)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (_memories.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Text(
              '输入关键词，从谐波记忆召回相关条目',
              style: TextStyle(fontSize: 12, color: MafwPalette.faint),
            ),
          )
        else
          for (final mem in _memories) _MemoryCard(mem: mem),
        const SizedBox(height: 20),
        _sectionLabel('连接'),
        const SizedBox(height: 8),
        Card(
          color: scheme.surfaceContainerHighest,
          child: ListTile(
            leading: const CircleAvatar(
              backgroundColor: kMafwPrimary,
              foregroundColor: MafwPalette.black,
              child: Icon(Icons.dns, size: 20),
            ),
            title: const Text('Gateway'),
            subtitle: Text(widget.baseUrl ?? '未配置'),
            trailing: Icon(Icons.chevron_right, color: scheme.onSurfaceVariant),
            onTap: widget.onSettings,
          ),
        ),
        const SizedBox(height: 8),
        if (widget.onScan != null)
          Card(
            color: scheme.surfaceContainerHighest,
            child: ListTile(
              leading: const CircleAvatar(
                backgroundColor: kMafwAccent,
                foregroundColor: MafwPalette.black,
                child: Icon(Icons.qr_code_scanner, size: 20),
              ),
              title: const Text('扫码配对'),
              subtitle: const Text('扫描桌面端的配对二维码'),
              trailing: Icon(Icons.chevron_right, color: scheme.onSurfaceVariant),
              onTap: widget.onScan,
            ),
          ),
        // Triage 入口随旧 Goal tab 退役迁到这里（spec §9：保持现状入口）。
        if (widget.onTriage != null) ...[
          const SizedBox(height: 8),
          Card(
            color: scheme.surfaceContainerHighest,
            child: ListTile(
              leading: const CircleAvatar(
                backgroundColor: kMafwGoalActive,
                foregroundColor: MafwPalette.black,
                child: Icon(Icons.pending_actions, size: 20),
              ),
              title: const Text('Triage 待决项'),
              subtitle: const Text('审批 / 待决项列表'),
              trailing: Icon(Icons.chevron_right, color: scheme.onSurfaceVariant),
              onTap: widget.onTriage,
            ),
          ),
        ],
        if (debugPanelEnabled) ...[
          const SizedBox(height: 8),
          Card(
            color: scheme.surfaceContainerHighest,
            child: ListTile(
              leading: const CircleAvatar(
                backgroundColor: kMafwSubagent,
                foregroundColor: MafwPalette.black,
                child: Icon(Icons.bug_report, size: 20),
              ),
              title: const Text('调试'),
              subtitle: const Text('连接诊断 · 事件检查器 · 诊断包（dev-only）'),
              trailing: Icon(Icons.chevron_right, color: scheme.onSurfaceVariant),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => DebugPage(
                  diagnostics: widget.diagnostics,
                  client: widget.client,
                  baseUrl: widget.baseUrl,
                  wsConnected: widget.wsConnected,
                ),
              )),
            ),
          ),
        ],
      ],
    );
  }

  Widget _sectionLabel(String text) {
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

// ── 会话条目（Lead 中性胶囊 / 子代理灰紫胶囊）──
class _SessionTile extends StatelessWidget {
  final MafwSession session;
  final void Function(MafwSession) onOpen;

  const _SessionTile({required this.session, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    final s = session;
    final isLead = s.isLead;
    final isSubagent = !isLead && s.parentID != null;
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      leading: CircleAvatar(
        radius: 16,
        backgroundColor: isLead
            ? kMafwManager.withValues(alpha: 0.2)
            : isSubagent
                ? kMafwSubagent.withValues(alpha: 0.2)
                : scheme.surfaceContainerHighest,
        child: Text(
          isLead ? 'L' : (s.displayTitle.isEmpty ? '?' : s.displayTitle[0].toUpperCase()),
          style: TextStyle(
            color: isLead ? kMafwManager : (isSubagent ? kMafwSubagent : scheme.onSurfaceVariant),
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      title: Text(
        s.displayTitle,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(fontWeight: isLead ? FontWeight.w700 : FontWeight.w500),
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Row(
          children: [
            if (isLead) ...[
              const _StatusChip(text: 'Lead', color: kMafwManager),
              const SizedBox(width: 6),
            ] else if (isSubagent) ...[
              const _StatusChip(text: '子代理', color: kMafwSubagent),
              const SizedBox(width: 6),
            ],
            Expanded(
              child: Text(
                s.id,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
              ),
            ),
          ],
        ),
      ),
      onTap: () => onOpen(s),
    );
  }
}

// ── 记忆卡片（primary_abstraction + cueAnchors + energy 条）──
class _MemoryCard extends StatelessWidget {
  final Map<String, dynamic> mem;
  const _MemoryCard({required this.mem});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final abstraction = (mem['primary_abstraction'] ?? mem['abstraction'] ?? '').toString();
    final value = (mem['memory_value'] ?? mem['value'] ?? mem['content'] ?? '').toString();
    final anchors = mem['cue_anchors'] is List
        ? (mem['cue_anchors'] as List).map((e) => e.toString()).where((e) => e.isNotEmpty).toList()
        : <String>[];
    final energy = (mem['energy'] is num) ? (mem['energy'] as num).toDouble() : null;
    final type = (mem['type'] ?? mem['memory_type'] ?? '').toString();

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: scheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    abstraction,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurface,
                      height: 1.4,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (type.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(left: 6),
                    child: _StatusChip(text: type, color: kMafwSubagent),
                  ),
              ],
            ),
            if (value.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                value,
                style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant, height: 1.4),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            if (anchors.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 4,
                runSpacing: 4,
                children: anchors.map((a) => _AnchorChip(text: a)).toList(),
              ),
            ],
            if (energy != null) ...[
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(2),
                child: LinearProgressIndicator(
                  value: energy.clamp(0.0, 1.0),
                  minHeight: 3,
                  backgroundColor: scheme.surfaceContainer,
                  color: mafwEnergyColor(energy),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ── 通用小组件 ──
class _StatusChip extends StatelessWidget {
  final String text;
  final Color color;
  const _StatusChip({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: color),
      ),
    );
  }
}

class _AnchorChip extends StatelessWidget {
  final String text;
  const _AnchorChip({required this.text});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        '#$text',
        style: TextStyle(fontSize: 10, color: scheme.onSurfaceVariant),
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 36, color: Colors.grey.shade400),
            const SizedBox(height: 10),
            Text(title, style: TextStyle(color: Colors.grey.shade600, fontSize: 14)),
            const SizedBox(height: 6),
            Text(subtitle, style: TextStyle(color: Colors.grey.shade500, fontSize: 12)),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: onAction,
                icon: const Icon(Icons.settings, size: 16),
                label: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
