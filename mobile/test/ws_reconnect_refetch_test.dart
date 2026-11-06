/// Reconnect refetch hook (Task 5).
///
/// The gateway does not replay events that were missed while the socket was
/// down, so a successful re-handshake must trigger a data refetch. `onReconnected`
/// fires **exactly once per re-established socket** and **never for the first
/// handshake** (the initial load path already fetches on its own).
///
/// The "reconnect" cases are driven by a real loopback WebSocket server:
/// 1. auto-reconnect after the server drops the first socket (SmartReconnect
///    backoff), and
/// 2. explicit `reconnect()` calls (foreground resume / manual retry).
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/network/ws_client_v2.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<void> _waitFor(
  bool Function() predicate, {
  Duration timeout = const Duration(seconds: 10),
  String? reason,
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!predicate()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('condition not met within $timeout${reason == null ? '' : ' ($reason)'}');
    }
    await Future<void>.delayed(const Duration(milliseconds: 25));
  }
}

void main() {
  late HttpServer server;
  final sockets = <WebSocket>[];
  var connections = 0;
  var dropFirstConnection = false;
  var reconnects = 0;
  WsClientV2? client;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    sockets.clear();
    connections = 0;
    dropFirstConnection = false;
    reconnects = 0;
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      connections += 1;
      final socket = await WebSocketTransformer.upgrade(request);
      sockets.add(socket);
      // Simulate the network dropping the very first socket, then keep every
      // later socket open so exactly one reconnection happens.
      if (dropFirstConnection && connections == 1) {
        await socket.close();
      }
    });
  });

  tearDown(() async {
    client?.dispose();
    // Snapshot: a pending reconnect may still be accepted by the listener.
    for (final socket in List<WebSocket>.of(sockets)) {
      await socket.close();
    }
    await server.close(force: true);
  });

  Future<WsClientV2> connect() async {
    final ws = WsClientV2(
      ConnectionConfig(
        baseUrl: 'http://127.0.0.1:${server.port}',
        apiToken: 'tok-reconnect',
      ),
      onReconnected: () => reconnects += 1,
    );
    client = ws;
    await ws.init();
    await ws.connect();
    return ws;
  }

  group('WsClientV2.onReconnected', () {
    test('first connection does not fire the refetch hook', () async {
      final ws = await connect();

      expect(ws.isConnected, isTrue);
      await Future<void>.delayed(const Duration(milliseconds: 200));

      expect(connections, 1);
      expect(reconnects, 0);
    });

    test('automatic reconnect after a dropped socket fires exactly once', () async {
      dropFirstConnection = true;
      await connect();

      await _waitFor(
        () => reconnects == 1,
        reason: 'auto-reconnect hook',
      );

      expect(connections, greaterThanOrEqualTo(2));
      expect(client!.isConnected, isTrue);

      // A second connect already happened; the hook must not fire again.
      await Future<void>.delayed(const Duration(milliseconds: 300));
      expect(reconnects, 1);
    });

    test('every explicit reconnect fires once more', () async {
      final ws = await connect();
      expect(reconnects, 0);

      await ws.reconnect();
      expect(reconnects, 1);

      await ws.reconnect();
      expect(reconnects, 2);
    });
  });
}
