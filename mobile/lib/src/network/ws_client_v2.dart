/// WebSocket client with smart reconnection for the gateway /api/ws endpoint.
///
/// Improved version with:
/// - Smart reconnection with persistent state
/// - Maximum retry attempts (10)
/// - Exponential backoff with jitter
/// - Reset after successful connection
/// - Better error handling
library;

import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../config/connection_config.dart';
import '../models/mafw_models.dart';
import '../services/smart_reconnect.dart';

class WsClientV2 {
  final ConnectionConfig config;
  final SmartReconnectManager _reconnectManager = SmartReconnectManager();
  
  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _reconnectTimer;
  bool _disposed = false;
  bool _intentionalDisconnect = false;

  final _events = StreamController<MafwEvent>.broadcast();
  final _status = StreamController<bool>.broadcast(); // connected
  final _errors = StreamController<WsError>.broadcast(); // errors

  Stream<MafwEvent> get events => _events.stream;
  Stream<bool> get connectionStatus => _status.stream;
  Stream<WsError> get errors => _errors.stream;
  bool get isConnected => _channel != null;

  WsClientV2(this.config);

  /// Initialize the client, loading persisted reconnection state.
  Future<void> init() async {
    await _reconnectManager.init();
  }

  Future<void> connect() async {
    if (_disposed || _intentionalDisconnect) return;
    
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
          // Connection successful, reset reconnection state
          _reconnectManager.onSuccess();
          
          try {
            final j = jsonDecode(data.toString()) as Map<String, dynamic>;
            _events.add(MafwEvent.fromJson(j));
          } catch (_) {
            // ignore malformed frames
          }
        },
        onError: (Object e) {
          _handleConnectionError(e);
        },
        onDone: () {
          _handleConnectionDone();
        },
        cancelOnError: true,
      );
      _status.add(true);
    } catch (e) {
      _handleConnectionError(e);
    }
  }

  /// Handle connection error with smart reconnection.
  void _handleConnectionError(dynamic error) {
    _channel = null;
    _status.add(false);
    
    // Emit error event
    _errors.add(WsError(
      type: WsErrorType.connection,
      message: error.toString(),
      originalError: error,
    ));
    
    // Schedule reconnect with smart backoff
    _scheduleReconnect();
  }

  /// Handle connection done (server closed connection).
  void _handleConnectionDone() {
    if (_intentionalDisconnect) return;
    
    _channel = null;
    _status.add(false);
    
    // Emit error event
    _errors.add(WsError(
      type: WsErrorType.disconnection,
      message: 'WebSocket connection closed by server',
    ));
    
    // Schedule reconnect with smart backoff
    _scheduleReconnect();
  }

  /// Force a reconnect (e.g., after connectivity change).
  Future<void> reconnect() async {
    _reconnectManager.reset();
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _channel = null;
    _status.add(false);
    await connect();
  }

  /// Close the WebSocket connection without disposing the client.
  /// Used by lifecycle management — the client remains usable for reconnect.
  void disconnect() {
    _intentionalDisconnect = true;
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _channel = null;
    _status.add(false);
  }

  /// Resume after intentional disconnect.
  void resume() {
    _intentionalDisconnect = false;
    connect();
  }

  /// Schedule a reconnect with smart backoff.
  void _scheduleReconnect() {
    if (_disposed || _intentionalDisconnect) return;
    
    _reconnectManager.nextDelay().then((delay) {
      if (delay != null) {
        _reconnectTimer = Timer(delay, () => connect());
      } else {
        // Max attempts reached
        _errors.add(WsError(
          type: WsErrorType.maxAttempts,
          message: 'Maximum reconnection attempts reached',
        ));
      }
    });
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
      _handleConnectionError('Heartbeat failed');
    }
  }

  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _sub?.cancel();
    _channel?.sink.close();
    _events.close();
    _status.close();
    _errors.close();
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

  const WsError({
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