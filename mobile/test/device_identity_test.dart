import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:orcalore_mobile/src/config/device_identity.dart';

final RegExp _hex32 = RegExp(r'^[0-9a-f]{32}$');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('device identity', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    test('generates a 32-char hex id and persists it under mafw_device_id', () async {
      final id = await getOrCreateDeviceId();

      expect(_hex32.hasMatch(id), isTrue, reason: 'id was "$id"');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(kDeviceIdKey), id);
      expect(kDeviceIdKey, 'mafw_device_id');
    });

    test('is stable across calls (same install keeps one id)', () async {
      final first = await getOrCreateDeviceId();
      final second = await getOrCreateDeviceId();

      expect(second, first);
    });

    test('reuses an existing stored id instead of replacing it', () async {
      final existing = 'a' * 32;
      SharedPreferences.setMockInitialValues({kDeviceIdKey: existing});

      expect(await getOrCreateDeviceId(), existing);
    });

    test('generated ids are unique across installs', () async {
      final a = generateDeviceId();
      final b = generateDeviceId();

      expect(a, isNot(b));
      expect(_hex32.hasMatch(a), isTrue);
      expect(_hex32.hasMatch(b), isTrue);
    });

    test('generated ids satisfy the gateway device-id charset', () async {
      // gateway/src/mobile/device-store.ts DEVICE_ID_RE / DEVICE_ID_MAX_LENGTH
      final id = await getOrCreateDeviceId();

      expect(RegExp(r'^[A-Za-z0-9._:-]+$').hasMatch(id), isTrue);
      expect(id.length <= 128, isTrue);
    });
  });
}
