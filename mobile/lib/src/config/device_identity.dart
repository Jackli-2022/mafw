/// Stable per-install device identity for pairing v2 (E5a).
///
/// The gateway keys device credentials by `deviceId` (see
/// `gateway/src/mobile/device-store.ts`, `DEVICE_ID_RE`). The id must survive
/// app restarts so re-pairing rotates the same device record instead of
/// piling up phantom devices. It is not a secret: it carries no authority by
/// itself (`dev_` tokens do).
library;

import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

/// SharedPreferences key holding [getOrCreateDeviceId]'s value.
const String kDeviceIdKey = 'mafw_device_id';

/// Random 32-char lowercase hex id (128 bits from [Random.secure]).
///
/// 32 hex chars fit the gateway's device-id charset/length bounds and match the
/// legacy `sha256(FCM token).slice(0, 32)` shape it replaces — no migration is
/// needed for existing device records.
String generateDeviceId({Random? random}) {
  final rng = random ?? Random.secure();
  final buffer = StringBuffer();
  for (var i = 0; i < 16; i++) {
    buffer.write(rng.nextInt(256).toRadixString(16).padLeft(2, '0'));
  }
  return buffer.toString();
}

/// Return the persisted device id, generating and storing one on first use.
///
/// [prefs] is injectable for tests; production callers pass nothing.
Future<String> getOrCreateDeviceId({SharedPreferences? prefs}) async {
  final store = prefs ?? await SharedPreferences.getInstance();
  final existing = store.getString(kDeviceIdKey);
  if (existing != null && existing.isNotEmpty) return existing;

  final id = generateDeviceId();
  await store.setString(kDeviceIdKey, id);
  return id;
}
