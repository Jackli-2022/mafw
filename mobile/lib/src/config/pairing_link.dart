/// Parser for the Orcalore pairing deep link (`orcalore://pair?...`).
///
/// Lockstep with the gateway generator (`gateway/src/mobile/pairing.ts`) and
/// the Android intent-filter (`AndroidManifest.xml`). The legacy `mafw://pair`
/// scheme is **rejected** — only [kPairingScheme] is accepted.
library;

import 'connection_config.dart';

/// Deep-link scheme owned by Orcalore.
const String kPairingScheme = 'orcalore';

/// Deep-link host that carries the pairing payload.
const String kPairingHost = 'pair';

/// Failure modes for [parsePairingLink].
enum PairingLinkError {
  none,
  malformed,
  expired,
}

/// Parsed pairing payload.
class PairingLink {
  /// Gateway base URL carried by the QR code.
  final String url;

  /// Gateway API token (may be empty when the gateway has no token configured).
  final String token;

  /// Single-use pairing nonce, redeemed at `POST /api/mobile/pairing/verify`.
  final String nonce;

  const PairingLink({required this.url, required this.token, required this.nonce});
}

/// Result of [parsePairingLink] — exactly one of [link] / [error] is meaningful.
class PairingLinkResult {
  final PairingLink? link;
  final PairingLinkError error;

  const PairingLinkResult._(this.link, this.error);

  bool get ok => link != null;
  bool get isExpired => error == PairingLinkError.expired;

  static const PairingLinkResult malformed = PairingLinkResult._(null, PairingLinkError.malformed);
  static const PairingLinkResult expired = PairingLinkResult._(null, PairingLinkError.expired);

  static PairingLinkResult success(PairingLink link) =>
      PairingLinkResult._(link, PairingLinkError.none);
}

/// Pairing-time URL policy (single source shared by the page and its tests).
///
/// v1 connects over Tailscale/private networks only: https, `*.ts.net`,
/// loopback, bare-IP/LAN cleartext (with a warning) are acceptable; public
/// cleartext hostnames and non-http(s) URLs are rejected.
bool canPairWithUrl(String url) {
  final check = checkBaseUrl(url);
  return check == UrlCheck.ok ||
      check == UrlCheck.bareIpWarn ||
      check == UrlCheck.plaintextLanWarn;
}

/// Parse and validate a pairing deep link.
///
/// Accepts only `orcalore://pair?url=...&token=...&v=1&exp=...&nonce=...`.
/// Returns [PairingLinkError.expired] when `exp` is in the past (relative to
/// [now], injectable for tests).
PairingLinkResult parsePairingLink(String raw, {DateTime? now}) {
  try {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null) return PairingLinkResult.malformed;
    if (uri.scheme != kPairingScheme || uri.host != kPairingHost) {
      return PairingLinkResult.malformed;
    }

    final params = uri.queryParameters;
    final url = params['url'];
    final token = params['token'];
    final v = params['v'];
    final exp = params['exp'];
    final nonce = params['nonce'];

    if (url == null ||
        url.isEmpty ||
        token == null ||
        v != '1' ||
        exp == null ||
        nonce == null ||
        nonce.isEmpty) {
      return PairingLinkResult.malformed;
    }

    final expMs = int.tryParse(exp);
    if (expMs == null) return PairingLinkResult.malformed;

    final nowMs = (now ?? DateTime.now()).millisecondsSinceEpoch;
    if (nowMs > expMs) return PairingLinkResult.expired;

    return PairingLinkResult.success(PairingLink(url: url, token: token, nonce: nonce));
  } catch (_) {
    return PairingLinkResult.malformed;
  }
}
