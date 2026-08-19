/// Push notification service for MAFW mobile.
///
/// Manages FCM token lifecycle, notification channels, click-through
/// routing, WsClient event consumption, and WorkManager background fetch.
/// Uses HTTP client injection for testability.
library;

import 'dart:async';
import 'dart:convert';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

import '../config/connection_config.dart';
import '../models/mafw_models.dart';
import '../network/ws_client.dart';

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

/// Builds an FCM data payload (gateway → FCM → device).
///
/// Spec §6.2: FCM 仅摘要（不含全文），`title≤12, summary≤80, ts`，
/// 禁止 `text` 明文全量字段。
Map<String, String> buildFcmData({
  required String type,
  required String sessionID,
  String? title,
  String? summary,
  String? ts,
}) {
  final t = (title ?? '').length > 12 ? (title ?? '').substring(0, 12) : (title ?? '');
  final s = (summary ?? '').length > 80 ? (summary ?? '').substring(0, 80) : (summary ?? '');
  return {
    'type': type,
    'sessionID': sessionID,
    if (t.isNotEmpty) 'title': t,
    if (s.isNotEmpty) 'summary': s,
    if (ts != null && ts.isNotEmpty) 'ts': ts,
  };
}

/// SharedPreferences key for last FCM arrival timestamp (msSinceEpoch).
const kLastFcmAtKey = 'mafw_last_fcm_at';

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
/// Handles FCM token lifecycle, notification channel setup, device
/// registration with the MAFW gateway, WsClient event consumption,
/// click-through navigation, and WorkManager background health checks.
class PushService {
  final ConnectionConfig config;
  final http.Client _httpClient;
  final WsClient? _ws;
  final Future<void> Function()? _onRefreshSessions;
  final void Function(String sessionID)? _onNavigateToSession;

  String? _currentToken;
  String? _currentSessionID;
  Timer? _retryTimer;
  Timer? _tokenRefreshTimer;
  bool _disposed = false;

  StreamSubscription<RemoteMessage>? _onMessageSub;
  StreamSubscription<RemoteMessage>? _onMessageOpenedAppSub;
  StreamSubscription<String>? _onTokenRefreshSub;
  StreamSubscription<MafwEvent>? _wsEventSub;

  final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();

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

  /// WorkManager task identifier for periodic gateway health checks.
  static const String _healthCheckTask = 'mafw_gateway_health_check';

  PushService({
    required this.config,
    http.Client? httpClient,
    WsClient? ws,
    Future<void> Function()? onRefreshSessions,
    void Function(String sessionID)? onNavigateToSession,
  })  : _httpClient = httpClient ?? http.Client(),
        _ws = ws,
        _onRefreshSessions = onRefreshSessions,
        _onNavigateToSession = onNavigateToSession;

  /// Get current FCM token.
  String? get currentToken => _currentToken;

  /// Current session being viewed — set by ChatPage enter/exit to suppress
  /// foreground notifications for the active session (spec §6.2).
  String? get currentSessionID => _currentSessionID;
  set currentSessionID(String? v) => _currentSessionID = v;

  /// Initialize the push service.
  ///
  /// Must be called after Firebase.initializeApp().
  /// Sets up:
  /// 1. Notification channels via flutter_local_notifications
  /// 2. Notification permission request (Android 13+ POST_NOTIFICATIONS)
  /// 3. FCM token retrieval and device registration
  /// 4. Token refresh listener
  /// 5. Foreground message display via local notifications
  /// 6. Click-through navigation via onMessageOpenedApp / getInitialMessage
  /// 7. WsClient event consumption for session refresh
  /// 8. WorkManager periodic health check (15 min)
  Future<void> init() async {
    // Guard: placeholder google-services.json must not block startup — every
    // Firebase/WorkManager call is catchable and the app works offline via WS.
    try {
      FirebaseMessaging.instance.setAutoInitEnabled(true);
    } catch (_) {}

    // 1. Notification channels
    try {
      await _createNotificationChannels();
    } catch (_) {}

    // 2. Request notification permissions (Android 13+ POST_NOTIFICATIONS)
    AuthorizationStatus permStatus = AuthorizationStatus.notDetermined;
    try {
      final settings = await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      permStatus = settings.authorizationStatus;
    } catch (_) {}
    if (permStatus == AuthorizationStatus.denied) {
      // Permission denied — continue without push, token will be null
    }

    // 3. Initialize local notifications for foreground display
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidSettings);
    await _localNotifications.initialize(
      initSettings,
      onDidReceiveNotificationResponse: _onNotificationTap,
    );

