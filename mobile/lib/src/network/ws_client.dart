/// WebSocket client for the gateway /api/ws endpoint.
///
/// Receives the same event stream as SSE (opencode_event / goal_* / etc.),
/// plus upstream `send` commands. Auto-reconnects with jittered backoff (capped
/// at 30s); prefers Bearer header over query token for auth.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../config/connection_config.dart';
import '../models/mafw_models.dart';

class WsClient {
  final ConnectionConfig config;
  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _reconnectTimer;
  bool _disposed = false;
  int _attempts = 0;

  final _events = StreamController<MafwEvent>.broadcast();
  final _status = StreamController<bool>.broadcast(); // connected

  Stream<MafwEvent> get events => _events.stream;
  Stream<bool> get connectionStatus => _status.stream;
  bool get isConnected => _channel != null;

  WsClient(this.config);

  Future<void> connect() async {
    if (_disposed) return;
    _channel?.sink.close();
    try {
      final wsUrl = Uri.parse(config.wsUrl);
      // Prefer query token for auth (web_socket_channel 3.x doesn't support
      // custom headers directly; Bearer header via query param is the fallback).
      final url = config.apiToken.isNotEmpty
          ? wsUrl.replace(queryParameters: {...wsUrl.queryParameters, 'token': config.apiToken})
          : wsUrl;
      final channel = WebSocketChannel.connect(url);
      _channel = channel;

      _sub = channel.stream.listen(
        (data) {
          _attempts = 0;
          try {
            final j = jsonDecode(data.toString()) as Map<String, dynamic>;
            _events.add(MafwEvent.fromJson(j));
          } catch (_) {
            // ignore malformed frames
          }
        },
        onError: (Object e) => _scheduleReconnect(),
        onDone: () => _scheduleReconnect(),
        cancelOnError: true,
      );
      _status.add(true);
    } catch (_) {
      _scheduleReconnect();
    }
  }

  /// Force a reconnect (e.g., after connectivity change).
  Future<void> reconnect() async {
    _attempts = 0;
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _channel = null;
    _status.add(false);
    await connect();
  }

  /// Close the WebSocket connection without disposing the client.
  /// Used by lifecycle management — the client remains usable for reconnect.
  void disconnect() {
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _channel = null;
    _status.add(false);
  }

  void _scheduleReconnect() {
    if (_disposed) return;
    _channel = null;
    _status.add(false);
    _reconnectTimer?.cancel();
    // Exponential backoff spec §5.2 / plan Task3: [1,2,5,10,15,30] + jitter 0-500ms, capped 30s
    // web_socket_channel 3.x removed headers param (see mem 17) — query token fallback retained
    final baseTable = [1, 2, 5, 10, 15, 30];
    final baseSec = baseTable[_attempts.clamp(0, 5)];
    final jitterMs = (Random().nextDouble() * 500).round();
    final delayMs = min(baseSec * 1000 + jitterMs, 30000);
    _attempts++;
    _reconnectTimer = Timer(Duration(milliseconds: delayMs), () => connect());
  }

  /// Send a chat message upstream. The gateway injects memory context.
  Future<void> send(String message, {String? sessionID}) async {
    final ch = _channel;
    if (ch == null) throw StateError('not connected');
    ch.sink.add(jsonEncode({
      'type': 'send',
      'message': message,
      if (sessionID != null) 'sessionID': sessionID,
    }));
  }

  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _sub?.cancel();
    _channel?.sink.close();
    _events.close();
    _status.close();
  }
}
