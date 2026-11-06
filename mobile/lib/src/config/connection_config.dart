/// Persistent connection settings (base URL + API token), stored locally.
library;

import '../services/secure_config_store.dart';

/// Form-level judgement for a gateway base URL (spec §6 connection layer).
enum UrlCheck {
  /// Usable as-is (https, loopback dev, or a `*.ts.net` MagicDNS host).
  ok,

  /// Cleartext over a bare IP (Tailscale 100.64/10 or public) — prefer MagicDNS.
  bareIpWarn,

  /// Cleartext over a private LAN address — trusted networks only.
  plaintextLanWarn,

  /// Cleartext over a public hostname — rejected (v1 is Tailscale/private only).
  publicPlaintext,

  /// Not an absolute http(s) URL.
  invalid,
}

final RegExp _ipv4Pattern = RegExp(r'^\d{1,3}(\.\d{1,3}){3}$');

bool _isIpHost(String host) {
  if (_ipv4Pattern.hasMatch(host)) return true;
  // IPv6 literals arrive without brackets from Uri.host.
  return host.contains(':');
}

bool _isPrivateLanIpv4(String host) {
  final parts = host.split('.').map(int.tryParse).toList();
  if (parts.length != 4 || parts.any((p) => p == null)) return false;
  final a = parts[0]!, b = parts[1]!;
  if (a == 192 && b == 168) return true;
  if (a == 10) return true;
  if (a == 172 && b >= 16 && b <= 31) return true;
  return false;
}

/// Classify [url] for the connection form / pairing policy.
///
/// This is an **application-layer** policy: `package:http` (Dart sockets) is
/// not governed by Android's network-security-config. The NSC exists for the
/// platform native stack (media playback such as TTS via just_audio/ExoPlayer)
/// and separately allowlists cleartext for the `ts.net` domain tree
/// (`includeSubdomains="true"`).
///
/// - `http://<host>.ts.net` → [UrlCheck.ok] (MagicDNS hostnames are the
///   preferred Tailscale path and are allowlisted for native media).
/// - `http://100.64.0.0/10` (Tailscale CGNAT) or any other bare IP →
///   [UrlCheck.bareIpWarn] — debug-friendly warning, prefer MagicDNS.
/// - `http://192.168./10./172.16-31.` and LAN mDNS names (single-label
///   hostnames like `DESKTOP-ABC` and `.local` names) → [UrlCheck.plaintextLanWarn]
///   — trusted networks only (warn but allow; keeps the mDNS discovery flow).
/// - Any other cleartext hostname (dotted public/FQDN) →
///   [UrlCheck.publicPlaintext] — rejected; v1 connects over Tailscale/private
///   networks only.
/// - Loopback stays [UrlCheck.ok] for `adb reverse` development.
/// - Anything that is not an absolute http(s) URL → [UrlCheck.invalid].
UrlCheck checkBaseUrl(String url) {
  final trimmed = url.trim();
  if (trimmed.isEmpty) return UrlCheck.invalid;

  final uri = Uri.tryParse(trimmed);
  if (uri == null) return UrlCheck.invalid;
  final scheme = uri.scheme.toLowerCase();
  if (scheme != 'http' && scheme != 'https') return UrlCheck.invalid;
  if (uri.host.isEmpty) return UrlCheck.invalid;

  if (scheme == 'https') return UrlCheck.ok;

  final host = uri.host.toLowerCase();
  if (host == 'localhost' || host == '127.0.0.1' || host == '::1') {
    return UrlCheck.ok;
  }
  if (host == 'ts.net' || host.endsWith('.ts.net')) return UrlCheck.ok;
  if (_isIpHost(host)) {
    return _isPrivateLanIpv4(host) ? UrlCheck.plaintextLanWarn : UrlCheck.bareIpWarn;
  }
  // LAN mDNS discovery (spec §6 keeps it): single-label hostnames (often the
  // `os.hostname()` SRV target) and `.local` names stay warn-but-allow, the
  // same tier as private LAN IPs. Dotted public hostnames remain rejected.
  if (!host.contains('.') || host.endsWith('.local')) {
    return UrlCheck.plaintextLanWarn;
  }
  return UrlCheck.publicPlaintext;
}

class ConnectionConfig {
  final String baseUrl; // e.g. http://192.168.1.5:3000 or https://... tailscale
  final String apiToken;

  const ConnectionConfig({required this.baseUrl, required this.apiToken});

  String get normalizedBaseUrl => baseUrl.replaceAll(RegExp(r'/+$'), '');

  String get wsUrl => '${normalizedBaseUrl
      .replaceFirst('https://', 'wss://')
      .replaceFirst('http://', 'ws://')}/api/ws';

  Map<String, String> get headers => {
        'Content-Type': 'application/json',
        if (apiToken.isNotEmpty) 'Authorization': 'Bearer $apiToken',
      };

  static Future<ConnectionConfig> load() async {
    return SecureConfigStore().load();
  }

  Future<void> save() async {
    return SecureConfigStore().save(this);
  }
}
