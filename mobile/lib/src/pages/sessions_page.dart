import 'dart:async';

import 'package:flutter/material.dart';

import '../models/mafw_models.dart';
import '../network/gateway_client.dart';
import '../theme.dart';
import 'goal_detail_page.dart';
import 'triage_page.dart';

/// 底部 Tab 导航页（方案 C：AI 紫品牌风，对标豆包 5 Tab）。
/// Tab：会话 / Goal / 记忆 / 我的。
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
  });

  @override
  State<SessionsPage> createState() => _SessionsPageState();
}

class _SessionsPageState extends State<SessionsPage> {
  String _query = '';
  int _tab = 0;

  // Goal / 记忆数据（懒加载）
  List<Map<String, dynamic>> _goals = [];
  List<Map<String, dynamic>> _memories = [];
  bool _loadingGoals = false;
  bool _loadingMemories = false;
  bool _goalsLoaded = false;
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

  Future<void> _loadGoals() async {
    final c = widget.client;
    if (c == null || _goalsLoaded || _loadingGoals) return;
    setState(() => _loadingGoals = true);
    try {
      final goals = await c.listGoals();
      if (!mounted) return;
      setState(() {
        _goals = goals;
        _goalsLoaded = true;
        _loadingGoals = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingGoals = false);
    }
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
      appBar: AppBar(
        title: Text(_tab == 0 ? 'MAFW 会话' : (_tab == 1 ? 'Goals' : (_tab == 2 ? '记忆' : '我的'))),
        actions: [
          if (_tab == 0) ...[
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
          if (widget.isOffline)
            Material(
              color: Theme.of(context).colorScheme.error,
              child: InkWell(
                onTap: widget.onSettings,
                child: SafeArea(
                  bottom: false,
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    child: Row(
                      children: [
                        Icon(Icons.cloud_off, size: 14, color: Theme.of(context).colorScheme.onError),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            'Gateway 未连接（${widget.baseUrl ?? ''}）— 点此去设置',
                            style: TextStyle(color: Theme.of(context).colorScheme.onError, fontSize: 12),
                          ),
                        ),
                        Icon(Icons.chevron_right, size: 16, color: Theme.of(context).colorScheme.onError.withValues(alpha: 0.7)),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          Expanded(child: _buildTabBody(context)),
        ],
      ),
      floatingActionButton: _tab == 0
          ? FloatingActionButton(
              backgroundColor: kMafwPrimary,
              foregroundColor: Colors.white,
              onPressed: widget.onCreate,
              child: const Icon(Icons.add),
            )
          : null,
      bottomNavigationBar: _buildBottomNav(context),
    );
  }

  Widget _buildBottomNav(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return NavigationBar(
      selectedIndex: _tab,
      onDestinationSelected: (i) {
        setState(() => _tab = i);
        if (i == 1) _loadGoals();
      },
      backgroundColor: scheme.surface,
      indicatorColor: kMafwPrimary.withValues(alpha: 0.15),
      destinations: const [
        NavigationDestination(icon: Icon(Icons.chat_bubble_outline), selectedIcon: Icon(Icons.chat_bubble), label: '会话'),
        NavigationDestination(icon: Icon(Icons.flag_outlined), selectedIcon: Icon(Icons.flag), label: 'Goal'),
        NavigationDestination(icon: Icon(Icons.memory_outlined), selectedIcon: Icon(Icons.memory), label: '记忆'),
        NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: '我的'),
      ],
    );
  }

  Widget _buildTabBody(BuildContext context) {
    switch (_tab) {
      case 1:
        return _buildGoalsTab(context);
      case 2:
        return _buildMemoryTab(context);
      case 3:
        return _buildMeTab(context);
      default:
        return _buildSessionsTab(context);
    }
  }

  // ── 会话 Tab ──
  Widget _buildSessionsTab(BuildContext context) {
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

  // ── Goal Tab ──
  Widget _buildGoalsTab(BuildContext context) {
    if (_loadingGoals) return const Center(child: CircularProgressIndicator());
    if (_goals.isEmpty) {
      return _EmptyState(
        icon: Icons.flag_outlined,
        title: widget.client == null ? '未连接' : '暂无 Goal',
        subtitle: widget.client == null ? '先连接 Gateway' : '创建 Goal 后在这里跟踪',
      );
    }
    return Column(
      children: [
        // Triage quick access
        if (widget.onTriage != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: Card(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              child: ListTile(
                leading: const Icon(Icons.pending_actions, size: 20, color: kMafwGoalActive),
                title: const Text('Triage 待决项', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                trailing: Icon(Icons.chevron_right, size: 18, color: Theme.of(context).colorScheme.onSurfaceVariant),
                onTap: widget.onTriage,
              ),
            ),
          ),
        Expanded(
          child: ListView.builder(
            itemCount: _goals.length,
            itemBuilder: (ctx, i) {
              final g = _goals[i];
              final title = (g['title'] ?? g['name'] ?? g['id'] ?? '').toString();
              final status = (g['status'] ?? g['state'] ?? '').toString();
              final goalId = (g['id'] ?? '').toString();
              final active = status == 'active' || status == 'in_progress' || status == 'running';
              return ListTile(
                leading: CircleAvatar(
                  radius: 14,
                  backgroundColor: active ? kMafwGoalActive.withValues(alpha: 0.2) : Colors.grey.withValues(alpha: 0.15),
                  child: Icon(Icons.flag, size: 16, color: active ? kMafwGoalActive : Colors.grey),
                ),
                title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(status, maxLines: 1, overflow: TextOverflow.ellipsis),
                trailing: active
                    ? const _StatusChip(text: '进行中', color: kMafwGoalActive)
                    : _StatusChip(text: status.isEmpty ? 'idle' : status, color: Colors.grey),
                onTap: goalId.isNotEmpty
                    ? () => Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => GoalDetailPage(
                            client: widget.client,
                            goalId: goalId,
                            goalTitle: title,
                            goalStatus: status,
                          ),
                        ))
                    : null,
              );
            },
          ),
        ),
      ],
    );
  }

  // ── 记忆 Tab ──
  Widget _buildMemoryTab(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: TextField(
            controller: _memSearchCtrl,
            onChanged: _onMemoryQuery,
            decoration: const InputDecoration(
              hintText: '检索记忆…',
              prefixIcon: Icon(Icons.search),
              isDense: true,
              border: OutlineInputBorder(),
            ),
          ),
        ),
        Expanded(
          child: _loadingMemories
              ? const Center(child: CircularProgressIndicator())
              : _memories.isEmpty
                  ? _EmptyState(
                      icon: Icons.memory,
                      title: '检索谐波记忆',
                      subtitle: '输入关键词，从记忆系统召回相关条目',
                    )
                  : ListView.builder(
                      itemCount: _memories.length,
                      itemBuilder: (ctx, i) => _MemoryCard(mem: _memories[i]),
                    ),
        ),
      ],
    );
  }

  // ── 我的 Tab ──
  Widget _buildMeTab(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          color: scheme.surfaceContainerHighest,
          child: ListTile(
            leading: const CircleAvatar(
              backgroundColor: kMafwPrimary,
              foregroundColor: Colors.white,
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
                foregroundColor: Colors.white,
                child: Icon(Icons.qr_code_scanner, size: 20),
              ),
              title: const Text('扫码配对'),
              subtitle: const Text('扫描桌面端的配对二维码'),
              trailing: Icon(Icons.chevron_right, color: scheme.onSurfaceVariant),
              onTap: widget.onScan,
            ),
          ),
      ],
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
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
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
