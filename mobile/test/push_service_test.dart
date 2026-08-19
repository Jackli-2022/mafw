import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;

import 'package:mafw_mobile/src/config/connection_config.dart';
import 'package:mafw_mobile/src/models/mafw_models.dart';
import 'package:mafw_mobile/src/network/ws_client.dart';
import 'package:mafw_mobile/src/services/push_service.dart';

void main() {
  group('PushService', () {
    late PushService service;
    late ConnectionConfig config;
    late List<http.Request> capturedRequests;

    setUp(() {
      capturedRequests = [];
      config = const ConnectionConfig(
        baseUrl: 'http://localhost:3000',
        apiToken: 'test-token',
      );
    });

    tearDown(() {
      service.dispose();
    });

    test('registerDevice sends correct payload to gateway', () async {
      final mockClient = http_testing.MockClient((request) async {
        capturedRequests.add(request);
        return http.Response(
          jsonEncode({'ok': true, 'deviceID': 'dev-123'}),
          200,
        );
      });

      service = PushService(config: config, httpClient: mockClient);

      await service.registerDevice(
        token: 'fcm-token-abc',
        platform: 'android',
        deviceName: 'Pixel 7',
      );

      expect(capturedRequests.length, 1);
      final req = capturedRequests.first;
      expect(req.method, 'POST');
      expect(req.url.path, '/api/mobile/devices/register');

      final body = jsonDecode(req.body) as Map<String, dynamic>;
      expect(body['token'], 'fcm-token-abc');
      expect(body['platform'], 'android');
      expect(body['deviceName'], 'Pixel 7');
    });

    test('registerDevice includes Authorization header', () async {
      final mockClient = http_testing.MockClient((request) async {
        capturedRequests.add(request);
        return http.Response(jsonEncode({'ok': true}), 200);
      });

      service = PushService(config: config, httpClient: mockClient);

      await service.registerDevice(
        token: 'fcm-token-abc',
        platform: 'android',
      );

      final authHeader = capturedRequests.first.headers['authorization'];
      expect(authHeader, 'Bearer test-token');
    });

    test('registerDevice throws on non-200 response', () async {
      final mockClient = http_testing.MockClient((request) async {
        return http.Response(jsonEncode({'error': 'unauthorized'}), 401);
      });

      service = PushService(config: config, httpClient: mockClient);

      expect(
        () => service.registerDevice(
          token: 'fcm-token-abc',
          platform: 'android',
        ),
        throwsA(isA<PushServiceException>()),
      );
    });

    test('registerDevice retries on network error', () async {
      var attemptCount = 0;
      final mockClient = http_testing.MockClient((request) async {
        attemptCount++;
        if (attemptCount < 3) {
          throw http.ClientException('Connection refused');
        }
        capturedRequests.add(request);
        return http.Response(jsonEncode({'ok': true}), 200);
      });

      service = PushService(config: config, httpClient: mockClient);

      await service.registerDevice(
        token: 'fcm-token-abc',
        platform: 'android',
      );

      expect(capturedRequests.length, 1);
      expect(attemptCount, 3);
    });

    test('notification channels have correct configuration', () {
      service = PushService(config: config);

      final channels = PushService.notificationChannels;

      expect(channels.length, 2);

      final messagesChannel = channels.firstWhere((c) => c.id == 'mafw_messages');
      expect(messagesChannel.name, 'MAFW 消息');
      expect(messagesChannel.importance, NotificationImportance.high);
      expect(messagesChannel.enableVibration, true);

      final goalsChannel = channels.firstWhere((c) => c.id == 'mafw_goals');
      expect(goalsChannel.name, 'MAFW Goals');
      expect(goalsChannel.importance, NotificationImportance.defaultImportance);
    });

    test('parseNotificationData extracts sessionID from data payload', () {
      service = PushService(config: config);

      final data = {
        'type': 'message',
        'sessionID': 'sess-123',
        'title': 'New message',
        'body': 'Hello world',
      };

      final result = PushService.parseNotificationData(data);

      expect(result.sessionID, 'sess-123');
      expect(result.type, 'message');
      expect(result.title, 'New message');
      expect(result.body, 'Hello world');
    });

    test('parseNotificationData handles missing optional fields', () {
      service = PushService(config: config);

      final data = <String, dynamic>{
        'type': 'goal_update',
      };

      final result = PushService.parseNotificationData(data);

      expect(result.type, 'goal_update');
      expect(result.sessionID, isNull);
      expect(result.title, isNull);
      expect(result.body, isNull);
    });

    test('token refresh triggers re-registration', () async {
      var registerCount = 0;
      final mockClient = http_testing.MockClient((request) async {
        registerCount++;
        return http.Response(jsonEncode({'ok': true}), 200);
      });

      service = PushService(config: config, httpClient: mockClient);

      // Simulate token refresh
      await service.onTokenRefresh('new-fcm-token');

      expect(registerCount, 1);
    });

    test('dispose cleans up resources', () {
      service = PushService(config: config);

      // Should not throw
      service.dispose();

      // Double dispose should be safe
      service.dispose();
    });

    test('constructor accepts optional WsClient and callbacks', () {
      // Verify the expanded constructor compiles and doesn't throw
      service = PushService(
        config: config,
        ws: null,
        onRefreshSessions: () async {},
        onNavigateToSession: (_) {},
      );

      expect(service.currentToken, isNull);
    });

    test('handleNotificationTap returns sessionID for message type', () async {
      service = PushService(config: config);

      final sessionID = await service.handleNotificationTap({
        'type': 'message',
        'sessionID': 'sess-456',
        'title': 'Test',
        'body': 'Hello',
      });

      expect(sessionID, 'sess-456');
    });

    test('handleNotificationTap returns null for non-message type', () async {
      service = PushService(config: config);

      final sessionID = await service.handleNotificationTap({
        'type': 'goal_update',
        'sessionID': 'sess-456',
      });

      expect(sessionID, isNull);
    });

    test('handleNotificationTap returns null when sessionID is missing', () async {
      service = PushService(config: config);

      final sessionID = await service.handleNotificationTap({
        'type': 'message',
      });

      expect(sessionID, isNull);
    });

    test('setCurrentToken updates currentToken', () {
      service = PushService(config: config);

      service.setCurrentToken('test-token-123');

      expect(service.currentToken, 'test-token-123');
    });

    test('FCM data payload caps and excludes full text', () {
      final payload = buildFcmData(
        type: 'message.updated',
        sessionID: 's1',
        title: 'Hi',
        summary: 'first 80',
      );
      expect(payload.containsKey('text'), isFalse);
      expect(payload['summary']!.length <= 80, isTrue);
      expect(payload['title'], 'Hi');
      expect(payload['sessionID'], 's1');
    });

    test('FCM data caps title 12 and summary 80', () {
      final payload = buildFcmData(
        type: 'message.updated',
        sessionID: 's1',
        title: '123456789012345',
        summary: 'x' * 120,
      );
      expect(payload['title']!.length, 12);
      expect(payload['summary']!.length, 80);
      expect(payload.containsKey('text'), isFalse);
    });

    test('currentSessionID tracks foreground ChatPage', () {
      service = PushService(config: config);
      expect(service.currentSessionID, isNull);
      service.currentSessionID = 'sess-active';
      expect(service.currentSessionID, 'sess-active');
      service.currentSessionID = null;
      expect(service.currentSessionID, isNull);
    });

    test('kLastFcmAtKey is stable', () {
      expect(kLastFcmAtKey, 'mafw_last_fcm_at');
    });
  });
}
