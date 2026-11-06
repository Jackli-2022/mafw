/// WebSocket client with smart reconnection for the gateway /api/ws endpoint.
///
/// Features:
/// - **Header auth**: `Authorization: Bearer <apiToken>` on the upgrade request
///   (`package:web_socket_channel/io.dart` → dart:io `WebSocket.connect`, which
///   supports custom headers; only Flutter Web lacks them). The token no longer
///   travels in the URL. `?deviceId=` is preserved for push presence.
/// - Smart reconnection with persistent state ([SmartReconnectManager])
/// - Maximum retry attempts (10), exponential backoff with jitter
/// - Reset after a successful handshake
/// - Structured [errors] stream + [onRawFrame] tap for the dev diagnostics panel
library;

import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../config/connection_config.dart';
import '../models/mafw_models.dart';
import '../services/smart_reconnect.dart';
import 'ws_client_interface.dart';

class WsClientV2 implements MafwWsClient {
  final ConnectionConfig config;

  /// Optional push-presence device id. When non-empty it is appended to the
  /// upgrade URL as `?deviceId=` so the gateway's PushGateway can track which
  /// sockets belong to which device (wire contract: `gateway/src/index.ts`
  /// reads `deviceId` from the upgrade query).
  final String? deviceId;

  /// Raw-frame tap for the dev diagnostics panel (`DiagnosticsSink.recordWsFrame`).
  ///
  /// Fires on every frame **before** parsing so discarded/malformed frames are
  /// observable too. Kept optional/nullable so release builds pay nothing.
  final void Function(String raw)? onRawFrame;

  final SmartReconnectManager _reconnectManager = SmartReconnectManager();

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _sub;
  Timer? _reconnectTimer;
  bool _disposed = false;
  bool _intentionalDisconnect = false;
  bool _connected = false;

  /// A backoff delay is being computed (guards the async gap in nextDelay()).
  bool _reconnectPending = false;

  /// Monotonic attempt id: callbacks from a superseded socket are ignored.
  int _attemptSeq = 0;

  final _events = StreamController<MafwEvent>.broadcast();
  final _status = StreamController<bool>.broadcast(); // connected
  final _errors = StreamController<WsError>.broadcast(); // errors

  @override
  Stream<MafwEvent> get events => _events.stream;

  @override
  Stream<bool> get connectionStatus => _status.stream;

  Stream<WsError> get errors => _errors.stream;

  @override
  bool get isConnected => _connected;

  /// `/api/ws` upgrade target: `ws(s)://host/api/ws` (+ `?deviceId=`).
  ///
  /// No `?token=`: URLs leak into proxy/access logs and the gateway accepts the
  /// Bearer header on upgrades (`authorizeWsUpgrade` in `gateway/src/core/auth.ts`).
  Uri get endpointUri {
    final base = Uri.parse(config.wsUrl);
    final extra = <String, String>{};
    final id = deviceId;
    if (id != null && id.isNotEmpty) extra['deviceId'] = id;
    if (extra.isEmpty) return base;
    return base.replace(queryParameters: {...base.queryParameters, ...extra});
  }

  /// Upgrade headers — Bearer auth only when a token is configured.
  Map<String, String> get upgradeHeaders => {
        if (config.apiToken.isNotEmpty)
          'Authorization': 'Bearer ${config.apiToken}',
      };

  WsClientV2(this.config, {this.onRawFrame, this.deviceId});

  /// Initialize the client, loading persisted reconnection state.
  ///
  /// Call once before [connect] so a retry budget exhausted in a previous app
  /// run is honoured instead of restarting the backoff sequence from zero.
  Future<void> init() async {
    await _reconnectManager.init();
  }

  @override
  Future<void> connect() async {
    if (_disposed || _intentionalDisconnect) return;

    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    await _teardownChannel();

    final seq = ++_attemptSeq;
    try {
      final channel = IOWebSocketChannel.connect(
        endpointUri,
        headers: upgradeHeaders,
      );
      _channel = channel;

      // Await the handshake so a rejected upgrade (401 from authorizeWsUpgrade)
      // surfaces as a connection error instead of a false "connected" blip.
      await channel.ready;
      if (!_isCurrentAttempt(seq)) {
        // Superseded by a newer attempt / background disconnect while the
        // handshake was in flight — drop this socket without touching state.
        if (identical(_channel, channel)) _channel = null;
        unawaited(_closeChannel(channel));
        return;
      }

      _sub = channel.stream.listen(
        _onFrame,
        onError: (Object e) => _handleSocketError(seq, e),
        onDone: () => _handleSocketDone(seq),
        cancelOnError: true,
      );
      _setConnected(true);
      // Persist the success (resets the retry budget) — once per handshake,
      // never per frame.
      unawaited(_reconnectManager.onSuccess());
    } catch (e) {
      _handleSocketError(seq, e);
    }
  }

  /// Force a reconnect (e.g. after connectivity change or foreground resume).
  @override
  Future<void> reconnect() async {
    if (_disposed) return;
    _intentionalDisconnect = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    await _reconnectManager.reset();
    await connect();
  }

  /// Close the WebSocket connection without disposing the client.
  /// Used by lifecycle management — the client remains usable for reconnect.
  @override
  void disconnect() {
    _intentionalDisconnect = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _attemptSeq++; // invalidate any in-flight handshake
    _releaseSocket();
    _setConnected(false);
  }

  /// Resume after an intentional [disconnect] (app back to foreground).
  void resume() {
    if (_disposed || !_intentionalDisconnect) return;
    unawaited(reconnect());
  }

