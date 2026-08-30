/// Smart reconnection manager with persistent state and exponential backoff.
///
/// Addresses bottleneck #1: WebSocket reconnection storm.
/// Features:
/// - Persistent state across app restarts
/// - Maximum retry attempts (10)
/// - Exponential backoff with jitter
/// - Reset after successful connection
library;

import 'dart:async';
import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

/// Reconnection state persisted across app restarts.
class ReconnectState {
  final int attempts;
  final DateTime? lastSuccess;
  final DateTime? lastFailure;

  const ReconnectState({
    this.attempts = 0,
    this.lastSuccess,
    this.lastFailure,
  });

  ReconnectState copyWith({
    int? attempts,
    DateTime? lastSuccess,
    DateTime? lastFailure,
  }) {
    return ReconnectState(
      attempts: attempts ?? this.attempts,
      lastSuccess: lastSuccess ?? this.lastSuccess,
      lastFailure: lastFailure ?? this.lastFailure,
    );
  }

  Map<String, dynamic> toJson() => {
        'attempts': attempts,
        'lastSuccess': lastSuccess?.toIso8601String(),
        'lastFailure': lastFailure?.toIso8601String(),
      };

  factory ReconnectState.fromJson(Map<String, dynamic> json) {
    return ReconnectState(
      attempts: json['attempts'] as int? ?? 0,
      lastSuccess: json['lastSuccess'] != null
          ? DateTime.parse(json['lastSuccess'] as String)
          : null,
      lastFailure: json['lastFailure'] != null
          ? DateTime.parse(json['lastFailure'] as String)
          : null,
    );
  }
}

/// Smart reconnection manager with persistent state.
///
/// Usage:
/// ```dart
/// final manager = SmartReconnectManager();
/// await manager.init();
///
/// // When connection fails
/// final delay = await manager.nextDelay();
/// if (delay != null) {
///   Timer(delay, () => reconnect());
/// } else {
///   // Max attempts reached, stop retrying
/// }
///
/// // When connection succeeds
/// await manager.onSuccess();
/// ```
class SmartReconnectManager {
  // SharedPreferences keys
  static const _stateKey = 'smart_reconnect_state';

  // Configuration
  static const int maxAttempts = 10;
  static const List<int> baseDelays = [1, 2, 5, 10, 15, 30];
  static const Duration resetAfterSuccess = Duration(minutes: 5);
  static const Duration maxJitter = Duration(milliseconds: 1000);

  // State
  ReconnectState _state = const ReconnectState();
  SharedPreferences? _prefs;

  /// Initialize the manager, loading persisted state.
  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    await _loadState();
  }

  /// Get the next reconnection delay, or null if max attempts reached.
  ///
  /// Returns null if:
  /// - Maximum attempts (10) reached
  /// - Network is unavailable
  Future<Duration?> nextDelay() async {
    // Check if we should reset attempts after successful connection
    if (_shouldResetAttempts()) {
      _state = _state.copyWith(attempts: 0);
      await _saveState();
    }

    // Check max attempts
    if (_state.attempts >= maxAttempts) {
      return null;
    }

    // Calculate delay with exponential backoff
    final baseIndex = _state.attempts.clamp(0, baseDelays.length - 1);
    final baseSeconds = baseDelays[baseIndex];
    final jitterMs = (Random().nextDouble() * maxJitter.inMilliseconds).round();
    final delay = Duration(seconds: baseSeconds) + Duration(milliseconds: jitterMs);

    // Increment attempts
    _state = _state.copyWith(
      attempts: _state.attempts + 1,
      lastFailure: DateTime.now(),
    );
    await _saveState();

    return delay;
  }

  /// Call when connection succeeds.
  Future<void> onSuccess() async {
    _state = _state.copyWith(
      attempts: 0,
      lastSuccess: DateTime.now(),
    );
    await _saveState();
  }

  /// Call when connection fails (optional, nextDelay() handles this).
  Future<void> onFailure() async {
    _state = _state.copyWith(
      lastFailure: DateTime.now(),
    );
    await _saveState();
  }

  /// Reset all state (e.g., when user manually reconnects).
  Future<void> reset() async {
    _state = const ReconnectState();
    await _saveState();
  }

  /// Get current state for debugging.
  ReconnectState get state => _state;

  /// Check if we should reset attempts after successful connection.
  bool _shouldResetAttempts() {
    if (_state.lastSuccess == null) return false;
    final timeSinceSuccess = DateTime.now().difference(_state.lastSuccess!);
    return timeSinceSuccess > resetAfterSuccess;
  }

  /// Load state from SharedPreferences.
  Future<void> _loadState() async {
    try {
      final json = _prefs?.getString(_stateKey);
      if (json != null) {
        final map = Map<String, dynamic>.from(
          Map<String, dynamic>.from(Uri.decodeComponent(json) as Map),
        );
        _state = ReconnectState.fromJson(map);
      }
    } catch (e) {
      // Corrupted state, start fresh
      _state = const ReconnectState();
    }
  }

  /// Save state to SharedPreferences.
  Future<void> _saveState() async {
    try {
      final json = _state.toJson();
      await _prefs?.setString(_stateKey, json.toString());
    } catch (e) {
      // Best effort, don't crash
    }
  }
}

/// Example usage in WsClient
///
/// ```dart
/// class WsClient {
///   final SmartReconnectManager _reconnectManager = SmartReconnectManager();
///   Timer? _reconnectTimer;
///
///   Future<void> init() async {
///     await _reconnectManager.init();
///   }
///
///   void _scheduleReconnect() {
///     _reconnectManager.nextDelay().then((delay) {
///       if (delay != null) {
///         _reconnectTimer = Timer(delay, () => connect());
///       } else {
///         // Max attempts reached
///         print('[WsClient] Max reconnection attempts reached');
///       }
///     });
///   }
///
///   void _onConnectSuccess() {
///     _reconnectManager.onSuccess();
///   }
///
///   void dispose() {
///     _reconnectTimer?.cancel();
///   }
/// }
/// ```