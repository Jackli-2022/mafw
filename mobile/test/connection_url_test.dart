import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/services/secure_config_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('checkBaseUrl', () {
    test('MagicDNS host over http is ok (ts.net cleartext is allowlisted)', () {
      expect(checkBaseUrl('http://machine.tailnet.ts.net:3000'), UrlCheck.ok);
      expect(checkBaseUrl('http://ts.net:3000'), UrlCheck.ok);
    });

    test('https is ok for any host', () {
      expect(checkBaseUrl('https://machine.tailnet.ts.net:3000'), UrlCheck.ok);
      expect(checkBaseUrl('https://example.com'), UrlCheck.ok);
    });

    test('Tailscale CGNAT / bare IP over http warns to use MagicDNS hostname', () {
      expect(checkBaseUrl('http://100.64.0.1:3000'), UrlCheck.bareIpWarn);
      expect(checkBaseUrl('http://100.101.102.103:3000'), UrlCheck.bareIpWarn);
      expect(checkBaseUrl('http://203.0.113.7:3000'), UrlCheck.bareIpWarn);
    });

    test('private LAN cleartext keeps the existing warning', () {
      expect(checkBaseUrl('http://192.168.1.5:3000'), UrlCheck.plaintextLanWarn);
      expect(checkBaseUrl('http://10.0.0.5:3000'), UrlCheck.plaintextLanWarn);
      expect(checkBaseUrl('http://172.16.3.4:3000'), UrlCheck.plaintextLanWarn);
      expect(checkBaseUrl('http://172.31.255.254:3000'), UrlCheck.plaintextLanWarn);
    });

    test('other cleartext hostnames warn about plaintext', () {
      expect(checkBaseUrl('http://my-pc.local:3000'), UrlCheck.plaintextLanWarn);
    });

    test('non-http(s) input is invalid', () {
      expect(checkBaseUrl('ftp://machine.tailnet.ts.net'), UrlCheck.invalid);
      expect(checkBaseUrl('ws://machine.tailnet.ts.net:3000'), UrlCheck.invalid);
      expect(checkBaseUrl('machine.tailnet.ts.net:3000'), UrlCheck.invalid);
      expect(checkBaseUrl('http://'), UrlCheck.invalid);
      expect(checkBaseUrl(''), UrlCheck.invalid);
      expect(checkBaseUrl('   '), UrlCheck.invalid);
    });

    test('loopback stays usable for adb reverse development', () {
      expect(checkBaseUrl('http://127.0.0.1:3000'), UrlCheck.ok);
      expect(checkBaseUrl('http://localhost:3000'), UrlCheck.ok);
    });
  });

  group('SecureConfigStore unconfigured state', () {
    setUp(() async {
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({});
    });

    test('load returns an empty baseUrl when nothing was configured', () async {
      final loaded = await SecureConfigStore().load();
      expect(loaded.baseUrl, isEmpty);
      expect(loaded.apiToken, isEmpty);
    });
  });
}
