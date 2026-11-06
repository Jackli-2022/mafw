import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Static guard for the Android cleartext allowlist.
///
/// Android's `<domain>` element does NOT match subdomains unless
/// `includeSubdomains="true"` is present — without it `machine.<tailnet>.ts.net`
/// falls back to the base-config and native network stacks (ExoPlayer/TTS) are
/// blocked. This test reads the shipped XML so the attribute cannot be dropped
/// silently.
void main() {
  final File configFile =
      File('android/app/src/main/res/xml/network_security_config.xml');

  group('network_security_config.xml', () {
    test('ts.net cleartext explicitly includes subdomains', () {
      final xml = configFile.readAsStringSync();
      expect(xml, contains('<domain includeSubdomains="true">ts.net</domain>'));
    });

    test('base-config keeps global cleartext disabled', () {
      final xml = configFile.readAsStringSync();
      expect(xml, contains('<base-config cleartextTrafficPermitted="false">'));
      expect(
        RegExp(r'<base-config\s+cleartextTrafficPermitted="true"').hasMatch(xml),
        isFalse,
        reason: 'cleartext must never be enabled globally',
      );
    });
  });
}
