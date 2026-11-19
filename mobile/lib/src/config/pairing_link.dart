/// Parser for the Orcalore pairing deep link (`orcalore://pair?...`).
///
/// Lockstep with the gateway generator (`gateway/src/mobile/pairing.ts`) and
/// the Android intent-filter (`AndroidManifest.xml`). The legacy `mafw://pair`
/// scheme is **rejected** — only [kPairingScheme] is accepted.
///
/// Two link formats coexist (E5a):
/// - `v=1` — legacy: embeds the shared gateway `token`.
/// - `v=2` — device credentials: `url` / `exp` / `nonce` only; the nonce is
///   exchanged for a revocable `dev_…` token at `/api/mobile/pairing/verify`.
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

  /// Gateway credential carried by **v1** links (shared `apiToken`).
  ///
  /// v2 links never embed a credential — pairing mints a revocable per-device
  /// token from the nonce — so this is the empty string for v2. Callers must
  /// treat it as "legacy token, if any" rather than "the credential".
  final String token;

  /// Single-use pairing nonce, redeemed at `POST /api/mobile/pairing/verify`.
  final String nonce;

  /// Link format version (`1` = legacy shared token, `2` = device token).
  final int version;

  /// Stable relay Room URL (`https://<roomId>-<routeSecret>.<domain>`), if any.
  final String relayUrl;

  /// SHA-256 fingerprint (lowercase hex) of the gateway's Room certificate.
  final String fingerprint;

  const PairingLink({
    required this.url,
    required this.token,
    required this.nonce,
    this.version = 2,
    this.relayUrl = '',
    this.fingerprint = '',
  });
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
/// Accepts only `orcalore://pair?...` (scheme [kPairingScheme], host
/// [kPairingHost] — unchanged since v1):
///
/// - `v=2`: `url` / `exp` / `nonce` required, `token` optional (v2 gateways
///   mint a device token from the nonce, so the link carries no credential).
/// - `v=1`: `token` still required — legacy gateways embed the shared API
///   token in the link.
///
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
    final token = params['token'] ?? '';
    final v = params['v'];
    final exp = params['exp'];
    final nonce = params['nonce'];
    final relayUrl = (params['relayUrl'] ?? '').replaceAll(RegExp(r'/+$'), '');
    final fingerprint = (params['fp'] ?? '').trim().toLowerCase();

    if (url == null || url.isEmpty || exp == null || nonce == null || nonce.isEmpty) {
      return PairingLinkResult.malformed;
    }
    if (relayUrl.isEmpty != fingerprint.isEmpty) return PairingLinkResult.malformed;
    if (relayUrl.isNotEmpty) {
      final relay = Uri.tryParse(relayUrl);
      if (relay == null || relay.scheme != 'https' || relay.host.isEmpty) {
        return PairingLinkResult.malformed;
      }
      if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(fingerprint)) {
        return PairingLinkResult.malformed;
      }
    }

    final int version;
    if (v == '2') {
      version = 2;
    } else if (v == '1') {
      // Legacy links are only meaningful with the embedded shared token.
      if (token.isEmpty) return PairingLinkResult.malformed;
      version = 1;
    } else {
      return PairingLinkResult.malformed;
    }

    final expMs = int.tryParse(exp);
    if (expMs == null) return PairingLinkResult.malformed;

    final nowMs = (now ?? DateTime.now()).millisecondsSinceEpoch;
    if (nowMs > expMs) return PairingLinkResult.expired;

    return PairingLinkResult.success(
      PairingLink(
        url: url,
        token: token,
        nonce: nonce,
        version: version,
        relayUrl: relayUrl,
        fingerprint: fingerprint,
      ),
    );
  } catch (_) {
    return PairingLinkResult.malformed;
  }
}
