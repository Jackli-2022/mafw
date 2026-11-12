import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/config/device_identity.dart';
import 'package:orcalore_mobile/src/config/pairing_flow.dart';
import 'package:orcalore_mobile/src/config/pairing_link.dart';
import 'package:orcalore_mobile/src/pages/pairing_page.dart';
import 'package:orcalore_mobile/src/services/background_credentials.dart';
import 'package:orcalore_mobile/src/services/secure_config_store.dart';

/// Minimal fake FlutterSecureStorage for unit tests.
class _FakeSecureStorage extends FlutterSecureStorage {
  final Map<String, String> _data = {};

  @override
  Future<void> write({
    required String key,
    required String? value,
    AndroidOptions? aOptions,
    IOSOptions? iOptions,
    LinuxOptions? lOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
    WebOptions? webOptions,
  }) async {
    if (value != null) _data[key] = value;
  }

  @override
  Future<String?> read({
    required String key,
    AndroidOptions? aOptions,
    IOSOptions? iOptions,
    LinuxOptions? lOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
    WebOptions? webOptions,
  }) async =>
      _data[key];

  @override
  Future<void> delete({
    required String key,
    AndroidOptions? aOptions,
    IOSOptions? iOptions,
    LinuxOptions? lOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
    WebOptions? webOptions,
  }) async {
    _data.remove(key);
  }
}

