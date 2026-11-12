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

/// Default budget for one `/api/mobile/pairing/verify` round-trip.
const Duration kPairingRequestTimeout = Duration(seconds: 15);

/// Outcome of a pairing redemption.
class PairingResult {
  /// Credentials to save (`baseUrl` as shown in the link/form, token = device
  /// token when one was issued, otherwise the legacy link/manual token).
  final ConnectionConfig config;

  /// Device id the gateway paired (v2), or the locally generated id; empty for
  /// manual entry (no pairing round-trip happened).
  final String deviceId;

  const PairingResult({required this.config, required this.deviceId});
}

/// Pairing failed (non-200 from `/api/mobile/pairing/verify`, or transport).
class PairingException implements Exception {
  final String message;
  final int? statusCode;

  const PairingException(this.message, {this.statusCode});

  @override
  String toString() => 'PairingException: $message';
}

/// User-facing message for a failed pairing attempt.
///
/// Gateway failures keep their own message (it carries the HTTP status);
/// transport/timeout/decoding failures collapse to a neutral label so the UI
/// never shows a raw exception string.
String pairingErrorMessage(Object error) {
  if (error is PairingException) return error.message;
  return '配对请求失败';
}

/// Whether this attempt should ask the gateway to rotate an existing device
/// credential (`rotate:true` on verify).
///
/// Deliberately **URL-agnostic**: the gateway's 409 `device_already_paired` is
/// keyed on the `deviceId` hash only, so an install that re-pairs the same
/// device through a different route (Tailscale ↔ LAN ↔ changed port) must
/// still rotate. A gateway with no record for this device ignores the flag.
bool shouldRotateForPairing({
  required ConnectionConfig? existing,
  required String nonce,
}) {
  if (nonce == kManualPairingNonce) return false;
  if (existing == null || existing.apiToken.isEmpty) return false;
  return true;
}

/// Redeem [nonce] against [baseUrl] and return the credentials to persist.
///
/// - [linkToken] is the token embedded in a legacy v1 link (empty for v2). It
///   is sent as `Authorization` when present (old gateways may still require
///   it) and is the fallback credential when the gateway issues no device
///   token.
/// - [rotate] asks the gateway to rotate an existing credential for this
///   [deviceId] (re-pair); v1 gateways ignore it. A 409
///   `device_already_paired` is retried once with `rotate:true` — the gateway
///   preserves the nonce on 409, so the retry is free.
/// - [kManualPairingNonce] skips the network entirely.
///
/// A 200 that yields neither a device token nor a legacy link token fails
/// closed ([PairingException] `missing device credential`) rather than storing
/// an unusable empty credential.
///
/// Throws [PairingException] on non-200 / missing credential and
/// `TimeoutException` when the [requestTimeout] budget is exceeded.
Future<PairingResult> redeemPairing({
  required String baseUrl,
  required String linkToken,
  required String nonce,
  required http.Client client,
  required String deviceId,
  String platform = 'unknown',
  String deviceName = 'Orcalore',
  bool rotate = false,
  Duration requestTimeout = kPairingRequestTimeout,
}) async {
  if (nonce == kManualPairingNonce) {
    return PairingResult(
      config: ConnectionConfig(baseUrl: baseUrl, apiToken: linkToken),
      deviceId: '',
    );
  }

  final root = baseUrl.replaceAll(RegExp(r'/+$'), '');
  final headers = <String, String>{
    'Content-Type': 'application/json',
    // v2: the nonce is the credential, so no Authorization header is needed.
    // Legacy v1 gateways may still enforce the shared token.
    if (linkToken.isNotEmpty) 'Authorization': 'Bearer $linkToken',
  };

  Future<http.Response> post({required bool withRotate}) {
    final body = <String, dynamic>{
      'nonce': nonce,
      if (deviceId.isNotEmpty) 'deviceId': deviceId,
      'platform': platform,
      'deviceName': deviceName,
      if (withRotate) 'rotate': true,
    };
    return client
        .post(
          Uri.parse('$root/api/mobile/pairing/verify'),
          headers: headers,
          body: jsonEncode(body),
        )
        .timeout(requestTimeout);
  }

  var res = await post(withRotate: rotate);
  // Re-pair after a wiped local store: the gateway rejects the first attempt
  // with 409 and keeps the nonce valid, so one rotate retry is enough.
  if (res.statusCode == 409 && !rotate) {
    res = await post(withRotate: true);
  }

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
    throw const PairingException('missing device credential');
  }

  return PairingResult(
    config: ConnectionConfig(baseUrl: baseUrl, apiToken: token),
    deviceId: gatewayDeviceId ?? deviceId,
  );
}
