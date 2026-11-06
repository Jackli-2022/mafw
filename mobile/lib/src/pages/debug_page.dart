/// Dev-only diagnostics page (docs/architecture/mobile.md §7.2).
///
/// Shows the connection snapshot, the last WS frames with their parse verdicts,
/// the recent HTTP log, and a one-tap copyable diagnostics bundle (token
/// masked). Reachable from 「我的」 only when [debugPanelEnabled].
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../network/gateway_client.dart';
import '../services/diagnostics.dart';

/// Connection diagnosis + event inspector + HTTP log (read-only).
class DebugPage extends StatefulWidget {
  final DiagnosticsSink? diagnostics;
  final GatewayClient? client;
  final String? baseUrl;
  final bool Function()? wsConnected;
  final Future<bool> Function()? healthProbe;

  /// Clipboard hook (injectable so tests can capture the bundle text).
  final Future<void> Function(String text)? copyToClipboard;

  const DebugPage({
    super.key,
    this.diagnostics,
    this.client,
    this.baseUrl,
    this.wsConnected,
    this.healthProbe,
    this.copyToClipboard,
  });

  @override
  State<DebugPage> createState() => _DebugPageState();
}

class _DebugPageState extends State<DebugPage> {
  late final DiagnosticsSink _sink = widget.diagnostics ?? DiagnosticsSink();
  bool _probing = false;
  String? _healthResult;
  bool _wsConnected = false;

  @override
  void initState() {
    super.initState();
    _wsConnected = widget.wsConnected?.call() ?? false;
  }

  String get _baseUrl => widget.baseUrl ?? widget.client?.config.baseUrl ?? _sink.baseUrl;

  String get _tokenText => _sink.hasToken ? _sink.maskedToken : '未设置';

  Future<void> _probe() async {
    setState(() {
      _probing = true;
      _healthResult = null;
    });

    final probe = widget.healthProbe;
    final client = widget.client;
    var ok = false;
    if (probe != null) {
      ok = await probe();
    } else if (client != null) {
      ok = await client.health();
    }

    if (!mounted) return;
    setState(() {
      _probing = false;
      _healthResult = ok ? '连接正常（GET /health 200）' : '连接失败：无法访问 /health';
    });
  }

  Future<void> _copyBundle() async {
    final text = const JsonEncoder.withIndent('  ').convert(_sink.export());
    final copy = widget.copyToClipboard;
    if (copy != null) {
      await copy(text);
    } else {
      await Clipboard.setData(ClipboardData(text: text));
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('诊断包已复制到剪贴板'), duration: Duration(seconds: 2)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final frames = _sink.wsFrames;
    final http = _sink.httpEntries;

    return Scaffold(
      appBar: AppBar(title: const Text('调试')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _copyBundle,
        icon: const Icon(Icons.copy_all),
        label: const Text('复制诊断包'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          _ConnectionCard(
            baseUrl: _baseUrl,
            token: _tokenText,
            wsConnected: _wsConnected,
            lastFrameAt: _sink.lastFrameAt,
            probing: _probing,
            healthResult: _healthResult,
            onProbe: _probe,
          ),
          const SizedBox(height: 20),
          _SectionHeader(title: '事件检查器', count: frames.length, hint: '缓冲 200 · 显示最近 50'),
          if (frames.isEmpty)
            const _EmptyHint('暂无 WS 帧（连接后事件会出现在这里）')
          else
            ...frames.reversed.take(50).map((f) => _WsFrameCard(frame: f)),
          const SizedBox(height: 20),
          _SectionHeader(title: 'HTTP 日志', count: http.length, hint: '缓冲 100 · 显示最近 50'),
          if (http.isEmpty)
            const _EmptyHint('暂无 HTTP 请求')
          else
            ...http.reversed.take(50).map((e) => _HttpEntryCard(entry: e)),
          const SizedBox(height: 12),
          Text(
            '提示：诊断包已脱敏（API Token 只保留末 4 位）。release 包需 --dart-define=ORCALORE_DEBUG_PANEL=true 才显示本页。',
            style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _ConnectionCard extends StatelessWidget {
  final String baseUrl;
  final String token;
  final bool wsConnected;
  final DateTime? lastFrameAt;
  final bool probing;
  final String? healthResult;
  final Future<void> Function() onProbe;

  const _ConnectionCard({
    required this.baseUrl,
    required this.token,
    required this.wsConnected,
    required this.lastFrameAt,
    required this.probing,
    required this.healthResult,
    required this.onProbe,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('连接', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            _KvRow(label: 'Base URL', value: baseUrl.isEmpty ? '未配置' : baseUrl),
            _KvRow(label: 'API Token', value: token),
            _KvRow(label: 'WS 状态', value: wsConnected ? '已连接' : '未连接'),
            _KvRow(label: '最后帧', value: _formatTime(lastFrameAt)),
            const SizedBox(height: 8),
            Row(
              children: [
                FilledButton.tonalIcon(
                  onPressed: probing ? null : onProbe,
                  icon: probing
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.network_check, size: 18),
                  label: const Text('检测连接'),
                ),
                const SizedBox(width: 12),
                if (healthResult != null)
                  Expanded(
                    child: Text(
                      healthResult!,
                      style: TextStyle(
                        fontSize: 12,
                        color: healthResult!.startsWith('连接正常') ? scheme.primary : scheme.error,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _KvRow extends StatelessWidget {
  final String label;
  final String value;

  const _KvRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(label, style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(fontSize: 12), maxLines: 2, overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final int count;
  final String hint;

  const _SectionHeader({required this.title, required this.count, required this.hint});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(width: 8),
          Text('$count 条 · $hint', style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant)),
        ],
      ),
    );
  }
}

class _EmptyHint extends StatelessWidget {
  final String text;
  const _EmptyHint(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Text(
        text,
        style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant),
      ),
    );
  }
}

class _WsFrameCard extends StatelessWidget {
  final WsFrameEntry frame;
  const _WsFrameCard({required this.frame});

  Color _kindColor(ColorScheme scheme) => switch (frame.kind) {
        WsFrameKind.canonical => scheme.primary,
        WsFrameKind.flat => scheme.tertiary,
        WsFrameKind.discarded => scheme.error,
      };

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final meta = <String>[
      if (frame.type != null) frame.type!,
      if (frame.effect != null) 'effect: ${frame.effect}',
      if (frame.reason != null) frame.reason!,
      _formatTime(frame.at),
    ].join(' · ');

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: scheme.surfaceContainer,
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: _kindColor(scheme).withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    frame.kind.label,
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: _kindColor(scheme)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    meta,
                    style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              frame.raw,
              maxLines: 6,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }
}

class _HttpEntryCard extends StatelessWidget {
  final HttpEntry entry;
  const _HttpEntryCard({required this.entry});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final failed = entry.error != null || (entry.status ?? 0) >= 400;
    final status = entry.error != null ? 'ERR' : '${entry.status ?? '—'}';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: scheme.surfaceContainer,
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  entry.method,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: failed ? scheme.error : scheme.primary,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    entry.path,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
                  ),
                ),
                Text(
                  '$status · ${entry.durationMs}ms',
                  style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
                ),
              ],
            ),
            if (entry.error != null || entry.errorBody != null) ...[
              const SizedBox(height: 4),
              Text(
                entry.error ?? entry.errorBody!,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, color: scheme.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

String _formatTime(DateTime? at) {
  if (at == null) return '—';
  final local = at.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.hour)}:${two(local.minute)}:${two(local.second)}';
}
