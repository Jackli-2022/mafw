import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/connection_config.dart';

/// Secure storage for ConnectionConfig.
/// - baseUrl  → SharedPreferences (non-sensitive)
/// - apiToken → flutter_secure_storage (EncryptedSharedPreferences on Android)
/// Handles one-time migration from legacy SharedPreferences token.
class SecureConfigStore {
  static const _kUrl = 'mafw_conn_base_url';
  static const _kTokenLegacy = 'mafw_conn_token';
  static const _kToken = 'mafw_secure_token';

  final FlutterSecureStorage _sec;

  SecureConfigStore({FlutterSecureStorage? secureStorage}) : _sec = secureStorage ?? const FlutterSecureStorage();

  Future<ConnectionConfig> load() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString(_kUrl) ?? 'http://192.168.1.100:3000';
    String? token = await _sec.read(key: _kToken);
    if (token == null) {
      final legacy = prefs.getString(_kTokenLegacy);
      if (legacy != null && legacy.isNotEmpty) {
        token = legacy;
        await _sec.write(key: _kToken, value: legacy);
        await prefs.remove(_kTokenLegacy);
      }
    }
    return ConnectionConfig(baseUrl: url, apiToken: token ?? '');
  }

  Future<void> save(ConnectionConfig c) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kUrl, c.baseUrl);
    await _sec.write(key: _kToken, value: c.apiToken);
  }

  /// Explicit migration helper (also called implicitly by load).
  Future<void> migrateLegacy() async {
    final prefs = await SharedPreferences.getInstance();
    final legacy = prefs.getString(_kTokenLegacy);
    if (legacy != null && legacy.isNotEmpty) {
      final existing = await _sec.read(key: _kToken);
      if (existing == null || existing.isEmpty) {
        await _sec.write(key: _kToken, value: legacy);
      }
      await prefs.remove(_kTokenLegacy);
    }
  }
}