    // 4. Get FCM token and register
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) {
        _currentToken = token;
        await _registerCurrentToken();
      }
    } catch (_) {}

    // 5. Token refresh listener
    try {
      _onTokenRefreshSub = FirebaseMessaging.instance.onTokenRefresh.listen(
        onTokenRefresh,
        onError: (_) {},
      );
    } catch (_) {}

    // 6. Foreground message listener
    try {
      _onMessageSub = FirebaseMessaging.onMessage.listen(_onForegroundMessage);
    } catch (_) {}

    // 7. Click-through: app opened via notification tap
    try {
      _onMessageOpenedAppSub = FirebaseMessaging.onMessageOpenedApp.listen(
        _onMessageOpenedApp,
      );
    } catch (_) {}

    // 8. Click-through: app opened from terminated state via notification
    try {
      final initialMessage = await FirebaseMessaging.instance.getInitialMessage();
      if (initialMessage != null) {
        _handleInitialMessage(initialMessage);
      }
    } catch (_) {}

    // 9. Periodic token refresh (every 12h)
    _tokenRefreshTimer = Timer.periodic(
      const Duration(hours: 12),
      (_) => _refreshToken(),
    );

    // 10. WsClient event consumption
    _subscribeToWsEvents();

    // 11. WorkManager background health check
    try {
      await _registerBackgroundHealthCheck();
    } catch (_) {}

    // 12. Persist config for background handler
    try {
      await _persistConfigForBackground();
    } catch (_) {}
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
    _tokenRefreshTimer?.cancel();
    _onMessageSub?.cancel();
    _onMessageOpenedAppSub?.cancel();
    _onTokenRefreshSub?.cancel();
    _wsEventSub?.cancel();
    _httpClient.close();
  }

  // --- Private: Notification Channels ---

  Future<void> _createNotificationChannels() async {
    final plugin = _localNotifications.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    if (plugin == null) return;

    for (final ch in notificationChannels) {
      final importance = _mapImportance(ch.importance);
      final androidCh = AndroidNotificationChannel(
        ch.id,
        ch.name,
        description: ch.description,
        importance: importance,
        enableVibration: ch.enableVibration,
        enableLights: ch.enableLights,
      );
      await plugin.createNotificationChannel(androidCh);
    }
  }

  Importance _mapImportance(NotificationImportance i) {
    switch (i) {
      case NotificationImportance.low:
        return Importance.low;
      case NotificationImportance.defaultImportance:
        return Importance.defaultImportance;
      case NotificationImportance.high:
        return Importance.high;
      case NotificationImportance.max:
        return Importance.max;
    }
  }

  // --- Private: Token Management ---

  Future<void> _registerCurrentToken() async {
    final token = _currentToken;
    if (token == null) return;
    try {
      await registerDevice(token: token, platform: 'android');
    } catch (_) {
      // Best-effort; will retry on next token refresh
    }
  }

  Future<void> _refreshToken() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null && token != _currentToken) {
        await onTokenRefresh(token);
      }
    } catch (_) {
      // Non-fatal; next periodic refresh will retry
    }
  }

  // --- Private: Foreground Messages ---

  Future<void> _recordFcmArrival() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt(kLastFcmAtKey, DateTime.now().millisecondsSinceEpoch);
    } catch (_) {}
  }

  void _onForegroundMessage(RemoteMessage message) {
    // Record FCM arrival for lastFcmAt >24h gating (background frequency logic).
    unawaited(_recordFcmArrival());
    final notification = message.notification;
    if (notification == null) return;

    final data = message.data;
    final parsed = parseNotificationData(data);

    // Spec §6.2: 若正看该 session，仅刷新 WsClient.events，不弹本地通知。
    if (parsed.sessionID != null && parsed.sessionID == _currentSessionID) {
      _onRefreshSessions?.call();
      return;
    }

    final channelId = parsed.type == 'goal_update'
        ? 'mafw_goals'
        : 'mafw_messages';

    _localNotifications.show(
      notification.hashCode,
      notification.title ?? 'MAFW',
      notification.body ?? '',
      NotificationDetails(
        android: AndroidNotificationDetails(
          channelId,
          channelId == 'mafw_goals' ? 'MAFW Goals' : 'MAFW 消息',
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
      payload: jsonEncode(data),
    );
  }

  // --- Private: Click-Through Navigation ---

  void _onNotificationTap(NotificationResponse response) {
    final payload = response.payload;
    if (payload == null) return;
    try {
      final data = jsonDecode(payload) as Map<String, dynamic>;
      final parsed = parseNotificationData(data);
      if (parsed.sessionID != null) {
        _onNavigateToSession?.call(parsed.sessionID!);
      }
    } catch (_) {
      // malformed payload
    }
  }

  void _onMessageOpenedApp(RemoteMessage message) {
    unawaited(_recordFcmArrival());
    final data = message.data;
    final parsed = parseNotificationData(data);
    if (parsed.sessionID != null) {
      _onNavigateToSession?.call(parsed.sessionID!);
    }
  }

  void _handleInitialMessage(RemoteMessage message) {
    unawaited(_recordFcmArrival());
    final data = message.data;
    final parsed = parseNotificationData(data);
    if (parsed.sessionID != null) {
      // Delay navigation until first frame is rendered
      Future.delayed(
        Duration.zero,
        () => _onNavigateToSession?.call(parsed.sessionID!),
      );
    }
  }

  // --- Private: WsClient Event Consumption ---

  void _subscribeToWsEvents() {
    final ws = _ws;
    if (ws == null) return;

    _wsEventSub = ws.events.listen((event) {
      final propsType = event.properties?['type'] ?? '';
      if (event.type == 'opencode_event' &&
          (propsType == 'session.created' ||
              propsType == 'message.updated' ||
              propsType == 'session.idle')) {
        _onRefreshSessions?.call();
      }
    });
  }

  /// Returns true when WorkManager should add frequency / poll listSessions.
  /// Spec §6.2: `lastFcmAt>24h 加频` — no FCM for 24h → background health polling fills the gap.
  static Future<bool> shouldIncreaseFrequency({int nowMs = -1}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final last = prefs.getInt(kLastFcmAtKey);
      if (last == null) return true; // no FCM ever → increase polling
      final now = nowMs < 0 ? DateTime.now().millisecondsSinceEpoch : nowMs;
      return (now - last) > const Duration(hours: 24).inMilliseconds;
    } catch (_) {
      return false;
    }
  }

  // --- Private: WorkManager Background Health Check ---

  Future<void> _registerBackgroundHealthCheck() async {
    await Workmanager().initialize(
      callbackDispatcher,
      // isInDebugMode removed in workmanager 0.10.x
    );
    await Workmanager().registerPeriodicTask(
      _healthCheckTask,
      _healthCheckTask,
      frequency: const Duration(minutes: 15),
      constraints: Constraints(
        networkType: NetworkType.connected,
        requiresBatteryNotLow: true,
      ),
      existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
    );
  }

  Future<void> _persistConfigForBackground() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('mafw_bg_base_url', config.normalizedBaseUrl);
    await prefs.setString('mafw_bg_api_token', config.apiToken);
  }

  // --- Private: Token Helpers (exposed for testing) ---

  @visibleForTesting
  void setCurrentToken(String token) {
    _currentToken = token;
  }
}

