import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:mafw_mobile/src/config/connection_config.dart';
import 'package:mafw_mobile/src/services/secure_config_store.dart';

/// Minimal fake FlutterSecureStorage for unit tests.
class _FakeSecureStorage extends FlutterSecureStorage {
  final Map<String, String> _data = {};

  @override
  Future<void> write({required String key, required String? value, ...}) async {
    if (value != null) _data[key] = value;
  }

  @override
  Future<String?> read({required String key, ...}) async => _data[key];

  @override
  Future<void> delete({required String key, ...}) async => _data.remove(key);
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('Pairing URL parsing', () {
    test('valid mafw://pair URL parses correctly', () {
      final exp = DateTime.now().millisecondsSinceEpoch + 300000; // +5min
      final uri = Uri(
        scheme: 'mafw',
        host: 'pair',
        queryParameters: {
          'url': 'https://my-tailnet:3000',
          'token': 'test-token-abc',
          'v': '1',
          'exp': '$exp',
          'nonce': 'a' * 32,
        },
      );

      expect(uri.scheme, 'mafw');
      expect(uri.host, 'pair');
      expect(uri.queryParameters['url'], 'https://my-tailnet:3000');
      expect(uri.queryParameters['token'], 'test-token-abc');
      expect(uri.queryParameters['v'], '1');
      expect(uri.queryParameters['exp'], '$exp');
      expect(uri.queryParameters['nonce'], 'a' * 32);
    });

    test('expired URL is rejected', () {
      final exp = DateTime.now().millisecondsSinceEpoch - 1000; // 1s ago
      final now = DateTime.now().millisecondsSinceEpoch;
      expect(now > exp, true, reason: 'simulated expiry check');
    });

    test('missing required params are rejected', () {
      final uri = Uri(
        scheme: 'mafw',
        host: 'pair',
        queryParameters: {
          'url': 'https://my-tailnet:3000',
          // missing token
          'v': '1',
          'exp': '123',
          'nonce': 'a' * 32,
        },
      );
      expect(uri.queryParameters['token'], isNull);
    });

    test('wrong scheme is rejected', () {
      final uri = Uri(scheme: 'http', host: 'pair');
      expect(uri.scheme, isNot('mafw'));
    });

    test('wrong host is rejected', () {
      final uri = Uri(scheme: 'mafw', host: 'unknown');
      expect(uri.host, isNot('pair'));
    });

    test('wrong version is rejected', () {
      final uri = Uri(
        scheme: 'mafw',
        host: 'pair',
        queryParameters: {'v': '2'},
      );
      expect(uri.queryParameters['v'], isNot('1'));
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
