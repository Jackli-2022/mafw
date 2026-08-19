/// Persistent connection settings (base URL + API token), stored locally.
library;

import '../services/secure_config_store.dart';

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
