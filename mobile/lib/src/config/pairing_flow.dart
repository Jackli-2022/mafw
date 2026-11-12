/// Pairing redemption flow shared by the QR scanner and the manual form.
///
/// E5a: pairing v2 links carry no credential. The single-use `nonce` is the
/// credential and `POST /api/mobile/pairing/verify` exchanges it for a
/// revocable per-device token (`dev_…`, see `gateway/src/routes/devices-mobile.ts`).
/// v1 links (and manual entry) still yield the shared/typed token.
///
/// Kept out of the widget so the network/credential rules are unit-testable
/// without mounting the camera scanner.
library;

import 'dart:convert';

import 'package:http/http.dart' as http;

import 'connection_config.dart';

/// Nonce sentinel used by the manual base-URL + token form (nothing to redeem).
const String kManualPairingNonce = '__manual__';

/// Prefix of device tokens issued by pairing v2 gateways.
const String kDeviceTokenPrefix = 'dev_';

/// Outcome of a pairing redemption.
class PairingResult {
  /// Credentials to save (`baseUrl` as shown in the link/form, token = device
  /// token when one was issued, otherwise the legacy link/manual token).
  final ConnectionConfig config;

  /// Device id the gateway paired (v2), or the locally generated id; empty for
  /// manual entry (no pairing round-trip happened).
  final String deviceId;

  /// True when the gateway issued a device token (`dev_…`) for this call.
  final bool verified;

  const PairingResult({
    required this.config,
    required this.deviceId,
    required this.verified,
  });
}

/// Pairing failed (non-200 from `/api/mobile/pairing/verify`, or transport).
class PairingException implements Exception {
  final String message;
  final int? statusCode;

  const PairingException(this.message, {this.statusCode});

  @override
  String toString() => 'PairingException: $message';
}

/// Whether this attempt should ask the gateway to rotate an existing device
/// credential (`rotate:true` on verify).
///
/// True only when pairing actually redeems a nonce **and** this install
/// already holds a token for the same gateway base URL — a fresh device would
/// otherwise be rejected by v2 gateways with 409 `device_already_paired`, and
/// sending `rotate` for a brand-new device would be a needless re-issue.
bool shouldRotateForPairing({
  required ConnectionConfig? existing,
  required String baseUrl,
  required String nonce,
}) {
  if (nonce == kManualPairingNonce) return false;
  if (existing == null || existing.apiToken.isEmpty) return false;
  final target = baseUrl.replaceAll(RegExp(r'/+$'), '');
  return existing.normalizedBaseUrl == target;
}

/// Redeem [nonce] against [baseUrl] and return the credentials to persist.
///
/// - [linkToken] is the token embedded in a legacy v1 link (empty for v2). It
///   is sent as `Authorization` when present (old gateways may still require
///   it) and is the fallback credential when the gateway issues no device
///   token.
/// - [rotate] asks the gateway to rotate an existing credential for the same
///   [deviceId] (re-pair); v1 gateways ignore it.
/// - [kManualPairingNonce] skips the network entirely.
///
/// Throws [PairingException] on non-200 so the caller can show the status.
Future<PairingResult> redeemPairing({
  required String baseUrl,
  required String linkToken,
  required String nonce,
  required http.Client client,
  required String deviceId,
  String platform = 'unknown',
  String deviceName = 'Orcalore',
  bool rotate = false,
}) async {
  if (nonce == kManualPairingNonce) {
    return PairingResult(
      config: ConnectionConfig(baseUrl: baseUrl, apiToken: linkToken),
      deviceId: '',
      verified: false,
    );
  }

  final root = baseUrl.replaceAll(RegExp(r'/+$'), '');
  final headers = <String, String>{
    'Content-Type': 'application/json',
    // v2: the nonce is the credential, so no Authorization header is needed.
    // Legacy v1 gateways may still enforce the shared token.
    if (linkToken.isNotEmpty) 'Authorization': 'Bearer $linkToken',
  };
  final body = <String, dynamic>{
    'nonce': nonce,
    if (deviceId.isNotEmpty) 'deviceId': deviceId,
    'platform': platform,
    'deviceName': deviceName,
    if (rotate) 'rotate': true,
  };

  final res = await client.post(
    Uri.parse('$root/api/mobile/pairing/verify'),
    headers: headers,
    body: jsonEncode(body),
  );

  if (res.statusCode != 200) {
    throw PairingException(
      '配对验证失败: ${res.statusCode}',
      statusCode: res.statusCode,
    );
  }

  String? issued;
  String? gatewayDeviceId;
  try {
    final decoded = jsonDecode(res.body);
    if (decoded is Map) {
      final token = decoded['token'];
      if (token is String && token.isNotEmpty) issued = token;
      final id = decoded['deviceId'];
      if (id is String && id.isNotEmpty) gatewayDeviceId = id;
    }
  } catch (_) {
    // Legacy gateway: `{ok:true}` (or an empty body) with the token in the
    // link. Fall through to the legacy credential below.
  }

  final isDeviceToken = issued != null && issued.startsWith(kDeviceTokenPrefix);
  final String token;
  if (isDeviceToken) {
    token = issued;
  } else if (linkToken.isNotEmpty) {
    token = linkToken;
  } else {
    token = '';
  }

  return PairingResult(
    config: ConnectionConfig(baseUrl: baseUrl, apiToken: token),
    deviceId: gatewayDeviceId ?? deviceId,
    verified: isDeviceToken,
  );
}