Uri _pairUrl({
  String scheme = 'orcalore',
  String host = 'pair',
  Map<String, String>? overrides,
  int? expMs,
}) {
  final exp = expMs ?? DateTime.now().millisecondsSinceEpoch + 300000; // +5min
  return Uri(
    scheme: scheme,
    host: host,
    queryParameters: {
      'url': 'https://my-tailnet.ts.net:3000',
      'token': 'test-token-abc',
      'v': '1',
      'exp': '$exp',
      'nonce': 'a' * 32,
      ...?overrides,
    },
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('Pairing URL parsing (orcalore://pair)', () {
    test('valid orcalore://pair URL parses correctly', () {
      final result = parsePairingLink(_pairUrl().toString());

      expect(result.ok, isTrue);
      expect(result.error, PairingLinkError.none);
      expect(result.link!.url, 'https://my-tailnet.ts.net:3000');
      expect(result.link!.token, 'test-token-abc');
      expect(result.link!.nonce, 'a' * 32);
    });

    test('expired URL is rejected with an expired error', () {
      final exp = DateTime.now().millisecondsSinceEpoch - 1000; // 1s ago
      final result = parsePairingLink(_pairUrl(expMs: exp).toString());

      expect(result.ok, isFalse);
      expect(result.error, PairingLinkError.expired);
      expect(result.link, isNull);
    });

    test('missing required params are rejected', () {
      final uri = Uri(
        scheme: 'orcalore',
        host: 'pair',
        queryParameters: {
          'url': 'https://my-tailnet.ts.net:3000',
          'v': '1',
          'exp': '123',
          'nonce': 'a' * 32,
        },
      );

      final result = parsePairingLink(uri.toString());
      expect(result.ok, isFalse);
      expect(result.error, PairingLinkError.malformed);
    });

    test('legacy mafw://pair scheme and other schemes are rejected', () {
      final legacy = parsePairingLink(_pairUrl(scheme: 'mafw').toString());
      expect(legacy.ok, isFalse);
      expect(legacy.error, PairingLinkError.malformed);

      final http = parsePairingLink(_pairUrl(scheme: 'http').toString());
      expect(http.ok, isFalse);
      expect(http.error, PairingLinkError.malformed);
    });

    test('wrong host is rejected', () {
      final result = parsePairingLink(_pairUrl(host: 'unknown').toString());
      expect(result.ok, isFalse);
      expect(result.error, PairingLinkError.malformed);
    });

    test('unknown version is rejected', () {
      final result = parsePairingLink(
        _pairUrl(overrides: const {'v': '3'}).toString(),
      );
      expect(result.ok, isFalse);
      expect(result.error, PairingLinkError.malformed);
    });

    test('v2 link parses without a token (device-token pairing)', () {
      final uri = Uri(
        scheme: 'orcalore',
        host: 'pair',
        queryParameters: {
          'url': 'https://my-tailnet.ts.net:3000',
          'v': '2',
          'exp': '${DateTime.now().millisecondsSinceEpoch + 300000}',
          'nonce': 'b' * 32,
        },
      );

      final result = parsePairingLink(uri.toString());
      expect(result.ok, isTrue);
      expect(result.link!.token, isEmpty);
      expect(result.link!.version, 2);
    });
  });

  group('Pairing URL policy (Tailscale/private only)', () {
    test('public http host is rejected', () {
      expect(canPairWithUrl('http://example.com:3000'), isFalse);
      expect(canPairWithUrl('http://evil.example.com'), isFalse);
    });

    test('ts.net http is accepted', () {
      expect(canPairWithUrl('http://machine.tailnet.ts.net:3000'), isTrue);
    });

    test('private LAN http is accepted with a warning', () {
      expect(canPairWithUrl('http://192.168.1.5:3000'), isTrue);
    });

    test('mDNS hosts (single-label / .local) are accepted', () {
      expect(canPairWithUrl('http://DESKTOP-ABC:3000'), isTrue);
      expect(canPairWithUrl('http://desktop-abc.local:3000'), isTrue);
    });

    test('non-http schemes are rejected', () {
      expect(canPairWithUrl('mafw://pair?x=1'), isFalse);
    });
  });

  group('SecureConfigStore pairing flow', () {
    test('pairing writes config to secure storage', () async {
      final fake = _FakeSecureStorage();
      final store = SecureConfigStore(secureStorage: fake);

      const config = ConnectionConfig(
        baseUrl: 'https://my-tailnet:3000',
        apiToken: 'pairing-token-xyz',
      );

      await store.save(config);
      final loaded = await store.load();

      expect(loaded.baseUrl, 'https://my-tailnet:3000');
      expect(loaded.apiToken, 'pairing-token-xyz');
    });

    test('pairing overwrites previous config', () async {
      final fake = _FakeSecureStorage();
      final store = SecureConfigStore(secureStorage: fake);

      await store.save(const ConnectionConfig(baseUrl: 'http://old:3000', apiToken: 'old'));
      await store.save(const ConnectionConfig(baseUrl: 'http://new:3000', apiToken: 'new'));

      final loaded = await store.load();
      expect(loaded.baseUrl, 'http://new:3000');
      expect(loaded.apiToken, 'new');
    });
  });

  group('ConnectionConfig properties', () {
    test('normalizedBaseUrl strips trailing slash', () {
      const cfg = ConnectionConfig(baseUrl: 'http://localhost:3000/', apiToken: '');
      expect(cfg.normalizedBaseUrl, 'http://localhost:3000');
    });

    test('wsUrl converts http to ws', () {
      const cfg = ConnectionConfig(baseUrl: 'http://localhost:3000', apiToken: '');
      expect(cfg.wsUrl, 'ws://localhost:3000/api/ws');
    });

    test('wsUrl converts https to wss', () {
      const cfg = ConnectionConfig(baseUrl: 'https://my-tailnet:3000', apiToken: '');
      expect(cfg.wsUrl, 'wss://my-tailnet:3000/api/ws');
    });

    test('headers include Bearer when token present', () {
      const cfg = ConnectionConfig(baseUrl: 'http://localhost:3000', apiToken: 'tok123');
      expect(cfg.headers['Authorization'], 'Bearer tok123');
    });

    test('headers omit Authorization when token empty', () {
      const cfg = ConnectionConfig(baseUrl: 'http://localhost:3000', apiToken: '');
      expect(cfg.headers.containsKey('Authorization'), false);
    });
  });

  group('Pairing verify (v2 device token exchange)', () {
    const deviceId = '0123456789abcdef0123456789abcdef';

    test('v2 verify saves the dev_ token from the response', () async {
      final captured = <http.Request>[];
      final client = http_testing.MockClient((req) async {
        captured.add(req);
        return http.Response(
          jsonEncode({'ok': true, 'token': 'dev_abc123', 'deviceId': 'dev-1'}),
          200,
        );
      });

      final result = await redeemPairing(
        baseUrl: 'https://my-tailnet.ts.net:3000/',
        linkToken: '',
        nonce: 'a' * 32,
        client: client,
        deviceId: deviceId,
        platform: 'android',
        deviceName: 'Pixel 7',
      );

      expect(result.config.apiToken, 'dev_abc123');
      expect(result.config.baseUrl, 'https://my-tailnet.ts.net:3000/');
      expect(result.deviceId, 'dev-1');

      final req = captured.single;
      expect(req.method, 'POST');
      expect(req.url.toString(), 'https://my-tailnet.ts.net:3000/api/mobile/pairing/verify');
      // A v2 link has no token, so no Authorization header is sent (nonce is
      // the credential).
      expect(req.headers['authorization'], isNull);
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      expect(body['nonce'], 'a' * 32);
      expect(body['deviceId'], deviceId);
      expect(body['platform'], 'android');
      expect(body['deviceName'], 'Pixel 7');
      expect(body.containsKey('rotate'), isFalse);
    });

    test('re-pairing sends rotate:true so the gateway may rotate', () async {
      Map<String, dynamic>? sent;
      final client = http_testing.MockClient((req) async {
        sent = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({'ok': true, 'token': 'dev_rotated', 'deviceId': deviceId}),
          200,
        );
      });

      final result = await redeemPairing(
        baseUrl: 'http://192.168.1.5:3000',
        linkToken: '',
        nonce: 'c' * 32,
        client: client,
        deviceId: deviceId,
        rotate: true,
      );

      expect(sent!['rotate'], isTrue);
      expect(result.config.apiToken, 'dev_rotated');
    });

    test('legacy v1 gateway (no token in the response) keeps the link token', () async {
      final client = http_testing.MockClient((req) async {
        expect(req.headers['authorization'], 'Bearer shared-token');
        return http.Response(jsonEncode({'ok': true}), 200);
      });

      final result = await redeemPairing(
        baseUrl: 'https://my-tailnet.ts.net:3000',
        linkToken: 'shared-token',
        nonce: 'd' * 32,
        client: client,
        deviceId: deviceId,
      );

      expect(result.config.apiToken, 'shared-token');
    });

    test('a non-dev_ token with no link token fails closed (missing credential)', () async {
      final client = http_testing.MockClient(
        (req) async => http.Response(jsonEncode({'ok': true, 'token': 'shared'}), 200),
      );

      await expectLater(
        redeemPairing(
          baseUrl: 'https://my-tailnet.ts.net:3000',
          linkToken: '',
          nonce: 'e' * 32,
          client: client,
          deviceId: deviceId,
        ),
        throwsA(isA<PairingException>()
            .having((e) => e.message, 'message', contains('missing device credential'))),
      );
    });

    test('a 200 for a v2 link with no token and no link token fails closed', () async {
      final client = http_testing.MockClient(
        (req) async => http.Response(jsonEncode({'ok': true}), 200),
      );

      await expectLater(
        redeemPairing(
          baseUrl: 'https://my-tailnet.ts.net:3000',
          linkToken: '',
          nonce: 'e2' * 16,
          client: client,
          deviceId: deviceId,
        ),
        throwsA(isA<PairingException>()
            .having((e) => e.message, 'message', contains('missing device credential'))),
      );
    });

    test('a 200 with a malformed body falls back to the link token', () async {
      final client = http_testing.MockClient(
        (req) async => http.Response('not-json', 200),
      );

      final result = await redeemPairing(
        baseUrl: 'https://my-tailnet.ts.net:3000',
        linkToken: 'shared-token',
        nonce: 'f' * 32,
        client: client,
        deviceId: deviceId,
      );

      expect(result.config.apiToken, 'shared-token');
    });

    test('non-200 status throws a PairingException carrying the status', () async {
      final client = http_testing.MockClient(
        (req) async => http.Response(jsonEncode({'error': 'invalid or expired nonce'}), 400),
      );

      await expectLater(
        redeemPairing(
          baseUrl: 'https://my-tailnet.ts.net:3000',
          linkToken: '',
          nonce: 'g' * 32,
          client: client,
          deviceId: deviceId,
        ),
        throwsA(isA<PairingException>().having((e) => e.statusCode, 'statusCode', 400)),
      );
    });

    test('409 device_already_paired retries once with rotate:true', () async {
      final bodies = <Map<String, dynamic>>[];
      final client = http_testing.MockClient((req) async {
        bodies.add(jsonDecode(req.body) as Map<String, dynamic>);
        if (bodies.length == 1) {
          return http.Response(
            jsonEncode({'error': 'device already paired', 'code': 'device_already_paired'}),
            409,
          );
        }
        return http.Response(
          jsonEncode({'ok': true, 'token': 'dev_after_retry', 'deviceId': deviceId}),
          200,
        );
      });

      final result = await redeemPairing(
        baseUrl: 'https://my-tailnet.ts.net:3000',
        linkToken: '',
        nonce: 'g2' * 16,
        client: client,
        deviceId: deviceId,
      );

      expect(bodies.length, 2);
      expect(bodies.first.containsKey('rotate'), isFalse);
      expect(bodies.last['rotate'], isTrue);
      expect(bodies.last['nonce'], 'g2' * 16);
      expect(result.config.apiToken, 'dev_after_retry');
    });

    test('a persistent 409 throws after the single retry', () async {
      var calls = 0;
      final client = http_testing.MockClient((req) async {
        calls++;
        return http.Response(
          jsonEncode({'error': 'device already paired', 'code': 'device_already_paired'}),
          409,
        );
      });

      await expectLater(
        redeemPairing(
          baseUrl: 'https://my-tailnet.ts.net:3000',
          linkToken: '',
          nonce: 'g3' * 16,
          client: client,
          deviceId: deviceId,
        ),
        throwsA(isA<PairingException>().having((e) => e.statusCode, 'statusCode', 409)),
      );
      expect(calls, 2);
    });

    test('a hanging gateway times out (15s by default, injectable)', () async {
      expect(kPairingRequestTimeout, const Duration(seconds: 15));
      final client = http_testing.MockClient(
        (req) => Completer<http.Response>().future, // never completes
      );

      await expectLater(
        redeemPairing(
          baseUrl: 'https://my-tailnet.ts.net:3000',
          linkToken: '',
          nonce: 'g4' * 16,
          client: client,
          deviceId: deviceId,
          requestTimeout: const Duration(milliseconds: 10),
        ),
        throwsA(isA<TimeoutException>()),
      );
    });

    test('pairingErrorMessage maps transport failures to 配对请求失败', () {
      expect(pairingErrorMessage(TimeoutException('slow')), '配对请求失败');
      expect(pairingErrorMessage(http.ClientException('refused')), '配对请求失败');
      expect(
        pairingErrorMessage(const PairingException('配对验证失败: 409', statusCode: 409)),
        '配对验证失败: 409',
      );
    });

    test('manual entry (no nonce) skips the network and keeps the typed token', () async {
      var calls = 0;
      final client = http_testing.MockClient((req) async {
        calls++;
        return http.Response('{}', 200);
      });

      final result = await redeemPairing(
        baseUrl: 'http://192.168.1.5:3000',
        linkToken: 'manual-token',
        nonce: kManualPairingNonce,
        client: client,
        deviceId: deviceId,
      );

      expect(calls, 0);
      expect(result.config.apiToken, 'manual-token');
    });

    test('deviceId is generated once, persisted, and sent on verify', () async {
      SharedPreferences.setMockInitialValues({});
      final persisted = await getOrCreateDeviceId();

      Map<String, dynamic>? sent;
      final client = http_testing.MockClient((req) async {
        sent = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({'ok': true, 'token': 'dev_x', 'deviceId': persisted}),
          200,
        );
      });

      await redeemPairing(
        baseUrl: 'https://my-tailnet.ts.net:3000',
        linkToken: '',
        nonce: 'h' * 32,
        client: client,
        deviceId: await getOrCreateDeviceId(),
      );

      expect(sent!['deviceId'], persisted);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(kDeviceIdKey), persisted);
    });

    test('saving a device token refreshes the background copy when it exists', () async {
      SharedPreferences.setMockInitialValues({
        kBgBaseUrlKey: 'https://my-tailnet.ts.net:3000',
        kBgApiTokenKey: 'shared-stale',
      });
      FlutterSecureStorage.setMockInitialValues({});

      final client = http_testing.MockClient(
        (req) async => http.Response(
          jsonEncode({'ok': true, 'token': 'dev_fresh', 'deviceId': deviceId}),
          200,
        ),
      );

      final result = await redeemPairing(
        baseUrl: 'https://my-tailnet.ts.net:3000',
        linkToken: '',
        nonce: 'i' * 32,
        client: client,
        deviceId: deviceId,
      );
      await result.config.save();
      await syncBackgroundCredentials(result.config);

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(kBgApiTokenKey), 'dev_fresh');
      expect(await SecureConfigStore().load().then((c) => c.apiToken), 'dev_fresh');
    });
  });

  group('rotate decision (re-pair)', () {
    const existing = ConnectionConfig(
      baseUrl: 'https://my-tailnet.ts.net:3000',
      apiToken: 'dev_old',
    );

    test('no stored config → no rotate', () {
      expect(shouldRotateForPairing(existing: null, nonce: 'a' * 32), isFalse);
    });

    test('stored token for the same base URL → rotate', () {
      expect(shouldRotateForPairing(existing: existing, nonce: 'a' * 32), isTrue);
    });

    test('stored token for a different base URL → still rotate (URL-agnostic)', () {
      // Tailscale ↔ LAN ↔ changed port: the gateway 409 is keyed on the
      // deviceId hash only, so base-URL equality must not gate rotation.
      expect(
        shouldRotateForPairing(
          existing: const ConnectionConfig(
            baseUrl: 'https://my-tailnet.ts.net:3000',
            apiToken: 'dev_old',
          ),
          nonce: 'a' * 32,
        ),
        isTrue,
      );
      expect(
        shouldRotateForPairing(
          existing: const ConnectionConfig(
            baseUrl: 'http://192.168.1.5:3000',
            apiToken: 'shared-legacy',
          ),
          nonce: 'a' * 32,
        ),
        isTrue,
      );
    });

    test('empty stored token → no rotate', () {
      expect(
        shouldRotateForPairing(
          existing: const ConnectionConfig(baseUrl: 'https://my-tailnet.ts.net:3000', apiToken: ''),
          nonce: 'a' * 32,
        ),
        isFalse,
      );
    });

    test('manual entry never rotates (no nonce to redeem)', () {
      expect(
        shouldRotateForPairing(existing: existing, nonce: kManualPairingNonce),
        isFalse,
      );
    });
  });

  group('PairingPage (widget flow)', () {
    late _RecordingStore store;
    late List<http.Request> requests;

    setUp(() {
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({});
      store = _RecordingStore();
      requests = [];
    });

    testWidgets('v2 link redeems a device token and pops with the saved config', (tester) async {
      final client = http_testing.MockClient((req) async {
        requests.add(req);
        return http.Response(
          jsonEncode({'ok': true, 'token': 'dev_widget', 'deviceId': 'f' * 32}),
          200,
        );
      });
      ConnectionConfig? popped;

      await _pumpPairingPage(tester, client: client, store: store, onPopped: (c) => popped = c);
      await _submitDeepLink(tester, _v2Link());

      expect(requests, hasLength(1));
      expect(requests.single.url.path, '/api/mobile/pairing/verify');
      final body = jsonDecode(requests.single.body) as Map<String, dynamic>;
      expect(body['nonce'], 'n' * 32);
      expect(body['deviceId'], 'f' * 32);
      expect(body['platform'], 'android');
      expect(body['deviceName'], 'Pixel 7');
      expect(body.containsKey('rotate'), isFalse);
      expect(store.saved?.apiToken, 'dev_widget');
      expect(store.saveCount, 1);
      expect(popped?.apiToken, 'dev_widget');
      expect(popped?.baseUrl, 'https://my-tailnet.ts.net:3000');
    });

    testWidgets('re-pairing an install with a stored token sends rotate:true', (tester) async {
      store = _RecordingStore(
        initial: const ConnectionConfig(
          // Different scheme/host on purpose: rotation is URL-agnostic.
          baseUrl: 'http://192.168.1.5:3000',
          apiToken: 'dev_old',
        ),
      );
      final client = http_testing.MockClient((req) async {
        requests.add(req);
        return http.Response(
          jsonEncode({'ok': true, 'token': 'dev_rotated', 'deviceId': 'f' * 32}),
          200,
        );
      });
      ConnectionConfig? popped;

      await _pumpPairingPage(tester, client: client, store: store, onPopped: (c) => popped = c);
      await _submitDeepLink(tester, _v2Link());

      final body = jsonDecode(requests.single.body) as Map<String, dynamic>;
      expect(body['rotate'], isTrue);
      expect(popped?.apiToken, 'dev_rotated');
    });

    testWidgets('v2 link with a gateway 409 shows the error card and saves nothing', (tester) async {
      var calls = 0;
      final client = http_testing.MockClient((req) async {
        calls++;
        return http.Response(
          jsonEncode({'error': 'device already paired', 'code': 'device_already_paired'}),
          409,
        );
      });
      ConnectionConfig? popped;

      await _pumpPairingPage(tester, client: client, store: store, onPopped: (c) => popped = c);
      await _submitDeepLink(tester, _v2Link());

      expect(calls, 2, reason: 'one retry with rotate:true');
      expect(find.text('配对验证失败: 409'), findsOneWidget);
      expect(find.text('正在连接...'), findsNothing);
      expect(store.saveCount, 0);
      expect(popped, isNull);
    });

    testWidgets('a 400 from the gateway shows the error card and saves nothing', (tester) async {
      var calls = 0;
      final client = http_testing.MockClient((req) async {
        calls++;
        return http.Response(jsonEncode({'error': 'Invalid or expired pairing nonce'}), 400);
      });
      ConnectionConfig? popped;

      await _pumpPairingPage(tester, client: client, store: store, onPopped: (c) => popped = c);
      await _submitDeepLink(tester, _v1Link(token: 'legacy-shared'));

      expect(calls, 1);
      expect(find.text('配对验证失败: 400'), findsOneWidget);
      expect(store.saveCount, 0);
      expect(popped, isNull);
    });

    testWidgets('a transport failure maps to 配对请求失败', (tester) async {
      final client = http_testing.MockClient(
        (req) async => throw http.ClientException('connection refused'),
      );
      ConnectionConfig? popped;

      await _pumpPairingPage(tester, client: client, store: store, onPopped: (c) => popped = c);
      await _submitDeepLink(tester, _v2Link());

      expect(find.text('配对请求失败'), findsOneWidget);
      expect(store.saveCount, 0);
      expect(popped, isNull);
    });

    testWidgets('v1 link keeps the embedded token when the gateway returns no token', (tester) async {
      final client = http_testing.MockClient((req) async {
        requests.add(req);
        return http.Response(jsonEncode({'ok': true}), 200);
      });
      ConnectionConfig? popped;

      await _pumpPairingPage(tester, client: client, store: store, onPopped: (c) => popped = c);
      await _submitDeepLink(tester, _v1Link(token: 'legacy-shared'));

      expect(requests.single.headers['authorization'], 'Bearer legacy-shared');
      expect(store.saved?.apiToken, 'legacy-shared');
      expect(popped?.apiToken, 'legacy-shared');
    });

    testWidgets('manual URL + token saves the typed token without any HTTP call', (tester) async {
      var calls = 0;
      final client = http_testing.MockClient((req) async {
        calls++;
        return http.Response('{}', 200);
      });
      ConnectionConfig? popped;

      await _pumpPairingPage(tester, client: client, store: store, onPopped: (c) => popped = c);
      await _submitManual(tester, url: 'http://192.168.1.5:3000', token: 'manual-token');

      expect(calls, 0);
      expect(store.saved?.apiToken, 'manual-token');
      expect(store.saved?.baseUrl, 'http://192.168.1.5:3000');
      expect(popped?.apiToken, 'manual-token');
    });
  });
}

