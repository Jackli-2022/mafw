import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

/// Monitors network connectivity changes and triggers a callback when
/// the connection type changes (e.g., WiFi ↔ Mobile ↔ None).
///
/// Usage:
/// ```dart
/// final watcher = ConnectivityWatcher(onChanged: () => wsClient.reconnect());
/// watcher.start();
/// // ... later
/// watcher.dispose();
/// ```
class ConnectivityWatcher {
  final VoidCallback onChanged;
  final Connectivity _connectivity;
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  ConnectivityResult? _lastResult;

  ConnectivityWatcher({required this.onChanged, Connectivity? connectivity})
      : _connectivity = connectivity ?? Connectivity();

  /// Start listening for connectivity changes.
  void start() {
    _subscription?.cancel();
    _subscription = _connectivity.onConnectivityChanged.listen((results) {
      final current = results.isNotEmpty ? results.first : ConnectivityResult.none;
      if (_lastResult != null && current != _lastResult) {
        onChanged();
      }
      _lastResult = current;
    });
  }

  /// Stop listening.
  void dispose() {
    _subscription?.cancel();
    _subscription = null;
  }
}
