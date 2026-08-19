import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

import '../network/gateway_client.dart';

/// Monitors network connectivity changes and triggers reconnect with
/// debouncing and health probing (spec §5.2 I6 fix).
///
/// Debounces flaps (WiFi↔Mobile) by 500ms and probes Gateway health
/// before reconnecting, avoiding WS storm on transient changes.
class ConnectivityWatcher {
  final Future<void> Function() onChanged;
  final Future<bool> Function() healthProbe;
  final Connectivity _connectivity;
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  ConnectivityResult? _lastResult;
  Timer? _debounceTimer;

  ConnectivityWatcher({
    required this.onChanged,
    Future<bool> Function()? healthProbe,
    GatewayClient? client,
    Connectivity? connectivity,
  })  : healthProbe = healthProbe ?? client?.health ?? (() async => true),
        _connectivity = connectivity ?? Connectivity();

  /// Start listening for connectivity changes.
  void start() {
    _subscription?.cancel();
    _subscription = _connectivity.onConnectivityChanged.listen((results) {
      final current = results.isNotEmpty ? results.first : ConnectivityResult.none;
      if (_lastResult != null && current != _lastResult) {
        _debounceTimer?.cancel();
        _debounceTimer = Timer(const Duration(milliseconds: 500), () async {
          final ok = await healthProbe();
          if (ok) await onChanged();
        });
      }
      _lastResult = current;
    });
  }

  /// Stop listening.
  void dispose() {
    _debounceTimer?.cancel();
    _subscription?.cancel();
    _subscription = null;
  }
}
