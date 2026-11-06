import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/config/pairing_link.dart';
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

    test('wrong version is rejected', () {
      final result = parsePairingLink(
        _pairUrl(overrides: const {'v': '2'}).toString(),
      );
      expect(result.ok, isFalse);
      expect(result.error, PairingLinkError.malformed);
    });
  });

  group('Pairing URL policy (Tailscale/private only)', () {
    test('public http host is rejected', () {
      expect(canPairWithUrl('http://example.com:3000'), isFalse);
      expect(canPairWithUrl('http://my-pc.local:3000'), isFalse);
    });

    test('ts.net http is accepted', () {
      expect(canPairWithUrl('http://machine.tailnet.ts.net:3000'), isTrue);
    });

    test('private LAN http is accepted with a warning', () {
      expect(canPairWithUrl('http://192.168.1.5:3000'), isTrue);
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
}
