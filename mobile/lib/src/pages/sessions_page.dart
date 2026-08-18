import 'package:flutter/material.dart';

import '../models/mafw_models.dart';

/// Session list (tabs like the desktop SessionStrip).
class SessionsPage extends StatefulWidget {
  final List<MafwSession> sessions;
  final void Function(MafwSession) onOpen;
  final Future<void> Function() onCreate;
  final void Function() onSettings;
  final Future<void> Function()? onScan;

  const SessionsPage({
    super.key,
    required this.sessions,
    required this.onOpen,
    required this.onCreate,
    required this.onSettings,
    this.onScan,
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
            IconButton(icon: const Icon(Icons.qr_code_scanner), onPressed: widget.onScan),
          IconButton(icon: const Icon(Icons.settings), onPressed: widget.onSettings),
        ],
      ),
      body: Column(
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
            child: _filtered.isEmpty
                ? const Center(child: Text('暂无会话，点击右下角新建'))
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