/// Credential store double that records what the page persists.
class _RecordingStore extends SecureConfigStore {
  _RecordingStore({this.initial});

  final ConnectionConfig? initial;
  ConnectionConfig? saved;
  int saveCount = 0;

  @override
  Future<ConnectionConfig> load() async =>
      initial ?? const ConnectionConfig(baseUrl: '', apiToken: '');

  @override
  Future<void> save(ConnectionConfig c) async {
    saved = c;
    saveCount++;
  }
}

String _v2Link({String? token}) => Uri(
      scheme: 'orcalore',
      host: 'pair',
      queryParameters: {
        'url': 'https://my-tailnet.ts.net:3000',
        'v': '2',
        'exp': '${DateTime.now().millisecondsSinceEpoch + 300000}',
        'nonce': 'n' * 32,
        'token': ?token,
      },
    ).toString();

String _v1Link({required String token}) => Uri(
      scheme: 'orcalore',
      host: 'pair',
      queryParameters: {
        'url': 'https://my-tailnet.ts.net:3000',
        'token': token,
        'v': '1',
        'exp': '${DateTime.now().millisecondsSinceEpoch + 300000}',
        'nonce': 'v' * 32,
      },
    ).toString();

/// Mount a host route and push [PairingPage] (the page pops with the config).
Future<void> _pumpPairingPage(
  WidgetTester tester, {
  required http.Client client,
  required SecureConfigStore store,
  required void Function(ConnectionConfig?) onPopped,
}) async {
  await tester.pumpWidget(MaterialApp(
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: TextButton(
            onPressed: () async {
              final result = await Navigator.of(context).push<ConnectionConfig>(
                MaterialPageRoute(
                  builder: (_) => PairingPage(
                    httpClient: client,
                    configStore: store,
                    deviceIdProvider: () async => 'f' * 32,
                    platform: 'android',
                    deviceName: 'Pixel 7',
                  ),
                ),
              );
              onPopped(result);
            },
            child: const Text('open-pairing'),
          ),
        ),
      ),
    ),
  ));
  await tester.tap(find.text('open-pairing'));
  await _settle(tester);
}

/// Pump a bounded number of frames (the scanner/mDNS keep real timers alive,
/// so `pumpAndSettle` is not an option).
Future<void> _settle(WidgetTester tester, [int frames = 12]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _submitDeepLink(WidgetTester tester, String link) async {
  await tester.tap(find.text('手动输入'));
  await _settle(tester, 4);
  await tester.enterText(find.byType(TextField).at(0), link);
  await _settle(tester, 2);
  await tester.tap(find.text('连接'));
  await _settle(tester);
}

Future<void> _submitManual(
  WidgetTester tester, {
  required String url,
  required String token,
}) async {
  await tester.tap(find.text('手动输入'));
  await _settle(tester, 4);
  await tester.enterText(find.byType(TextField).at(0), url);
  await tester.enterText(find.byType(TextField).at(1), token);
  await _settle(tester, 2);
  await tester.tap(find.text('连接'));
  await _settle(tester);
}
