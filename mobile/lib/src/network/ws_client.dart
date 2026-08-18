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
      // Prefer Bearer header over query token for auth
      final headers = <String, String>{};
      if (config.apiToken.isNotEmpty) {
        headers['Authorization'] = 'Bearer ${config.apiToken}';
      }
      final channel = headers.isNotEmpty
          ? WebSocketChannel.connect(wsUrl, headers: headers)
          : WebSocketChannel.connect(wsUrl);
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

  void _scheduleReconnect() {
    if (_disposed) return;
    _channel = null;
    _status.add(false);
    _reconnectTimer?.cancel();
    // Exponential backoff with jitter, capped at 30s
    final baseDelay = [1, 2, 5, 10, 20, 30][_attempts.clamp(0, 5)];
    final jitter = Random().nextDouble() * baseDelay * 0.3;
    final delaySec = min(baseDelay + jitter, 30).round();
    _attempts++;
    _reconnectTimer = Timer(Duration(seconds: delaySec), () => connect());
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
