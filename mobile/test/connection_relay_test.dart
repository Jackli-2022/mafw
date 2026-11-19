import 'package:flutter_test/flutter_test.dart';

import 'package:orcalore_mobile/src/config/connection_config.dart';

void main() {
  group('ConnectionConfig relay fields (M3)', () {
    test('reports relay availability and active transport', () {
      final cfg = ConnectionConfig(
        baseUrl: 'http://192.168.1.5:3000',
        apiToken: 'dev_x',
        relayUrl: 'https://room.relay.example.com/',
        fingerprint: 'ab' * 32,
      );

      expect(cfg.hasRelay, isTrue);
      expect(cfg.usingRelay, isFalse);
      expect(cfg.normalizedRelayUrl, 'https://room.relay.example.com');

      final relayed = cfg.copyWith(baseUrl: 'https://room.relay.example.com');
      expect(relayed.usingRelay, isTrue);
      expect(relayed.wsUrl, 'wss://room.relay.example.com/api/ws');
      expect(relayed.relayUrl, cfg.relayUrl);
      expect(relayed.fingerprint, cfg.fingerprint);
    });

    test('legacy config has no relay', () {
      const cfg = ConnectionConfig(baseUrl: 'http://pc:3000', apiToken: '');
      expect(cfg.hasRelay, isFalse);
      expect(cfg.usingRelay, isFalse);
    });
  });
}
