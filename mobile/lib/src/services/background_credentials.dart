/// Background (WorkManager) credential mirror.
///
/// The WorkManager callback runs in its own isolate with no access to
/// `flutter_secure_storage`, so `PushService` keeps a plaintext copy of the
/// base URL + bearer token in SharedPreferences. E5a: that bearer is the
/// revocable **device token** (`dev_…`), which must be refreshed whenever the
/// app re-pairs — otherwise background polling keeps presenting a token the
/// gateway once issued to a superseded pairing.
library;

import 'package:shared_preferences/shared_preferences.dart';

import '../config/connection_config.dart';

/// SharedPreferences key holding the background gateway base URL.
const String kBgBaseUrlKey = 'mafw_bg_base_url';

/// SharedPreferences key holding the background bearer (device token).
const String kBgApiTokenKey = 'mafw_bg_api_token';

/// Write both background keys unconditionally (used on push init/startup).
Future<void> writeBackgroundCredentials(
  ConnectionConfig config, {
  SharedPreferences? prefs,
}) async {
  final store = prefs ?? await SharedPreferences.getInstance();
  await store.setString(kBgBaseUrlKey, config.normalizedBaseUrl);
  await store.setString(kBgApiTokenKey, config.apiToken);
}

/// Refresh the background copy **only when it already exists**.
///
/// Called after a pairing save: an app that never initialized push must not
/// silently gain a plaintext bearer. Returns true when anything was updated.
Future<bool> syncBackgroundCredentials(
  ConnectionConfig config, {
  SharedPreferences? prefs,
}) async {
  final store = prefs ?? await SharedPreferences.getInstance();
  if (!store.containsKey(kBgApiTokenKey)) return false;

  var changed = false;
  if (store.getString(kBgApiTokenKey) != config.apiToken) {
    await store.setString(kBgApiTokenKey, config.apiToken);
    changed = true;
  }
  final baseUrl = config.normalizedBaseUrl;
  if (store.containsKey(kBgBaseUrlKey) && store.getString(kBgBaseUrlKey) != baseUrl) {
    await store.setString(kBgBaseUrlKey, baseUrl);
    changed = true;
  }
  return changed;
}
