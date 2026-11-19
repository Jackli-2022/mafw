import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

import '../config/connection_config.dart';

/// Lowercase SHA-256 of a DER certificate (lockstep with the gateway `fp`).
String certificateFingerprint(List<int> der) => sha256.convert(der).toString();

bool certificateMatchesFingerprint(X509Certificate cert, String fingerprint) {
  final expected = fingerprint.trim().toLowerCase();
  if (expected.isEmpty) return false;
  return certificateFingerprint(cert.der) == expected;
}

/// Raw pinned HttpClient for WS upgrades, or null for LAN/non-relay configs.
HttpClient? createPinnedHttpClient(ConnectionConfig cfg) {
  if (!cfg.usingRelay) return null;
  final relayHost = Uri.parse(cfg.relayUrl).host;
  final fingerprint = cfg.fingerprint;
  final client = HttpClient();
  client.badCertificateCallback = (cert, host, port) {
    if (host != relayHost) return false;
    return certificateMatchesFingerprint(cert, fingerprint);
  };
  return client;
}

http.Client createGatewayHttpClient(ConnectionConfig cfg) {
  final raw = createPinnedHttpClient(cfg);
  return raw == null ? http.Client() : IOClient(raw);
}

/// LAN-first resolution: a reachable LAN `/health` keeps the direct path;
/// otherwise the config is switched to the relay room (TLS pinning applies).
Future<ConnectionConfig> resolveActiveConnection(
  ConnectionConfig cfg, {
  http.Client? probe,
  Duration timeout = const Duration(milliseconds: 1500),
}) async {
  if (!cfg.hasRelay) return cfg;
  final lan = cfg.normalizedBaseUrl;
  if (lan.isEmpty || lan == cfg.normalizedRelayUrl) {
    return cfg.copyWith(baseUrl: cfg.normalizedRelayUrl);
  }

  final client = probe ?? http.Client();
  try {
    final res = await client.get(Uri.parse('$lan/health')).timeout(timeout);
    if (res.statusCode == 200) return cfg;
  } catch (_) {
    // fall through to the relay
  } finally {
    if (probe == null) client.close();
  }
  return cfg.copyWith(baseUrl: cfg.normalizedRelayUrl);
}
