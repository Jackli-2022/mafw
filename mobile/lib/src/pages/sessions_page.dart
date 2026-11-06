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

/// 底部 Tab 导航页（3-tab：工作 / 聊天 / 我的）。
class SessionsPage extends StatefulWidget {
  final List<MafwSession> sessions;
  final void Function(MafwSession) onOpen;
  final Future<void> Function() onCreate;
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

  /// 「＋ 新建讨论」占位（Task 11 接 composer）。
  final VoidCallback? onCreateDiscussion;

  const SessionsPage({
    super.key,
    required this.sessions,
    required this.onOpen,
    required this.onCreate,
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
    this.onCreateDiscussion,
  });

  @override
  State<SessionsPage> createState() => _SessionsPageState();
}

class _SessionsPageState extends State<SessionsPage> {
  SessionsTab _tab = SessionsTab.work;
  String _query = '';

  // 记忆检索（「我的」tab，懒加载）
  List<Map<String, dynamic>> _memories = [];
  bool _loadingMemories = false;
  final _memSearchCtrl = TextEditingController();
  Timer? _memDebounce;

  List<MafwSession> get _filtered {
    if (_query.isEmpty) return widget.sessions;
    final q = _query.toLowerCase();
    return widget.sessions
        .where((s) => s.displayTitle.toLowerCase().contains(q) || s.id.contains(q))
        .toList();
  }

  @override
  void dispose() {
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
      // 新建会话（新话题入口）属于「聊天」tab。
      floatingActionButton: _tab == SessionsTab.chat
          ? FloatingActionButton(
              // Orcalore FAB：theme 提供纯白（cream）底 + 黑色＋号（spec §3）。
              onPressed: widget.onCreate,
              child: const Icon(Icons.add),
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
          onCreateDiscussion: widget.onCreateDiscussion,
          onOpenSettings: widget.onSettings,
        );
      case SessionsTab.chat:
        return _buildChatTab(context);
      case SessionsTab.me:
        return _buildMeTab(context);
    }
  }

  // ── 聊天 Tab（普通会话列表）──
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
        Expanded(
          child: widget.isConnecting && _filtered.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : _filtered.isEmpty
                  ? _EmptyState(
                      icon: Icons.chat_bubble_outline,
                      title: widget.isOffline ? '未连接到 Gateway' : '暂无会话',
                      subtitle: widget.isOffline ? '点右上角扫码或设置连接地址' : '点击右下角 + 新建会话',
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

// ── 会话条目（Manager 琥珀胶囊 / 子代理灰紫胶囊）──
class _SessionTile extends StatelessWidget {
  final MafwSession session;
  final void Function(MafwSession) onOpen;

  const _SessionTile({required this.session, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    final s = session;
    final isManager = s.isManager;
    final isSubagent = !isManager && s.parentID != null;
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      leading: CircleAvatar(
        radius: 16,
        backgroundColor: isManager
            ? kMafwManager.withValues(alpha: 0.2)
            : isSubagent
                ? kMafwSubagent.withValues(alpha: 0.2)
                : scheme.surfaceContainerHighest,
        child: Text(
          isManager ? 'M' : (s.displayTitle.isEmpty ? '?' : s.displayTitle[0].toUpperCase()),
          style: TextStyle(
            color: isManager ? kMafwManager : (isSubagent ? kMafwSubagent : scheme.onSurfaceVariant),
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      title: Text(
        s.displayTitle,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(fontWeight: isManager ? FontWeight.w700 : FontWeight.w500),
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Row(
          children: [
            if (isManager) ...[
              const _StatusChip(text: 'Manager', color: kMafwManager),
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
