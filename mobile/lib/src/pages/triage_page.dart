import 'dart:async';

import 'package:flutter/material.dart';

import '../models/triage_card_model.dart';
import '../network/gateway_client.dart';
import '../theme.dart';

/// Triage list page — shows pending items from the gateway triage queue.
/// Each item can be accepted or rejected via the client methods.
class TriagePage extends StatefulWidget {
  final GatewayClient? client;
  const TriagePage({super.key, this.client});

  @override
  State<TriagePage> createState() => _TriagePageState();
}

class _TriagePageState extends State<TriagePage> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  final Set<String> _processing = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final c = widget.client;
    if (c == null) {
      setState(() { _loading = false; });
      return;
    }
    setState(() { _loading = true; });
    try {
      final items = await c.listTriageItems();
      if (!mounted) return;
      setState(() { _items = items; _loading = false; });
    } catch (_) {
      if (!mounted) return;
      setState(() { _loading = false; });
    }
  }

  Future<void> _decide(String id, {required bool accept}) async {
    final c = widget.client;
    if (c == null) return;
    setState(() { _processing.add(id); });
    try {
      await c.proposeTriageDecision(id, accept: accept);
      if (!mounted) return;
      // Remove from list after successful decision
      setState(() { _items.removeWhere((e) => (e['id'] ?? '').toString() == id); });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text('操作失败: $e')));
    } finally {
      if (mounted) setState(() { _processing.remove(id); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Triage 待决项'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), tooltip: '刷新', onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _items.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.check_circle_outline, size: 48, color: Colors.grey.shade400),
                      const SizedBox(height: 12),
                      Text('暂无待决项', style: TextStyle(color: Colors.grey.shade600, fontSize: 14)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: _items.length,
                    itemBuilder: (ctx, i) => _TriageCard(
                      item: _items[i],
                      processing: _processing.contains((_items[i]['id'] ?? '').toString()),
                      onAccept: () => _decide((_items[i]['id'] ?? '').toString(), accept: true),
                      onReject: () => _decide((_items[i]['id'] ?? '').toString(), accept: false),
                    ),
                  ),
                ),
    );
  }
}

class _TriageCard extends StatelessWidget {
  final Map<String, dynamic> item;
  final bool processing;
  final VoidCallback onAccept;
  final VoidCallback onReject;

  const _TriageCard({
    required this.item,
    required this.processing,
    required this.onAccept,
    required this.onReject,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // E10f-E: 唯一取值入口（title/meta/badge 兜底对齐真实 wire；不再读 reason/type/origin）。
    final model = triageCardModel(item);
    final badgeColor = switch (model.badge.tone) {
      TriageTone.warn => kMafwGoalActive,
      TriageTone.neutral => scheme.onSurfaceVariant,
      TriageTone.danger => scheme.error,
    };

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
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: badgeColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(model.badge.label,
                      style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: badgeColor)),
                ),
                const Spacer(),
                if (processing)
                  const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
              ],
            ),
            const SizedBox(height: 8),
            Text(model.title, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: scheme.onSurface)),
            if (model.meta.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(model.meta,
                  style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis),
            ],
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: processing ? null : onReject,
                  child: const Text('拒绝'),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: processing ? null : onAccept,
                  style: FilledButton.styleFrom(backgroundColor: kMafwPrimary),
                  child: const Text('接受'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
