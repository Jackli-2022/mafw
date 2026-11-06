/// Dev-only diagnostics (spec §10 / docs/architecture/mobile.md §7.2).
///
/// Injectable ring buffers: the HTTP client records every call and the WS
/// client forwards every raw frame. `export()` returns a copyable JSON bundle
/// with the API token masked — this is the no-USB log exit for real devices.
///
/// The sink is deliberately Flutter-widget-free so `flutter test` can feed
/// fixtures without a network or plugin.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../models/event_effects.dart';
import '../models/mafw_models.dart';

const bool _kDebugPanelDefine = bool.fromEnvironment('ORCALORE_DEBUG_PANEL');

/// Whether the in-app debug panel entry is visible.
///
/// Debug builds always see it; release builds only when built with
/// `--dart-define=ORCALORE_DEBUG_PANEL=true`.
bool get debugPanelEnabled => kDebugMode || _kDebugPanelDefine;

/// How a raw WS frame was interpreted by the client.
enum WsFrameKind {
  canonical,
  flat,
  discarded,
}

extension WsFrameKindLabel on WsFrameKind {
  String get label => switch (this) {
        WsFrameKind.canonical => 'canonical',
        WsFrameKind.flat => 'flat',
        WsFrameKind.discarded => 'discarded',
      };
}

/// One recorded HTTP call.
class HttpEntry {
  final DateTime at;
  final String method;
  final String path;
  final int? status;
  final int durationMs;
  final String? error;
  final String? errorBody;

  const HttpEntry({
    required this.at,
    required this.method,
    required this.path,
    this.status,
    this.durationMs = 0,
    this.error,
    this.errorBody,
  });

  Map<String, dynamic> toJson() => {
        'at': at.toUtc().toIso8601String(),
        'method': method,
        'path': path,
        'status': status,
        'durationMs': durationMs,
        if (error != null) 'error': error,
        if (errorBody != null) 'errorBody': errorBody,
      };
}

/// One recorded raw WS frame plus its parse verdict.
class WsFrameEntry {
  final DateTime at;
  final String raw;
  final WsFrameKind kind;

  /// Inner canonical type / flat frame type when parsed.
  final String? type;

  /// UI effect implied by the frame (`writing`, `refreshWork`, …) when known.
  final String? effect;

  /// Why a frame was discarded.
  final String? reason;

  const WsFrameEntry({
    required this.at,
    required this.raw,
    required this.kind,
    this.type,
    this.effect,
    this.reason,
  });

  Map<String, dynamic> toJson() => {
        'at': at.toUtc().toIso8601String(),
        'kind': kind.label,
        'raw': raw,
        if (type != null) 'type': type,
        if (effect != null) 'effect': effect,
        if (reason != null) 'reason': reason,
      };
}

/// Flat top-level events (not `mafw_event` envelopes) → work-tab effects.
/// Task 7 replaces this with the single `event_effects` table; the panel only
/// needs a human-readable hint, so a local map is enough for v1.
const Map<String, String> _kFlatEventEffects = {
  'goal_created': 'refreshWork',
  'goal_node': 'refreshWork',
  'state_change': 'refreshWork',
  'phase_transition': 'refreshWork',
  'user_question': 'refreshWork',
  'user_feedback': 'refreshWork',
  'project_registered': 'refreshProjects',
  'mafw_commands_changed': 'refreshCommands',
};

const int _kMaxWsRawChars = 8000;
const int _kMaxErrorBodyChars = 2000;

String _clip(String value, int max) {
  if (value.length <= max) return value;
  return '${value.substring(0, max)}…[truncated]';
}

/// Mask a token for display/export: keep the last 4 chars at most.
String maskToken(String token) {
  if (token.isEmpty) return '';
  if (token.length <= 4) return '••••';
  return '••••${token.substring(token.length - 4)}';
}

/// In-memory diagnostics store (HTTP 100 / WS 200 ring buffers by default).
class DiagnosticsSink {
  static const int defaultHttpCapacity = 100;
  static const int defaultWsCapacity = 200;

  final int httpCapacity;
  final int wsCapacity;
  final DateTime Function() _now;

  final List<HttpEntry> _http = [];
  final List<WsFrameEntry> _ws = [];
  String _baseUrl = '';
  String _apiToken = '';

