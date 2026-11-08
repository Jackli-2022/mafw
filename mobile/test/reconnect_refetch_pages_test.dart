/// Reconnect refetch across open pages (final fix wave, Finding 1).
///
/// The gateway does not replay WS events that were missed while the socket was
/// down, so every page that holds a live view must refetch once per successful
/// re-handshake — not just the work tab:
///
/// - `GoalDetailPage` → timeline / revisions / result (`_load(silent: true)`);
/// - `TechLeadDiscussionPage` → `openTechLead`（成功后替换已显示消息）;
/// - `ChatPage` → session history.
///
/// The signal is injected as a [Listenable] (`ConnectionEvents` in production,
/// a plain `ChangeNotifier` here) so each page subscribes on init and cancels on
/// dispose. Silent means: keep the old rows on screen while the request is in
/// flight, no full-page spinner, no cleared list.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';
import 'package:orcalore_mobile/src/network/ws_client_interface.dart';
import 'package:orcalore_mobile/src/pages/chat_page.dart';
import 'package:orcalore_mobile/src/pages/goal_detail_page.dart';
import 'package:orcalore_mobile/src/pages/tech_lead_discussion_page.dart';
import 'package:orcalore_mobile/src/services/connection_events.dart';
import 'package:orcalore_mobile/src/theme.dart';

const String _goalId = 'g1';
const String _podId = 'pod-1';
const String _sessionId = 'ses_1';

// ── Gateway fixture ─────────────────────────────────────────────────────────

class _Gateway {
  int timelineCalls = 0;
  int techLeadCalls = 0;
  int historyCalls = 0;

  /// When set, timeline / tech-lead / history responses wait for this gate — the
  /// page must keep its old rows while the silent reload is in flight.
  Completer<void>? block;

  List<String> techLeadTexts = const ['旧消息'];
  List<String> historyTexts = const ['早先的消息'];

  final List<String> paths = <String>[];

  late final GatewayClient client = GatewayClient(
    const ConnectionConfig(baseUrl: 'http://127.0.0.1:3000', apiToken: 't'),
    httpClient: http_testing.MockClient(_handle),
  );

  Map<String, dynamic> _message(String id, String text) => {
    'id': id,
    'sessionID': _sessionId,
    'role': 'assistant',
    'content': [
      {'id': '$id-t', 'type': 'text', 'text': text},
    ],
    'time': {'created': 1762400000000},
  };

  Future<void> _waitGate() async {
    final gate = block;
    if (gate != null) await gate.future;
  }

  Future<http.Response> _handle(http.Request request) async {
    final path = '/${request.url.pathSegments.join('/')}';
    paths.add(path);

    if (path == '/api/goals/$_goalId/timeline') {
      timelineCalls++;
      await _waitGate();
      return _json({
        'goal': {
          'goalId': _goalId,
          'title': '修 CI',
          'phase': 'EXECUTING',
          'round': 1,
          'nextNode': 'execute',
          'nextAction': 'RUNNING_execute',
        },
        'nodes': <dynamic>[],
        'artifacts': <dynamic, dynamic>{},
        'outcome': null,
      });
    }
    if (path == '/api/pods/$_podId/goals/$_goalId/revisions') {
      return _json({'items': <dynamic>[]});
    }
    if (path == '/api/pods/$_podId/goals/$_goalId/result') {
      return _json({'error': 'goal result not found'}, 404);
    }
    if (path == '/api/pods/$_podId/goals/$_goalId/tech-lead') {
      techLeadCalls++;
      await _waitGate();
      return _json({
        'goalId': _goalId,
        'revision': 1,
        'sessionID': _sessionId,
        'messages': [
          for (var i = 0; i < techLeadTexts.length; i++)
            _message('tl-$techLeadCalls-$i', techLeadTexts[i]),
        ],
      });
    }
    if (path == '/api/sessions/$_sessionId/messages') {
      historyCalls++;
      await _waitGate();
      return _json({
        'data': [
          for (var i = 0; i < historyTexts.length; i++)
            _message('h-$historyCalls-$i', historyTexts[i]),
        ],
        'nextCursor': null,
      });
    }
    return _json({'error': 'unexpected ${request.method} $path'}, 500);
  }
}

