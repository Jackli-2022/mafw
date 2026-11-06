/// Unified WebSocket client surface for the mobile app.
///
/// Pages/services depend on this interface, not on a concrete implementation:
/// `WsClient` (v1, fixed backoff) and `WsClientV2` (smart reconnection with
/// persistent state) both implement it, so wiring the v2 client in `main.dart`
/// is a one-line swap for every consumer.
///
/// See `mobile/BRAINSTORMING_V2.md` §5.1 (方案 A) for the rationale.
library;

import '../models/mafw_models.dart';

abstract class MafwWsClient {
  /// Canonical event stream from the gateway `/api/ws` endpoint.
  Stream<MafwEvent> get events;

  /// Connection status transitions (true = socket ready, false = lost/closed).
  Stream<bool> get connectionStatus;

  /// Whether the socket handshake has completed.
  bool get isConnected;

  /// Open the socket (no-op when intentionally disconnected / disposed).
  Future<void> connect();

  /// Force a reconnect (network change, foreground resume, manual retry).
  Future<void> reconnect();

  /// Close the socket but keep the client usable for a later [connect].
  void disconnect();

  /// Send a chat message upstream (the gateway injects memory context).
  Future<void> send(String message, {String? sessionID});

  /// Release resources; the instance is unusable afterwards.
  void dispose();
}