  DiagnosticsSink({
    this.httpCapacity = defaultHttpCapacity,
    this.wsCapacity = defaultWsCapacity,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  /// Recorded HTTP calls, oldest first.
  List<HttpEntry> get httpEntries => List.unmodifiable(_http);

  /// Recorded WS frames, oldest first.
  List<WsFrameEntry> get wsFrames => List.unmodifiable(_ws);

  DateTime? get lastFrameAt => _ws.isEmpty ? null : _ws.last.at;

  String get baseUrl => _baseUrl;
  String get maskedToken => maskToken(_apiToken);
  bool get hasToken => _apiToken.isNotEmpty;

  /// Update the connection snapshot shown in the export bundle.
  void updateConnection({String? baseUrl, String? apiToken}) {
    if (baseUrl != null) _baseUrl = baseUrl;
    if (apiToken != null) _apiToken = apiToken;
  }

  /// Record one HTTP call (status for responses, error for transport failures).
  void recordHttp({
    required String method,
    required String path,
    int? status,
    int durationMs = 0,
    String? error,
    String? errorBody,
  }) {
    _push(
      _http,
      HttpEntry(
        at: _now(),
        method: method,
        path: path,
        status: status,
        durationMs: durationMs,
        error: error,
        errorBody: errorBody == null ? null : _clip(errorBody, _kMaxErrorBodyChars),
      ),
      httpCapacity,
    );
  }

  /// Record and classify one raw WS frame (including malformed ones).
  void recordWsFrame(String raw) {
    _push(_ws, _classify(raw), wsCapacity);
  }

  /// Copyable diagnostics bundle; the API token is always masked.
  Map<String, dynamic> export() => {
        'generatedAt': _now().toUtc().toIso8601String(),
        'connection': {
          'baseUrl': _baseUrl,
          'apiToken': maskedToken,
          'tokenPresent': hasToken,
        },
        'lastFrameAt': lastFrameAt?.toUtc().toIso8601String(),
        'http': _http.map((e) => e.toJson()).toList(),
        'ws': _ws.map((e) => e.toJson()).toList(),
      };

  WsFrameEntry _classify(String raw) {
    final at = _now();
    final clipped = _clip(raw, _kMaxWsRawChars);
    if (raw.trim().isEmpty) {
      return WsFrameEntry(at: at, raw: clipped, kind: WsFrameKind.discarded, reason: 'empty frame');
    }

    final Map<String, dynamic> frame;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) {
        return WsFrameEntry(
          at: at,
          raw: clipped,
          kind: WsFrameKind.discarded,
          reason: 'not a JSON object',
        );
      }
      frame = decoded;
    } catch (_) {
      return WsFrameEntry(at: at, raw: clipped, kind: WsFrameKind.discarded, reason: 'invalid JSON');
    }

    final event = MafwEvent.fromJson(frame);
    if (event.type == kMafwEventEnvelope) {
      if (!event.isCanonical) {
        final data = frame['data'];
        final inner = data is Map<String, dynamic> ? (data['type'] ?? '').toString() : '';
        return WsFrameEntry(
          at: at,
          raw: clipped,
          kind: WsFrameKind.discarded,
          reason: 'unknown canonical type: $inner',
        );
      }
      return WsFrameEntry(
        at: at,
        raw: clipped,
        kind: WsFrameKind.canonical,
        type: event.innerType,
        effect: _canonicalEffect(event.innerType),
      );
    }

    if (event.type.isEmpty) {
      return WsFrameEntry(at: at, raw: clipped, kind: WsFrameKind.discarded, reason: 'missing type');
    }

    return WsFrameEntry(
      at: at,
      raw: clipped,
      kind: WsFrameKind.flat,
      type: event.type,
      effect: _kFlatEventEffects[event.type],
    );
  }

  String? _canonicalEffect(String type) {
    final effects = chatEventEffects(type);
    final parts = <String>[];
    if (effects.writing) parts.add('writing');
    if (effects.turnEnd) parts.add('turnEnd');
    if (effects.refresh) parts.add('refresh');
    if (shouldRefreshSessions(type)) parts.add('refreshSessions');
    return parts.isEmpty ? null : parts.join('+');
  }

  void _push<T>(List<T> list, T value, int capacity) {
    list.add(value);
    if (list.length > capacity) {
      list.removeRange(0, list.length - capacity);
    }
  }
}
