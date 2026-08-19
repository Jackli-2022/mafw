/// Manages WebSocket connection lifecycle tied to app foreground/background transitions.
///
/// Uses WidgetsBindingObserver to detect pause/resume and triggers
/// disconnect/connect callbacks accordingly. Also handles reconnect scheduling.
library;

import 'dart:async';

import 'package:flutter/material.dart';

class LifecycleWsManager with WidgetsBindingObserver {
  final Future<void> Function() onConnect;
  final Future<void> Function() onDisconnect;

  Timer? _reconnectTimer;
  bool _disposed = false;
  bool _isResumed = true;

  bool get isResumed => _isResumed;
  bool get isInBackground => !_isResumed;

  LifecycleWsManager({required this.onConnect, required this.onDisconnect}) {
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_disposed) return;
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
        pause();
        break;
      case AppLifecycleState.resumed:
        resume();
        break;
      case AppLifecycleState.hidden:
        // Hidden but still alive — keep connection
        break;
    }
  }

  Future<void> pause() async {
    if (_disposed || !_isResumed) return;
    _isResumed = false;
    _reconnectTimer?.cancel();
    try {
      await onDisconnect();
    } catch (_) {
      // Swallow — disconnect failure should not crash lifecycle.
    }
  }

  Future<void> resume() async {
    if (_disposed || _isResumed) return;
    _isResumed = true;
    try {
      await onConnect();
    } catch (_) {
      // Swallow — connect failure should not crash lifecycle.
    }
  }

  /// Schedule a reconnect after [delay]. If [onReconnect] is provided,
  /// it's called instead of the default onConnect.
  void scheduleReconnect(
    Duration delay, {
    Future<void> Function()? onReconnect,
  }) {
    if (_disposed) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, () async {
      if (_disposed) return;
      if (onReconnect != null) {
        await onReconnect();
      } else {
        await onConnect();
      }
    });
  }

  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
  }
}