  /// Send a chat message upstream. The gateway injects memory context.
  @override
  Future<void> send(String message, {String? sessionID}) async {
    final ch = _channel;
    if (ch == null) throw StateError('not connected');
    ch.sink.add(jsonEncode({
      'type': 'send',
      'message': message,
      'sessionID': ?sessionID,
    }));
  }

  /// Send a heartbeat to keep connection alive.
  Future<void> sendHeartbeat() async {
    final ch = _channel;
    if (ch == null) return;

    try {
      ch.sink.add(jsonEncode({
        'type': 'heartbeat',
        'timestamp': DateTime.now().toIso8601String(),
      }));
    } catch (_) {
      // Heartbeat failed, connection might be dead
      _handleSocketError(_attemptSeq, 'Heartbeat failed');
    }
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _releaseSocket();
    _events.close();
    _status.close();
    _errors.close();
  }

  // --- Private -------------------------------------------------------------

  bool _isCurrentAttempt(int seq) =>
      !_disposed && !_intentionalDisconnect && seq == _attemptSeq;

  void _onFrame(dynamic data) {
    final raw = data.toString();
    onRawFrame?.call(raw);
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic> && !_events.isClosed) {
        _events.add(MafwEvent.fromJson(decoded));
      }
    } catch (_) {
      // ignore malformed frames (the diagnostics tap already recorded them)
    }
  }

  /// Handle connection error with smart reconnection.
  void _handleSocketError(int seq, Object error) {
    if (!_isCurrentAttempt(seq)) return;
    _emitError(WsError(
      type: WsErrorType.connection,
      message: error.toString(),
      originalError: error,
    ));
    _onSocketLost();
  }

  /// Handle connection done (server closed connection).
  void _handleSocketDone(int seq) {
    if (!_isCurrentAttempt(seq)) return;
    _emitError(WsError(
      type: WsErrorType.disconnection,
      message: 'WebSocket connection closed by server',
    ));
    _onSocketLost();
  }

  void _onSocketLost() {
    _releaseSocket();
    _setConnected(false);
    _scheduleReconnect();
  }

  /// Drop the current subscription + socket without touching intent flags.
  void _releaseSocket() {
    final sub = _sub;
    _sub = null;
    if (sub != null) unawaited(sub.cancel());
    final channel = _channel;
    _channel = null;
    if (channel != null) unawaited(_closeChannel(channel));
  }

  /// Teardown before a new attempt (awaited so only one live socket exists).
  Future<void> _teardownChannel() async {
    final sub = _sub;
    _sub = null;
    await sub?.cancel();
    final channel = _channel;
    _channel = null;
    await _closeChannel(channel);
  }

  Future<void> _closeChannel(WebSocketChannel? channel) async {
    if (channel == null) return;
    try {
      await channel.sink.close();
    } catch (_) {
      // already closed / never opened
    }
  }

  void _setConnected(bool value) {
    if (_connected == value) return;
    _connected = value;
    if (!_status.isClosed) _status.add(value);
  }

  void _emitError(WsError error) {
    if (_disposed || _errors.isClosed) return;
    _errors.add(error);
  }

  /// Schedule a reconnect with smart backoff (at most one pending).
  void _scheduleReconnect() {
    if (_disposed || _intentionalDisconnect || _reconnectPending) return;
    _reconnectPending = true;
    unawaited(_scheduleReconnectAsync());
  }

  Future<void> _scheduleReconnectAsync() async {
    try {
      final delay = await _reconnectManager.nextDelay();
      if (_disposed || _intentionalDisconnect) return;
      if (delay == null) {
        // Max attempts reached — stay idle until an explicit reconnect.
        _emitError(WsError(
          type: WsErrorType.maxAttempts,
          message: 'Maximum reconnection attempts reached',
        ));
        return;
      }
      _reconnectTimer?.cancel();
      _reconnectTimer = Timer(delay, () {
        _reconnectTimer = null;
        unawaited(connect());
      });
    } catch (_) {
      // Backoff bookkeeping must never take the client down; the next socket
      // loss will simply try again.
    } finally {
      _reconnectPending = false;
    }
  }
}

/// WebSocket error types.
enum WsErrorType {
  /// Connection failed
  connection,

  /// Connection was closed by server
  disconnection,

  /// Maximum reconnection attempts reached
  maxAttempts,

  /// Send failed
  send,

  /// Unknown error
  unknown,
}

/// Structured WebSocket error.
class WsError {
  final WsErrorType type;
  final String message;
  final dynamic originalError;
  final DateTime timestamp;

  WsError({
    required this.type,
    required this.message,
    this.originalError,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();

  @override
  String toString() => 'WsError($type: $message)';
}

/// Example usage:
///
/// ```dart
/// final ws = WsClientV2(config);
/// await ws.init();
///
/// // Listen for events
/// ws.events.listen((event) {
///   print('Received event: ${event.type}');
/// });
///
/// // Listen for connection status
/// ws.connectionStatus.listen((connected) {
///   print('Connected: $connected');
/// });
///
/// // Listen for errors
/// ws.errors.listen((error) {
///   print('WebSocket error: ${error.type} - ${error.message}');
/// });
///
/// // Connect
/// await ws.connect();
///
/// // Send messages
/// await ws.send('Hello, gateway!');
///
/// // Heartbeat for background keepalive
/// Timer.periodic(Duration(seconds: 30), (_) => ws.sendHeartbeat());
/// ```
