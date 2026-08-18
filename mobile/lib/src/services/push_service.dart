/// Push notification service for MAFW mobile.
///
/// Manages FCM token lifecycle, notification channels, and click-through
/// routing. Uses HTTP client injection for testability.
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/connection_config.dart';

/// Importance levels for notification channels.
enum NotificationImportance {
  low,
  defaultImportance,
  high,
  max,
}

/// Configuration for a notification channel.
class NotificationChannelConfig {
  final String id;
  final String name;
  final String? description;
  final NotificationImportance importance;
  final bool enableVibration;
  final bool enableLights;

  const NotificationChannelConfig({
    required this.id,
    required this.name,
    this.description,
    this.importance = NotificationImportance.defaultImportance,
    this.enableVibration = false,
    this.enableLights = false,
  });
}

/// Parsed notification data payload.
class NotificationData {
  final String? sessionID;
  final String type;
  final String? title;
  final String? body;

  const NotificationData({
    this.sessionID,
    required this.type,
    this.title,
    this.body,
  });
}

/// Exception thrown by PushService operations.
class PushServiceException implements Exception {
  final String message;
  final int? statusCode;

  PushServiceException(this.message, {this.statusCode});

  @override
  String toString() => 'PushServiceException: $message';
}

/// Push notification service for MAFW mobile.
///
/// Handles FCM token lifecycle, notification channel setup, and
/// device registration with the MAFW gateway.
class PushService {
  final ConnectionConfig config;
  final http.Client _httpClient;
  String? _currentToken;
  Timer? _retryTimer;
  bool _disposed = false;

  /// Notification channel definitions.
  static const List<NotificationChannelConfig> notificationChannels = [
    NotificationChannelConfig(
      id: 'mafw_messages',
      name: 'MAFW 消息',
      description: 'MAFW 会话消息通知',
      importance: NotificationImportance.high,
      enableVibration: true,
      enableLights: true,
    ),
    NotificationChannelConfig(
      id: 'mafw_goals',
      name: 'MAFW Goals',
      description: 'Goal 状态更新通知',
      importance: NotificationImportance.defaultImportance,
    ),
  ];

  PushService({
    required this.config,
    http.Client? httpClient,
  }) : _httpClient = httpClient ?? http.Client();

  /// Get current FCM token.
  String? get currentToken => _currentToken;

  /// Initialize the push service.
  ///
  /// This should be called after Firebase.initializeApp().
  /// In production, this would:
  /// 1. Request notification permissions
  /// 2. Get FCM token
  /// 3. Set up token refresh listener
  /// 4. Register device with gateway
  Future<void> init() async {
    // In production, this would use FirebaseMessaging.instance
    // For now, we just set up the token refresh listener
  }

  /// Handle FCM token refresh.
  ///
  /// Re-registers the device with the gateway using the new token.
  Future<void> onTokenRefresh(String newToken) async {
    _currentToken = newToken;
    await registerDevice(
      token: newToken,
      platform: 'android',
    );
  }

  /// Register device token with the gateway.
  ///
  /// Sends POST /api/mobile/devices/register with token and platform info.
  /// Retries up to 3 times on network errors.
  Future<void> registerDevice({
    required String token,
    required String platform,
    String? deviceName,
  }) async {
    final url = Uri.parse('${config.normalizedBaseUrl}/api/mobile/devices/register');
    final headers = {
      'Content-Type': 'application/json',
      if (config.apiToken.isNotEmpty) 'Authorization': 'Bearer ${config.apiToken}',
    };

    final body = jsonEncode({
      'token': token,
      'platform': platform,
      if (deviceName != null) 'deviceName': deviceName,
    });

    var lastError = -1;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        final response = await _httpClient.post(url, headers: headers, body: body);

        if (response.statusCode == 200) {
          return;
        }

        lastError = response.statusCode;
      } catch (e) {
        lastError = -1;
        if (attempt < 2) {
          // Exponential backoff: 1s, 2s
          await Future.delayed(Duration(seconds: 1 << attempt));
          continue;
        }
      }
    }

    throw PushServiceException(
      'Failed to register device after 3 attempts',
      statusCode: lastError,
    );
  }

  /// Parse notification data payload.
  ///
  /// Extracts sessionID, type, title, and body from the data map.
  static NotificationData parseNotificationData(Map<String, dynamic> data) {
    return NotificationData(
      sessionID: data['sessionID'] as String?,
      type: (data['type'] as String?) ?? 'unknown',
      title: data['title'] as String?,
      body: data['body'] as String?,
    );
  }

  /// Handle notification tap (click-through).
  ///
  /// Returns the sessionID to navigate to, or null if no navigation needed.
  Future<String?> handleNotificationTap(Map<String, dynamic> data) async {
    final parsed = parseNotificationData(data);

    if (parsed.sessionID != null && parsed.type == 'message') {
      return parsed.sessionID;
    }

    return null;
  }

  /// Dispose resources.
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _retryTimer?.cancel();
    _httpClient.close();
  }
}