http.Response _json(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

// ── WS stub（ChatPage 需要事件流，本测试不用 WS 事件）───────────────────────

class _FakeWs implements MafwWsClient {
  @override
  Stream<MafwEvent> get events => const Stream<MafwEvent>.empty();

  @override
  Stream<bool> get connectionStatus => const Stream<bool>.empty();

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> reconnect() async {}

  @override
  void disconnect() {}

  @override
  Future<void> send(String message, {String? sessionID}) async {}

  @override
  void dispose() {}
}

// ── Harness ─────────────────────────────────────────────────────────────────

void _sizeView(WidgetTester tester) {
  tester.view.physicalSize = const Size(440, 2000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  group('ConnectionEvents', () {
    test('fires every listener once per successful re-handshake', () {
      final events = ConnectionEvents();
      addTearDown(events.dispose);
      var first = 0;
      var second = 0;
      events.addListener(() => first++);
      events.addListener(() => second++);

      events.onReconnected();
      events.onReconnected();

      expect(first, 2);
      expect(second, 2);
    });
  });

  group('GoalDetailPage', () {
    testWidgets('a reconnect signal silently reloads the timeline', (
      tester,
    ) async {
      final gateway = _Gateway();
      final events = ConnectionEvents();
      addTearDown(events.dispose);
      _sizeView(tester);

      await tester.pumpWidget(
        MaterialApp(
          theme: mafwDarkTheme(),
          home: GoalDetailPage(
            _podId,
            _goalId,
            client: gateway.client,
            reconnect: events,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(gateway.timelineCalls, 1);
      expect(find.text('修 CI'), findsOneWidget);

      // 静默：重连后的请求还在飞时，屏上内容原样保留，不重新进入 loading。
      final gate = Completer<void>();
      gateway.block = gate;
      events.onReconnected();
      await tester.pump();
      expect(find.text('修 CI'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      gate.complete();
      gateway.block = null;
      await tester.pumpAndSettle();

      expect(gateway.timelineCalls, 2);
      expect(find.text('修 CI'), findsOneWidget);
    });

    testWidgets('disposing the page unsubscribes from the signal', (
      tester,
    ) async {
      final gateway = _Gateway();
      final events = ConnectionEvents();
      addTearDown(events.dispose);
      _sizeView(tester);

      await tester.pumpWidget(
        MaterialApp(
          theme: mafwDarkTheme(),
          home: GoalDetailPage(
            _podId,
            _goalId,
            client: gateway.client,
            reconnect: events,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(gateway.timelineCalls, 1);

      await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
      await tester.pumpAndSettle();
      events.onReconnected();
      await tester.pumpAndSettle();

      expect(gateway.timelineCalls, 1);
    });
  });

  group('TechLeadDiscussionPage', () {
    testWidgets(
      'a reconnect signal reloads the discussion and replaces the messages',
      (tester) async {
        final gateway = _Gateway();
        final events = ConnectionEvents();
        addTearDown(events.dispose);
        _sizeView(tester);

        await tester.pumpWidget(
          MaterialApp(
            theme: mafwDarkTheme(),
            home: TechLeadDiscussionPage(
              _podId,
              _goalId,
              client: gateway.client,
              reconnect: events,
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(gateway.techLeadCalls, 1);
        expect(find.text('旧消息'), findsOneWidget);

        // 静默：请求在飞时旧消息仍在屏上，不显示 loading。
        final gate = Completer<void>();
        gateway.block = gate;
        gateway.techLeadTexts = const ['重连后的消息'];
        events.onReconnected();
        await tester.pump();
        expect(find.text('旧消息'), findsOneWidget);
        expect(find.byType(CircularProgressIndicator), findsNothing);

        gate.complete();
        gateway.block = null;
        await tester.pumpAndSettle();

        expect(gateway.techLeadCalls, 2);
        expect(find.text('重连后的消息'), findsOneWidget);
        expect(find.text('旧消息'), findsNothing);
      },
    );
  });

  group('ChatPage', () {
    testWidgets('a reconnect signal refetches the chat history silently', (
      tester,
    ) async {
      final gateway = _Gateway();
      final events = ConnectionEvents();
      addTearDown(events.dispose);
      _sizeView(tester);

      await tester.pumpWidget(
        MaterialApp(
          theme: mafwDarkTheme(),
          home: ChatPage(
            session: MafwSession(id: _sessionId, title: '会话'),
            client: gateway.client,
            ws: _FakeWs(),
            reconnect: events,
            onSpeak: () async {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(gateway.historyCalls, 1);
      expect(find.text('早先的消息'), findsOneWidget);

      final gate = Completer<void>();
      gateway.block = gate;
      gateway.historyTexts = const ['重连后漏掉的回复'];
      events.onReconnected();
      await tester.pump();
      expect(find.text('早先的消息'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      gate.complete();
      gateway.block = null;
      await tester.pumpAndSettle();

      expect(gateway.historyCalls, 2);
      expect(find.text('重连后漏掉的回复'), findsOneWidget);
    });
  });
}
