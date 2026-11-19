import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/network/gateway_transport.dart';

void main() {
  final cfg = ConnectionConfig(
    baseUrl: 'http://192.168.1.5:3000',
    apiToken: 'dev_x',
    relayUrl: 'https://room.relay.example.com',
    fingerprint: 'ab' * 32,
  );

  group('LAN-first transport (M3)', () {
    test('keeps LAN when /health answers 200', () async {
      final probe = MockClient((req) async {
        expect(req.url.toString(), 'http://192.168.1.5:3000/health');
        return http.Response('{"status":"ok"}', 200);
      });

      final active = await resolveActiveConnection(cfg, probe: probe);
      expect(active.normalizedBaseUrl, 'http://192.168.1.5:3000');
      expect(active.usingRelay, isFalse);
    });

    test('falls back to relay when LAN is unreachable', () async {
      final probe = MockClient((_) async => throw const SocketException('offline'));

      final active = await resolveActiveConnection(cfg, probe: probe);
      expect(active.normalizedBaseUrl, 'https://room.relay.example.com');
      expect(active.usingRelay, isTrue);
      expect(active.relayUrl, cfg.relayUrl);
      expect(active.fingerprint, cfg.fingerprint);
    });

    test('legacy config without relay is untouched', () async {
      const legacy = ConnectionConfig(baseUrl: 'http://pc:3000', apiToken: '');
      final active = await resolveActiveConnection(legacy);
      expect(active.baseUrl, legacy.baseUrl);
    });
  });
}
