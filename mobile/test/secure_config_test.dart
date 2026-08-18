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

  group('SecureConfigStore', () {
    test('save then load round-trips', () async {
      final fake = _FakeSecureStorage();
      final store = SecureConfigStore(secureStorage: fake);
      const cfg = ConnectionConfig(baseUrl: 'http://10.0.0.1:3000', apiToken: 'my-secret');

      await store.save(cfg);
      final loaded = await store.load();

      expect(loaded.baseUrl, 'http://10.0.0.1:3000');
      expect(loaded.apiToken, 'my-secret');
    });

    test('empty token loads as empty string', () async {
      final fake = _FakeSecureStorage();
      final store = SecureConfigStore(secureStorage: fake);

      final loaded = await store.load();
      expect(loaded.apiToken, '');
    });

    test('migrateLegacy moves token from SharedPreferences to secure storage', () async {
      SharedPreferences.setMockInitialValues({'mafw_conn_token': 'legacy-tok'});
      final fake = _FakeSecureStorage();
      final store = SecureConfigStore(secureStorage: fake);

      await store.migrateLegacy();

      // Token should now be in secure storage
      expect(await fake.read(key: 'mafw_secure_token'), 'legacy-tok');
      // Legacy key should be removed from SharedPreferences
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('mafw_conn_token'), isNull);
    });

    test('load auto-migrates legacy token on first read', () async {
      SharedPreferences.setMockInitialValues({'mafw_conn_token': 'auto-tok'});
      final fake = _FakeSecureStorage();
      final store = SecureConfigStore(secureStorage: fake);

      final loaded = await store.load();

      expect(loaded.apiToken, 'auto-tok');
      // Should have been moved to secure storage
      expect(await fake.read(key: 'mafw_secure_token'), 'auto-tok');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('mafw_conn_token'), isNull);
    });

    test('save overwrites existing secure token', () async {
      final fake = _FakeSecureStorage();
      final store = SecureConfigStore(secureStorage: fake);

      await store.save(const ConnectionConfig(baseUrl: 'http://a:1', apiToken: 'old'));
      await store.save(const ConnectionConfig(baseUrl: 'http://b:2', apiToken: 'new'));

      final loaded = await store.load();
      expect(loaded.apiToken, 'new');
      expect(loaded.baseUrl, 'http://b:2');
    });

    test('migrateLegacy does not overwrite existing secure token', () async {
      SharedPreferences.setMockInitialValues({'mafw_conn_token': 'legacy'});
      final fake = _FakeSecureStorage();
      await fake.write(key: 'mafw_secure_token', value: 'existing');
      final store = SecureConfigStore(secureStorage: fake);

      await store.migrateLegacy();

      expect(await fake.read(key: 'mafw_secure_token'), 'existing');
    });
  });
}
