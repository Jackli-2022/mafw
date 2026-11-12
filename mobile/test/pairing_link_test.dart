import 'package:flutter_test/flutter_test.dart';

import 'package:orcalore_mobile/src/config/pairing_link.dart';

/// 32-char nonce used when a test does not care about the nonce value.
const String _defaultNonce = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/// Builds an `orcalore://pair?...` link. Pass `null` for a key to omit it.
String _link({
  String? url = 'https://my-tailnet.ts.net:3000',
  String? token = 'shared-token',
  String? v = '1',
  String? exp,
  String? nonce = _defaultNonce,
  String? scheme = kPairingScheme,
  String? host = kPairingHost,
  Map<String, String>? extra,
}) {
  final expiry = exp ?? '${DateTime.now().millisecondsSinceEpoch + 300000}';
  final query = <String, String>{
    'url': ?url,
    'token': ?token,
    'v': ?v,
    'exp': expiry,
    'nonce': ?nonce,
    ...?extra,
  };
  return Uri(
    scheme: scheme ?? kPairingScheme,
    host: host ?? kPairingHost,
    queryParameters: query,
  ).toString();
}

void main() {
  group('pairing link v2', () {
    test('parses without a token and yields an empty token', () {
      final result = parsePairingLink(_link(token: null, v: '2', nonce: 'a' * 32));

      expect(result.ok, isTrue);
      expect(result.error, PairingLinkError.none);
      expect(result.link!.url, 'https://my-tailnet.ts.net:3000');
      expect(result.link!.token, isEmpty);
      expect(result.link!.nonce, 'a' * 32);
      expect(result.link!.version, 2);
    });

    test('accepts a token too (harmless, v2 ignores it)', () {
      final result = parsePairingLink(_link(v: '2', nonce: 'b' * 32));

      expect(result.ok, isTrue);
      expect(result.link!.token, 'shared-token');
      expect(result.link!.version, 2);
    });

    test('expired v2 link is expired, not malformed', () {
      final past = '${DateTime.now().millisecondsSinceEpoch - 1000}';
      final result = parsePairingLink(_link(token: null, v: '2', nonce: 'c' * 32, exp: past));

      expect(result.ok, isFalse);
      expect(result.error, PairingLinkError.expired);
    });

    test('missing url / exp / nonce are malformed', () {
      expect(parsePairingLink(_link(url: null, token: null, v: '2', nonce: 'd' * 32)).error,
          PairingLinkError.malformed);
      expect(parsePairingLink(_link(token: null, v: '2', nonce: 'd' * 32, exp: 'not-a-number')).error,
          PairingLinkError.malformed);
      expect(parsePairingLink(_link(token: null, v: '2', nonce: null)).error,
          PairingLinkError.malformed);
      expect(parsePairingLink(_link(url: '', token: null, v: '2', nonce: 'd' * 32)).error,
          PairingLinkError.malformed);
    });
  });

  group('pairing link v1 (legacy, token required)', () {
    test('parses with the shared token', () {
      final result = parsePairingLink(_link());

      expect(result.ok, isTrue);
      expect(result.link!.token, 'shared-token');
      expect(result.link!.version, 1);
    });

    test('a v1 link without a token is malformed', () {
      final result = parsePairingLink(_link(token: null, v: '1', nonce: 'e' * 32));

      expect(result.ok, isFalse);
      expect(result.error, PairingLinkError.malformed);
    });

    test('a v1 link with an empty token is malformed', () {
      final result = parsePairingLink(_link(token: '', v: '1', nonce: 'e' * 32));

      expect(result.ok, isFalse);
      expect(result.error, PairingLinkError.malformed);
    });

    test('v1 expired link is expired', () {
      final past = '${DateTime.now().millisecondsSinceEpoch - 1}';
      final result = parsePairingLink(_link(exp: past));

      expect(result.error, PairingLinkError.expired);
    });
  });

  group('pairing link scheme/host unchanged', () {
    test('legacy mafw://pair is rejected', () {
      expect(parsePairingLink(_link(scheme: 'mafw', v: '2')).error, PairingLinkError.malformed);
    });

    test('other schemes and unknown hosts are rejected', () {
      expect(parsePairingLink(_link(scheme: 'https', v: '2')).error, PairingLinkError.malformed);
      expect(parsePairingLink(_link(host: 'verify', v: '2')).error, PairingLinkError.malformed);
    });

    test('unknown versions are rejected', () {
      expect(parsePairingLink(_link(v: '3')).error, PairingLinkError.malformed);
      expect(parsePairingLink(_link(token: null, v: null, nonce: 'f' * 32)).error,
          PairingLinkError.malformed);
    });

    test('garbage input is malformed rather than throwing', () {
      expect(parsePairingLink('not a link').error, PairingLinkError.malformed);
      expect(parsePairingLink('').error, PairingLinkError.malformed);
    });
  });
}
