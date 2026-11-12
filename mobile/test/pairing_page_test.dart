import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/config/device_identity.dart';
import 'package:orcalore_mobile/src/config/pairing_flow.dart';
import 'package:orcalore_mobile/src/config/pairing_link.dart';
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

      expect(result.verified, isTrue);
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

      expect(result.verified, isFalse);
      expect(result.config.apiToken, 'shared-token');
    });

    test('a non-dev_ token is not trusted when the link has no token', () async {
      final client = http_testing.MockClient(
        (req) async => http.Response(jsonEncode({'ok': true, 'token': 'shared'}), 200),
      );

      final result = await redeemPairing(
        baseUrl: 'https://my-tailnet.ts.net:3000',
        linkToken: '',
        nonce: 'e' * 32,
        client: client,
        deviceId: deviceId,
      );

      expect(result.verified, isFalse);
      expect(result.config.apiToken, isEmpty);
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
      expect(result.verified, isFalse);
    });

    test('non-200 status throws a PairingException carrying the status', () async {
      final client = http_testing.MockClient(
        (req) async => http.Response(
          jsonEncode({'error': 'device already paired', 'code': 'device_already_paired'}),
          409,
        ),
      );

      await expectLater(
        redeemPairing(
          baseUrl: 'https://my-tailnet.ts.net:3000',
          linkToken: '',
          nonce: 'g' * 32,
          client: client,
          deviceId: deviceId,
        ),
        throwsA(isA<PairingException>().having((e) => e.statusCode, 'statusCode', 409)),
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
      expect(result.verified, isFalse);
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
      expect(
        shouldRotateForPairing(existing: null, baseUrl: 'https://my-tailnet.ts.net:3000', nonce: 'a' * 32),
        isFalse,
      );
    });

    test('stored token for the same base URL → rotate (trailing slash tolerated)', () {
      expect(
        shouldRotateForPairing(
          existing: existing,
          baseUrl: 'https://my-tailnet.ts.net:3000/',
          nonce: 'a' * 32,
        ),
        isTrue,
      );
    });

    test('stored token for a different gateway → no rotate', () {
      expect(
        shouldRotateForPairing(
          existing: existing,
          baseUrl: 'http://192.168.1.5:3000',
          nonce: 'a' * 32,
        ),
        isFalse,
      );
    });

    test('empty stored token → no rotate', () {
      expect(
        shouldRotateForPairing(
          existing: const ConnectionConfig(baseUrl: 'https://my-tailnet.ts.net:3000', apiToken: ''),
          baseUrl: 'https://my-tailnet.ts.net:3000',
          nonce: 'a' * 32,
        ),
        isFalse,
      );
    });

    test('manual entry never rotates (no nonce to redeem)', () {
      expect(
        shouldRotateForPairing(
          existing: existing,
          baseUrl: 'https://my-tailnet.ts.net:3000',
          nonce: kManualPairingNonce,
        ),
        isFalse,
      );
    });
  });
}
