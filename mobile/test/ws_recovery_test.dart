/// E5b-3 `WsClientV2` gateway-ready hook + recovered-event emit.
///
/// The replay cursor has to be baselined and (on reconnect) drained **before**
/// the UI refetches, so the client exposes the `connected` greeting through
/// [WsClientV2.onGatewayReady] together with `isReconnect`, and lets the
/// recovery service push replayed frames back into the same [events] stream
/// ([WsClientV2.emitRecovered]).
///
/// Pinned:
///  (a) `onGatewayReady` fires on the `connected` greeting, `isReconnect` false
///      on the first handshake and true on every later one;
///  (b) it is *not* fired for regular event frames;
///  (c) `emitRecovered` reaches [events] listeners exactly like a live frame;
///  (d) a throwing callback cannot take the socket down;
///  (e) when `onGatewayReady` is configured, the legacy `onReconnected` hook is
///      suppressed so recovery never runs twice.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/network/ws_client_v2.dart';

Map<String, dynamic> _greeting() => {
      'type': 'connected',
      'timestamp': DateTime.now().toUtc().toIso8601String(),
      'vocab': 'v2',
      'headSeq': 12,
      'instanceId': 'inst-test',
    };

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
  TestWidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues({});

  late HttpServer server;
  final sockets = <WebSocket>[];
  var connections = 0;
  var dropFirstConnection = false;
  WsClientV2? client;

  /// Greeting counters (true = reconnection).
  final readyFlags = <bool>[];
  final readyGreetings = <MafwEvent>[];
  var legacyReconnects = 0;

  setUp(() async {
    sockets.clear();
    connections = 0;
    dropFirstConnection = false;
    readyFlags.clear();
    readyGreetings.clear();
    legacyReconnects = 0;
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      connections += 1;
      final socket = await WebSocketTransformer.upgrade(request);
      sockets.add(socket);
      if (dropFirstConnection && connections == 1) {
        // Greet, then drop so the first handshake is a real (completed)
        // connect and the next one is a reconnection.
        socket.add(jsonEncode(_greeting()));
        await Future<void>.delayed(const Duration(milliseconds: 50));
        await socket.close();
        return;
      }
      socket.add(jsonEncode(_greeting()));
    });
  });

  tearDown(() async {
    client?.dispose();
    client = null;
    for (final socket in List<WebSocket>.of(sockets)) {
      await socket.close();
    }
    await server.close(force: true);
  });

  Future<WsClientV2> connect({
    bool withGatewayReady = true,
    bool withLegacyReconnect = false,
    bool throwInCallback = false,
  }) async {
    final ws = WsClientV2(
      ConnectionConfig(
        baseUrl: 'http://127.0.0.1:${server.port}',
        apiToken: 'tok-recovery',
      ),
      onGatewayReady: withGatewayReady
          ? (greeting, isReconnect) async {
              readyFlags.add(isReconnect);
              readyGreetings.add(greeting);
              if (throwInCallback) throw StateError('recovery blew up');
            }
          : null,
      onReconnected: withLegacyReconnect ? () => legacyReconnects += 1 : null,
    );
    client = ws;
    await ws.init();
    await ws.connect();
    return ws;
  }

  group('WsClientV2.onGatewayReady', () {
    test('fires on the first handshake with isReconnect=false', () async {
      final ws = await connect();

      await _waitFor(() => readyFlags.isNotEmpty, reason: 'first greeting');
      expect(readyFlags, [false]);
      expect(readyGreetings.single.type, 'connected');
      expect(readyGreetings.single.headSeq, 12);
      expect(readyGreetings.single.instanceId, 'inst-test');
      expect(ws.isConnected, isTrue);
    });

    test('fires with isReconnect=true after a re-handshake', () async {
      dropFirstConnection = true;
      await connect();

      await _waitFor(() => readyFlags.length >= 2, reason: 'greeting per socket');
      expect(readyFlags, [false, true]);
      expect(connections, greaterThanOrEqualTo(2));
    });

    test('ignores non-greeting frames', () async {
      final ws = await connect();
      await _waitFor(() => readyFlags.length == 1);

      final socket = sockets.last;
      final seen = <MafwEvent>[];
      final sub = ws.events.listen(seen.add);
      socket.add(jsonEncode({
        'type': 'mafw_event',
        'seq': 13,
        'data': {'type': 'message.updated', 'sessionID': 's1'},
      }));
      socket.add(jsonEncode({'type': 'goal_created', 'goalId': 'g1', 'seq': 14}));

      await _waitFor(() => seen.length >= 2, reason: 'two event frames');

      expect(readyFlags, hasLength(1));
      await sub.cancel();
    });

    test('a throwing callback cannot take the socket down', () async {
      final ws = await connect(throwInCallback: true);

      await _waitFor(() => readyFlags.isNotEmpty, reason: 'throwing greeting');
      expect(ws.isConnected, isTrue);

      final seen = <MafwEvent>[];
      final sub = ws.events.listen(seen.add);
      sockets.last.add(jsonEncode({'type': 'goal_created', 'goalId': 'g2', 'seq': 15}));
      await _waitFor(() => seen.isNotEmpty, reason: 'frame after throw');
      expect(seen.single.goalId, 'g2');
      expect(ws.isConnected, isTrue);
      await sub.cancel();
    });

    test('legacy onReconnected is suppressed when onGatewayReady is set', () async {
      dropFirstConnection = true;
      await connect(withLegacyReconnect: true);

      await _waitFor(() => readyFlags.length >= 2, reason: 're-handshake');
      await Future<void>.delayed(const Duration(milliseconds: 100));

      expect(legacyReconnects, 0);
    });

    test('legacy onReconnected still works without onGatewayReady', () async {
      dropFirstConnection = true;
      await connect(withGatewayReady: false, withLegacyReconnect: true);

      await _waitFor(() => legacyReconnects == 1, reason: 'legacy hook');
      expect(readyFlags, isEmpty);
    });
  });

  group('WsClientV2.emitRecovered', () {
    test('reaches the events stream like a live frame', () async {
      final ws = await connect();
      await _waitFor(() => readyFlags.length == 1);

      final seen = <MafwEvent>[];
      final sub = ws.events.listen(seen.add);
      ws.emitRecovered(MafwEvent(
        type: 'mafw_event',
        innerType: 'message.updated',
        seq: 11,
      ));
      await _waitFor(() => seen.isNotEmpty, reason: 'recovered frame');

      expect(seen.single.seq, 11);
      expect(seen.single.innerType, 'message.updated');
      await sub.cancel();
    });

    test('is a no-op after dispose (no state error)', () async {
      final ws = await connect();
      await _waitFor(() => readyFlags.length == 1);
      ws.dispose();
      client = null;

      expect(
        () => ws.emitRecovered(MafwEvent(type: 'goal_created', seq: 1)),
        returnsNormally,
      );
    });
  });
}