/// Top-level WorkManager background callback.
///
/// Runs every 15 minutes to check gateway health (spec §6.2).
/// Reads config from SharedPreferences (persisted by PushService.init()).
/// When `lastFcmAt>24h` additionally polls `listSessions`-style endpoint
/// (lightweight health + sessions check).
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    if (task != PushService._healthCheckTask) {
      return Future.value(true);
    }

    final prefs = await SharedPreferences.getInstance();
    final baseUrl = prefs.getString('mafw_bg_base_url');
    final apiToken = prefs.getString('mafw_bg_api_token');
    if (baseUrl == null || baseUrl.isEmpty) return Future.value(true);

    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (apiToken != null && apiToken.isNotEmpty)
        'Authorization': 'Bearer $apiToken',
    };

    try {
      final url = Uri.parse('$baseUrl/health');
      final resp = await http.get(url, headers: headers).timeout(
        const Duration(seconds: 10),
      );
      if (resp.statusCode != 200) return false;

      // lastFcmAt>24h → additionally verify sessions endpoint is reachable
      // (lightweight listSessions probe; avoids hammering when FCM is healthy).
      final last = prefs.getInt(kLastFcmAtKey);
      final overdue = last == null ||
          (DateTime.now().millisecondsSinceEpoch - last) >
              const Duration(hours: 24).inMilliseconds;
      if (overdue) {
        try {
          final listUrl = Uri.parse('$baseUrl/api/sessions');
          final r2 = await http.get(listUrl, headers: headers).timeout(
            const Duration(seconds: 10),
          );
          return r2.statusCode == 200;
        } catch (_) {
          return false;
        }
      }
      return true;
    } catch (_) {
      return false;
    }
  });
}
