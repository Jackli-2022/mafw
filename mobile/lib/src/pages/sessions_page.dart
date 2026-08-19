import 'package:flutter/material.dart';

import '../models/mafw_models.dart';

/// Session list (tabs like the desktop SessionStrip).
class SessionsPage extends StatefulWidget {
  final List<MafwSession> sessions;
  final void Function(MafwSession) onOpen;
  final Future<void> Function() onCreate;
  final void Function() onSettings;
  final Future<void> Function()? onScan;
  final bool isOffline;
  final String? baseUrl;
  final bool isConnecting;

  const SessionsPage({
    super.key,
    required this.sessions,
    required this.onOpen,
    required this.onCreate,
    required this.onSettings,
    this.onScan,
    this.isOffline = false,
    this.baseUrl,
    this.isConnecting = false,
  });

  @override
  State<SessionsPage> createState() => _SessionsPageState();
}

class _SessionsPageState extends State<SessionsPage> {
  String _query = '';

  List<MafwSession> get _filtered {
    if (_query.isEmpty) return widget.sessions;
    final q = _query.toLowerCase();
    return widget.sessions
        .where((s) => s.displayTitle.toLowerCase().contains(q) || s.id.contains(q))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('MAFW 会话'),
        actions: [
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
      ),
      body: Column(
        children: [
          // Tappable offline banner — goes to settings, not a dead header text.
          if (widget.isOffline)
            Material(
              color: Colors.red.shade700,
              child: InkWell(
                onTap: widget.onSettings,
                child: SafeArea(
                  bottom: false,
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    child: Row(
                      children: [
                        const Icon(Icons.cloud_off, size: 14, color: Colors.white),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            'Gateway 未连接（${widget.baseUrl ?? ''}）— 点此去设置',
                            style: const TextStyle(color: Colors.white, fontSize: 12),
                          ),
                        ),
                        const Icon(Icons.chevron_right, size: 16, color: Colors.white70),
                      ],
                    ),
                  ),
                ),
              ),
            ),
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
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.chat_bubble_outline, size: 36, color: Colors.grey.shade400),
                              const SizedBox(height: 10),
                              Text(
                                widget.isOffline ? '未连接到 Gateway' : '暂无会话',
                                style: TextStyle(color: Colors.grey.shade600, fontSize: 14),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                widget.isOffline ? '点右上角扫码或设置连接地址' : '点击右下角 + 新建会话',
                                style: TextStyle(color: Colors.grey.shade500, fontSize: 12),
                              ),
                              if (widget.isOffline) ...[
                                const SizedBox(height: 14),
                                FilledButton.icon(
                                  onPressed: widget.onSettings,
                                  icon: const Icon(Icons.settings, size: 16),
                                  label: const Text('去设置连接'),
                                ),
                              ],
                            ],
                          ),
                        ),
                      )
                    : ListView.builder(
                        itemCount: _filtered.length,
                        itemBuilder: (ctx, i) {
                          final s = _filtered[i];
                          return ListTile(
                            leading: CircleAvatar(
                              radius: 16,
                              child: Text(s.isManager ? 'M' : (s.displayTitle.isEmpty ? '?' : s.displayTitle[0].toUpperCase())),
                            ),
                            title: Text(
                              s.displayTitle,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontWeight: s.isManager ? FontWeight.bold : FontWeight.normal),
                            ),
                            subtitle: Text(
                              s.isManager ? 'Manager' : (s.parentID != null ? '子代理' : s.id),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: s.isManager ? const Icon(Icons.star, size: 16, color: Colors.amber) : null,
                            onTap: () => widget.onOpen(s),
                          );
                        },
                      ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: widget.onCreate,
        child: const Icon(Icons.add),
      ),
    );
  }
}
