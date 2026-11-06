// WebSocket upgrade request construction (Task 3).
//
// The gateway accepts the API token on three channels for `/api/ws` upgrades
// (Bearer header, X-API-Token, ?token= — see gateway/src/core/auth.ts
// `authorizeWsUpgrade`). Mobile is dart:io, so `IOWebSocketChannel.connect` can
// send real headers: the Bearer header is the primary channel and keeps the
// token out of URLs/logs. These tests pin the URI + header composition, and a
// loopback server pins that `connect()` actually sends them (plus the
// `onRawFrame` tap and event parsing).
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/network/ws_client_v2.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  const tailnet = ConnectionConfig(
    baseUrl: 'https://orca.tail1234.ts.net',
    apiToken: 'tok-abc123',
  );

  group('WsClientV2 upgrade request', () {
    test('sends the token as an Authorization Bearer header', () {
      final ws = WsClientV2(tailnet);
      addTearDown(ws.dispose);

      expect(ws.upgradeHeaders['Authorization'], 'Bearer tok-abc123');
      expect(ws.endpointUri.toString(), 'wss://orca.tail1234.ts.net/api/ws');
    });

    test('keeps the token out of the URL', () {
      final ws = WsClientV2(tailnet);
      addTearDown(ws.dispose);

      expect(ws.endpointUri.queryParameters.containsKey('token'), isFalse);
      expect(ws.endpointUri.toString(), isNot(contains('tok-abc123')));
    });

    test('omits the Authorization header when no token is configured', () {
      const open = ConnectionConfig(baseUrl: 'http://100.64.0.7:3000', apiToken: '');
      final ws = WsClientV2(open);
      addTearDown(ws.dispose);

      expect(ws.upgradeHeaders, isEmpty);
      expect(ws.upgradeHeaders.containsKey('Authorization'), isFalse);
      expect(ws.endpointUri.toString(), 'ws://100.64.0.7:3000/api/ws');
    });

    test('keeps ?deviceId= in the query next to header auth', () {
      final ws = WsClientV2(tailnet, deviceId: 'dev-42');
      addTearDown(ws.dispose);

      expect(ws.endpointUri.queryParameters['deviceId'], 'dev-42');
      expect(ws.endpointUri.queryParameters.containsKey('token'), isFalse);
      expect(ws.upgradeHeaders['Authorization'], 'Bearer tok-abc123');
    });

    test('drops an empty deviceId instead of sending deviceId=', () {
      final ws = WsClientV2(tailnet, deviceId: '');
      addTearDown(ws.dispose);

      expect(ws.endpointUri.queryParameters.containsKey('deviceId'), isFalse);
    });

    test('maps http(s) to ws(s) and trims trailing slashes', () {
      const http = ConnectionConfig(baseUrl: 'http://192.168.1.5:3000/', apiToken: 't');
      final ws = WsClientV2(http);
      addTearDown(ws.dispose);

      expect(ws.endpointUri.toString(), 'ws://192.168.1.5:3000/api/ws');
    });
  });

  // Loopback integration: proves connect() uses the composed request (a unit
  // test on getters alone would not catch a wiring regression) and that the
  // raw-frame tap + event parsing still work on the new client.
  group('WsClientV2 connect() over loopback', () {
    late HttpServer server;
    late Completer<HttpHeaders> upgradeHeaders;
    late List<String> rawFrames;
    WsClientV2? ws;
    String? lastPath;

    setUp(() async {
      SharedPreferences.setMockInitialValues({});
      rawFrames = <String>[];
      upgradeHeaders = Completer<HttpHeaders>();
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      server.listen((request) async {
        lastPath = request.uri.toString();
        if (!upgradeHeaders.isCompleted) upgradeHeaders.complete(request.headers);
        final socket = await WebSocketTransformer.upgrade(request);
        socket.add(jsonEncode({
          'type': 'mafw_event',
          'data': {
            'type': 'turn.completed',
            'sessionID': 'sess-1',
            'properties': <String, dynamic>{},
          },
        }));
        await socket.close();
      });
    });

    tearDown(() async {
      ws?.dispose();
      await server.close(force: true);
    });

    test('sends Authorization, taps raw frames and emits events', () async {
      final cfg = ConnectionConfig(
        baseUrl: 'http://127.0.0.1:${server.port}',
        apiToken: 'tok-live-1',
      );
      final client = WsClientV2(cfg, onRawFrame: rawFrames.add);
      ws = client;
      await client.init();

      final connected = client.connectionStatus.firstWhere((value) => value);
      final eventFuture = client.events.first;
      await client.connect();

      final headers = await upgradeHeaders.future.timeout(const Duration(seconds: 5));
      expect(headers.value('authorization'), 'Bearer tok-live-1');
      expect(lastPath, '/api/ws');

      expect(await connected.timeout(const Duration(seconds: 5)), isTrue);

      final event = await eventFuture.timeout(const Duration(seconds: 5));
      expect(event.type, 'mafw_event');
      expect(event.innerType, 'turn.completed');
      expect(event.sessionID, 'sess-1');

      expect(rawFrames, hasLength(1));
      expect(rawFrames.single, contains('turn.completed'));
    });

    test('sends no Authorization header when the token is empty', () async {
      final cfg = ConnectionConfig(
        baseUrl: 'http://127.0.0.1:${server.port}',
        apiToken: '',
      );
      final client = WsClientV2(cfg);
      ws = client;
      await client.init();
      await client.connect();

      final headers = await upgradeHeaders.future.timeout(const Duration(seconds: 5));
      expect(headers.value('authorization'), isNull);
    });
  });
}
