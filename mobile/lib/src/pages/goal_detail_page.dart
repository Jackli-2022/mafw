import 'dart:async';

import 'package:flutter/material.dart';

import '../network/gateway_client.dart';
import '../theme.dart';

/// Goal detail page — shows a single goal's status, evidence, and sessions.
class GoalDetailPage extends StatefulWidget {
  final GatewayClient? client;
  final String goalId;
  final String goalTitle;
  final String goalStatus;

  const GoalDetailPage({
    super.key,
    this.client,
    required this.goalId,
    required this.goalTitle,
    required this.goalStatus,
  });

  @override
  State<GoalDetailPage> createState() => _GoalDetailPageState();
}

class _GoalDetailPageState extends State<GoalDetailPage> {
  Map<String, dynamic>? _goal;
  bool _loading = true;

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
    try {
      final goal = await c.getGoal(widget.goalId);
      if (!mounted) return;
      setState(() { _goal = goal; _loading = false; });
    } catch (_) {
      if (!mounted) return;
      setState(() { _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final g = _goal;
    final title = g?['title'] ?? g?['name'] ?? widget.goalTitle;
    final status = (g?['status'] ?? g?['state'] ?? widget.goalStatus).toString();
    final active = status == 'active' || status == 'in_progress' || status == 'running';
    final description = (g?['description'] ?? g?['goal'] ?? '').toString();
    final progress = g?['progress'] is num ? (g!['progress'] as num).toDouble() : null;
    final created = g?['created_at'] ?? g?['createdAt'];
    final sessions = g?['sessions'] is List ? g!['sessions'] as List : <dynamic>[];
    final evidence = g?['evidence'] is List ? g!['evidence'] as List : <dynamic>[];

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title.toString(), style: const TextStyle(fontSize: 15)),
            Text(status, style: TextStyle(fontSize: 11, color: active ? kMafwGoalActive : Colors.grey)),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), tooltip: '刷新', onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Status card
                Card(
                  color: scheme.surfaceContainerHighest,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            CircleAvatar(
                              radius: 16,
                              backgroundColor: active ? kMafwGoalActive.withValues(alpha: 0.2) : Colors.grey.withValues(alpha: 0.15),
                              child: Icon(Icons.flag, size: 18, color: active ? kMafwGoalActive : Colors.grey),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(title.toString(), style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: scheme.onSurface)),
                                  const SizedBox(height: 2),
                                  Text(status, style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                                ],
                              ),
                            ),
                            if (active)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: kMafwGoalActive.withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: const Text('进行中', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: kMafwGoalActive)),
                              ),
                          ],
                        ),
                        if (description.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          Text(description, style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant, height: 1.5)),
                        ],
                        if (progress != null) ...[
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Expanded(
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(4),
                                  child: LinearProgressIndicator(
                                    value: progress.clamp(0.0, 1.0),
                                    minHeight: 6,
                                    backgroundColor: scheme.surfaceContainer,
                                    color: mafwEnergyColor(progress),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text('${(progress * 100).toInt()}%', style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // Evidence section
                if (evidence.isNotEmpty) ...[
                  Text('证据', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: scheme.onSurface)),
                  const SizedBox(height: 8),
                  ...evidence.map((e) => Card(
                    margin: const EdgeInsets.only(bottom: 6),
                    color: scheme.surfaceContainerHighest,
                    child: ListTile(
                      leading: Icon(Icons.electric_bolt, size: 18, color: kMafwGoalActive),
                      title: Text(e.toString(), maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13)),
                    ),
                  )),
                  const SizedBox(height: 16),
                ],

                // Sessions section
                if (sessions.isNotEmpty) ...[
                  Text('关联会话 (${sessions.length})', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: scheme.onSurface)),
                  const SizedBox(height: 8),
                  ...sessions.map((s) => Card(
                    margin: const EdgeInsets.only(bottom: 6),
                    color: scheme.surfaceContainerHighest,
                    child: ListTile(
                      leading: CircleAvatar(
                        radius: 14,
                        backgroundColor: kMafwSubagent.withValues(alpha: 0.2),
                        child: Icon(Icons.chat_bubble, size: 14, color: kMafwSubagent),
                      ),
                      title: Text(s.toString(), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13)),
                    ),
                  )),
                ],

                // Empty state
                if (description.isEmpty && progress == null && evidence.isEmpty && sessions.isEmpty && !_loading)
                  Padding(
                    padding: const EdgeInsets.only(top: 40),
                    child: Center(
                      child: Column(
                        children: [
                          Icon(Icons.flag_outlined, size: 40, color: Colors.grey.shade400),
                          const SizedBox(height: 10),
                          Text('Goal 详情不可用', style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}
