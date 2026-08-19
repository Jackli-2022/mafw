import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mafw_mobile/src/config/connection_config.dart';
import 'package:mafw_mobile/src/services/secure_config_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SecureConfigStore', () {
    setUp(() async {
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({});
    });

    test('save then load round-trips token via secure storage', () async {
      final store = SecureConfigStore();
      final cfg = ConnectionConfig(baseUrl: 'https://xxx.ts.net:3000', apiToken: 'tok123');
      await store.save(cfg);

      // Fresh store should read back same values
      final loaded = await store.load();
      expect(loaded.baseUrl, 'https://xxx.ts.net:3000');
      expect(loaded.apiToken, 'tok123');

      // Verify token not in SharedPreferences (secure path)
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('mafw_conn_token'), isNull);
    });

    test('migrates legacy SharedPreferences token to secure storage', () async {
      SharedPreferences.setMockInitialValues({
        'mafw_conn_token': 'legacy-token',
        'mafw_conn_base_url': 'https://old.ts.net:3000',
      });
      FlutterSecureStorage.setMockInitialValues({});

      final store = SecureConfigStore();
      final loaded = await store.load();

      expect(loaded.apiToken, 'legacy-token');
      expect(loaded.baseUrl, 'https://old.ts.net:3000');

      // Legacy key should be removed after migration
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('mafw_conn_token'), isNull);

      // Secure storage should now hold the token
      final sec = await const FlutterSecureStorage().read(key: 'mafw_secure_token');
      expect(sec, 'legacy-token');
    });

    test('ConnectionConfig.load delegates to SecureConfigStore', () async {
      final store = SecureConfigStore();
      await store.save(const ConnectionConfig(baseUrl: 'https://x.ts.net:3000', apiToken: 'delegated'));
      final viaConfig = await ConnectionConfig.load();
      expect(viaConfig.apiToken, 'delegated');
    });

    test('ConnectionConfig.save delegates to SecureConfigStore', () async {
      const cfg = ConnectionConfig(baseUrl: 'https://y.ts.net:3000', apiToken: 'via-save');
      await cfg.save();
      final loaded = await SecureConfigStore().load();
      expect(loaded.apiToken, 'via-save');
      expect(loaded.baseUrl, 'https://y.ts.net:3000');
    });

    test('load returns default baseUrl when empty', () async {
      final store = SecureConfigStore();
      final loaded = await store.load();
      expect(loaded.baseUrl, isNotEmpty);
    });

    test('migrateLegacy is idempotent when no legacy token', () async {
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({});
      final store = SecureConfigStore();
      await store.migrateLegacy();
      final loaded = await store.load();
      expect(loaded.apiToken, '');
    });
  });
}
