/// Orcalore Tech Lead 讨论页（Task 12）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.6 —— 进入 Goal 详情「与 Tech Lead 讨论」→ 讨论页；终态回落只读 transcript。
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 12.
///
/// Contract pinned here（实读 gateway 路由，不按草图猜）：
/// - 打开：`GET /api/pods/:podId/goals/:goalId/tech-lead?limit=50` →
///   `{goalId, revision, sessionID, messages}`（flat `MafwMessage[]`，与 chat 同构）；
/// - 有活跃租约（`sessionID != null`）：渲染历史 + **text-only composer**
///   （Tech Lead 身份 allowlist 无 `mafw_media_*`，发图=无人能解的指针）；
/// - 发送只走 `POST .../tech-lead/messages {text}`，**绝不** `POST /api/chat/enriched`
///   （负断言：请求路径集合里不存在 enriched）；
/// - 终态（409 `revision N is terminal` / 200 `sessionID:null`）→「讨论已归档」
///   横幅 + 只读 transcript：会话 id 从 `GET /api/pods/:podId` 的 `sessions[]`
///   里按 `goalId + scopeKind:'discussion'` 选取（桌面同一路径），再读
///   `GET /api/pods/:podId/sessions/:sessionId/transcript`；无快照要照实说；
/// - WS canonical 事件（注入 `messagesStream`）驱动 Perplexity 式阶段
///   （searching→writing→done，复用 `event_effects` 词表）与历史刷新。
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/models/pod_models.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';
import 'package:orcalore_mobile/src/pages/tech_lead_discussion_page.dart';
import 'package:orcalore_mobile/src/theme.dart';

const String _podId = 'pod-1';
const String _goalId = 'g1';
const String _sessionId = 'ses_tl';
const String _token = 'test-token';

// ── Fixtures（形状与 gateway 响应逐字对齐）────────────────────────────────────

/// Flat MAFW View DTO message（`packages/gateway-sdk/src/view-dto.ts`）。
Map<String, dynamic> _msgJson(String id, String role, String text) => {
      'id': id,
      'sessionID': _sessionId,
      'role': role,
      'parentID': null,
      'content': [
        {'id': '$id-t', 'type': 'text', 'text': text},
      ],
      'time': {'created': 1762400000000},
    };

Map<String, dynamic> _techLeadJson({
  String? sessionID = _sessionId,
  List<Map<String, dynamic>>? messages,
  int revision = 1,
}) =>
    {
      'goalId': _goalId,
      'revision': revision,
      'sessionID': sessionID,
      'messages': messages ??
          [
            _msgJson('m1', 'user', '先看 CI 为什么红'),
            _msgJson('m2', 'assistant', '看了日志，是依赖升级导致的'),
          ],
    };

/// `pod_member_sessions` 行（`PodSessionRow`，`gateway/src/core/pod/pod-store.ts`）。
Map<String, dynamic> _sessionRow(
  String sessionId, {
  String goalId = _goalId,
  String? node,
  String? scopeKind = 'discussion',
  int revision = 1,
  int generation = 1,
  String? endedAt = '2026-11-06T06:00:00.000Z',
}) =>
    {
      'id': 'ps-$sessionId',
      'podId': _podId,
      'memberId': 'm-tech-lead',
      'goalId': goalId,
      'node': node,
      'sessionId': sessionId,
      'status': endedAt == null ? 'active' : 'ended',
      'transcriptRef': null,
      'scopeKind': scopeKind,
      'revision': revision,
      'generation': generation,
      'lastActiveAt': '2026-11-06T05:00:00.000Z',
      'createdAt': '2026-11-06T05:00:00.000Z',
      'endedAt': endedAt,
    };

/// `GET /api/pods/:podId` 的 detail 信封（只有 sessions 与本任务相关）。
Map<String, dynamic> _podDetailJson({List<Map<String, dynamic>>? sessions}) => {
      'pod': {
        'id': _podId,
        'projectDir': r'C:\work\proj',
        'name': 'proj',
        'status': 'active',
        'activeGoalId': null,
      },
      'members': <dynamic>[],
      'goals': <dynamic>[],
      'tasks': <dynamic>[],
      'sessions': sessions ?? <Map<String, dynamic>>[],
      'attention': <dynamic>[],
      'messageHealth': <dynamic>[],
    };

Map<String, dynamic> _transcriptJson(String sessionId, List<Map<String, dynamic>> messages) => {
      'transcript': {'sessionID': sessionId, 'messages': messages},
    };

// ── Fake gateway（真 GatewayClient + MockClient：路径/载荷都可断言）────────────

class _Call {
  final String method;
  final String path;
  final Map<String, String> query;
  final String body;

  const _Call(this.method, this.path, this.query, this.body);

  Map<String, dynamic> get json => body.isEmpty
      ? const <String, dynamic>{}
      : jsonDecode(body) as Map<String, dynamic>;
}

typedef _Reply = http.Response Function(http.Request request);

class _FakeGateway {
  final Map<String, _Reply> _routes = <String, _Reply>{};
  final List<_Call> calls = <_Call>[];

  late final GatewayClient client = GatewayClient(
    const ConnectionConfig(baseUrl: 'http://127.0.0.1:3000', apiToken: _token),
    httpClient: http_testing.MockClient(_handle),
  );

  void on(String method, String path, _Reply reply) {
    _routes['$method $path'] = reply;
  }

  Iterable<String> get postedPaths =>
      calls.where((c) => c.method == 'POST').map((c) => c.path);

  int get historyCalls =>
      calls.where((c) => c.path == '/api/pods/$_podId/goals/$_goalId/tech-lead').length;

  Future<http.Response> _handle(http.Request request) async {
    final path = '/${request.url.pathSegments.join('/')}';
    calls.add(_Call(request.method, path, request.url.queryParameters, request.body));
    final reply = _routes['${request.method} $path'];
    if (reply == null) {
      return _json({'error': 'unexpected ${request.method} $path'}, 500);
    }
    return reply(request);
  }
}

http.Response _json(Object body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

// ── Harness ─────────────────────────────────────────────────────────────────

void _sizeView(WidgetTester tester) {
  tester.view.physicalSize = const Size(430, 1600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpPage(
  WidgetTester tester,
  _FakeGateway gateway, {
  Stream<MafwEvent>? messagesStream,
  bool withoutClient = false,
}) async {
  _sizeView(tester);
  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: TechLeadDiscussionPage(
      _podId,
      _goalId,
      client: withoutClient ? null : gateway.client,
      messagesStream: messagesStream,
    ),
  ));
  await tester.pumpAndSettle();
}

MafwEvent _event(String type, {String? sessionID = _sessionId}) => MafwEvent.fromJson({
      'type': 'mafw_event',
      'data': {
        'type': type,
        'sessionID': ?sessionID,
      },
    });

void main() {
  group('archivedDiscussionSessionId', () {
    test('picks the newest discussion session for the goal', () {
      final sessions = [
        PodSessionInfo.fromJson(_sessionRow('ses-r1', revision: 1, generation: 1)),
        PodSessionInfo.fromJson(_sessionRow('ses-r1-g3', revision: 1, generation: 3)),
        PodSessionInfo.fromJson(_sessionRow('ses-other', goalId: 'g2', revision: 9)),
      ];

      expect(archivedDiscussionSessionId(sessions, _goalId), 'ses-r1-g3');
    });

    test('higher revision wins before generation', () {
      final sessions = [
        PodSessionInfo.fromJson(_sessionRow('ses-r1-g9', revision: 1, generation: 9)),
        PodSessionInfo.fromJson(_sessionRow('ses-r2-g1', revision: 2, generation: 1)),
      ];

      expect(archivedDiscussionSessionId(sessions, _goalId), 'ses-r2-g1');
    });

    test('node sessions and non-discussion scopes are never used', () {
      final sessions = [
        PodSessionInfo.fromJson(_sessionRow('ses-exec', node: 'execute', scopeKind: null)),
        PodSessionInfo.fromJson(_sessionRow('ses-probe', node: 'probe', scopeKind: null)),
      ];

      expect(archivedDiscussionSessionId(sessions, _goalId), isNull);
    });
  });

  group('history + composer', () {
    testWidgets('renders the Tech Lead history with a text-only composer', (tester) async {
      final gateway = _FakeGateway()
        ..on('GET', '/api/pods/$_podId/goals/$_goalId/tech-lead',
            (_) => _json(_techLeadJson()));

      await _pumpPage(tester, gateway);

      expect(gateway.calls.single.path, '/api/pods/$_podId/goals/$_goalId/tech-lead');
      expect(gateway.calls.single.query, {'limit': '50'});
      expect(find.text('先看 CI 为什么红'), findsOneWidget);
      expect(find.text('看了日志，是依赖升级导致的'), findsOneWidget);

      // composer 存在且是 text-only（无附件、无语音按钮）。
      expect(find.byKey(const Key('tech-lead-input')), findsOneWidget);
      expect(find.byKey(const Key('tech-lead-send')), findsOneWidget);
      expect(find.byIcon(Icons.attach_file), findsNothing);
      expect(find.byIcon(Icons.mic), findsNothing);
      // 活跃讨论不该出现归档横幅。
      expect(find.byKey(const Key('tech-lead-archived-banner')), findsNothing);
    });

    testWidgets('sending goes to the tech-lead channel and never to chat/enriched', (tester) async {
      final gateway = _FakeGateway()
        ..on('GET', '/api/pods/$_podId/goals/$_goalId/tech-lead',
            (_) => _json(_techLeadJson()))
        ..on(
          'POST',
          '/api/pods/$_podId/goals/$_goalId/tech-lead/messages',
          (_) => _json({
            'goalId': _goalId,
            'revision': 1,
            'sessionID': _sessionId,
            'text': '我倾向方案 A',
          }),
        );

      await _pumpPage(tester, gateway);

      await tester.enterText(find.byKey(const Key('tech-lead-input')), '我倾向方案 A');
      await tester.tap(find.byKey(const Key('tech-lead-send')));
      await tester.pump();
      await tester.pump();

      // 发送经 SendRouter：只命中 tech-lead/messages。
      expect(gateway.postedPaths, [
        '/api/pods/$_podId/goals/$_goalId/tech-lead/messages',
      ]);
      final post = gateway.calls.last;
      expect(post.json, {'text': '我倾向方案 A'});
      // 负断言：enriched / promptAsync 路径从未被调用。
      expect(gateway.calls.any((c) => c.path == '/api/chat/enriched'), isFalse);

      // 乐观追加的用户消息在屏上（不需要等 WS 回灌）。
      expect(find.text('我倾向方案 A'), findsWidgets);
      // 发送后进入 searching 阶段（Perplexity 式）。
      expect(find.text('正在处理…'), findsOneWidget);
    });

    testWidgets('WS canonical events drive the phase indicator and refresh history',
        (tester) async {
      final gateway = _FakeGateway()
        ..on('GET', '/api/pods/$_podId/goals/$_goalId/tech-lead',
            (_) => _json(_techLeadJson()))
        ..on(
          'POST',
          '/api/pods/$_podId/goals/$_goalId/tech-lead/messages',
          (_) => _json({'goalId': _goalId, 'sessionID': _sessionId}),
        );
      final controller = StreamController<MafwEvent>.broadcast();
      addTearDown(controller.close);

      await _pumpPage(tester, gateway, messagesStream: controller.stream);

      await tester.enterText(find.byKey(const Key('tech-lead-input')), '继续');
      await tester.tap(find.byKey(const Key('tech-lead-send')));
      await tester.pump();
      await tester.pump();

      controller.add(_event('part.delta'));
      await tester.pump();
      expect(find.text('正在生成…'), findsOneWidget);

      final before = gateway.historyCalls;
      controller.add(_event('turn.completed'));
      await tester.pump();
      expect(find.text('正在生成…'), findsNothing);
      expect(find.text('正在处理…'), findsNothing);

      // 回合结束触发防抖刷新（`event_effects.refresh`）。
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump();
      expect(gateway.historyCalls, before + 1);

      // 其他会话的事件不影响本页阶段。
      controller.add(_event('part.delta', sessionID: 'ses-other'));
      await tester.pump();
      expect(find.text('正在生成…'), findsNothing);
    });
  });

  group('terminal revision → archived transcript', () {
    testWidgets('a 409 shows the archived banner and a read-only transcript', (tester) async {
      final gateway = _FakeGateway()
        ..on(
          'GET',
          '/api/pods/$_podId/goals/$_goalId/tech-lead',
          (_) => _json({'error': 'revision 1 is terminal (completed)'}, 409),
        )
        ..on(
          'GET',
          '/api/pods/$_podId',
          (_) => _json(_podDetailJson(sessions: [
                _sessionRow('ses-old', revision: 1, generation: 1),
                _sessionRow('ses-new', revision: 1, generation: 2),
                _sessionRow('ses-other-goal', goalId: 'g2', revision: 5),
                _sessionRow('ses-node', node: 'execute', scopeKind: null),
              ])),
        )
        ..on(
          'GET',
          '/api/pods/$_podId/sessions/ses-new/transcript',
          (_) => _json(_transcriptJson('ses-new', [
                _msgJson('a1', 'user', '归档前提问'),
                _msgJson('a2', 'assistant', '归档里的结论：走方案 A'),
              ])),
        );

      await _pumpPage(tester, gateway);

      expect(find.byKey(const Key('tech-lead-archived-banner')), findsOneWidget);
      expect(find.text('讨论已归档'), findsOneWidget);
      expect(find.text('归档前提问'), findsOneWidget);
      expect(find.text('归档里的结论：走方案 A'), findsOneWidget);

      // 只读：没有 composer、没有发送按钮。
      expect(find.byType(TextField), findsNothing);
      expect(find.byKey(const Key('tech-lead-send')), findsNothing);

      // 选中的是当前 Goal 的最新 discussion 会话；别人的会话/节点会话不读。
      expect(
        gateway.calls.map((c) => c.path),
        contains('/api/pods/$_podId/sessions/ses-new/transcript'),
      );
      expect(gateway.calls.any((c) => c.path.contains('ses-other-goal')), isFalse);
      expect(gateway.calls.any((c) => c.path.contains('ses-node')), isFalse);
    });

    testWidgets('a 200 with sessionID:null is the same archived branch', (tester) async {
      final gateway = _FakeGateway()
        ..on(
          'GET',
          '/api/pods/$_podId/goals/$_goalId/tech-lead',
          (_) => _json(_techLeadJson(sessionID: null, messages: const [])),
        )
        ..on(
          'GET',
          '/api/pods/$_podId',
          (_) => _json(_podDetailJson(sessions: [_sessionRow('ses-archived')])),
        )
        ..on(
          'GET',
          '/api/pods/$_podId/sessions/ses-archived/transcript',
          (_) => _json(_transcriptJson('ses-archived', [
                _msgJson('b1', 'assistant', '上一版的讨论要点'),
              ])),
        );

      await _pumpPage(tester, gateway);

      expect(find.text('讨论已归档'), findsOneWidget);
      expect(find.text('上一版的讨论要点'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('a missing snapshot is stated honestly instead of faked', (tester) async {
      final gateway = _FakeGateway()
        ..on(
          'GET',
          '/api/pods/$_podId/goals/$_goalId/tech-lead',
          (_) => _json({'error': 'revision 1 is terminal (completed)'}, 409),
        )
        ..on('GET', '/api/pods/$_podId', (_) => _json(_podDetailJson()))
        ..on(
          'GET',
          '/api/pods/$_podId/sessions/ses-archived/transcript',
          (_) => _json({'transcript': null}),
        );

      await _pumpPage(tester, gateway);

      expect(find.text('讨论已归档'), findsOneWidget);
      expect(find.byKey(const Key('tech-lead-transcript-note')), findsOneWidget);
      expect(find.textContaining('没有可读取的讨论记录'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
    });
  });

  group('loading + failure', () {
    testWidgets('a non-409 failure shows the server message with a retry', (tester) async {
      var attempts = 0;
      final gateway = _FakeGateway()
        ..on('GET', '/api/pods/$_podId/goals/$_goalId/tech-lead', (_) {
          attempts++;
          return _json({'error': 'tech lead discussion unavailable'}, 503);
        });

      await _pumpPage(tester, gateway);

      expect(find.text('无法打开 Tech Lead 讨论'), findsOneWidget);
      expect(find.textContaining('tech lead discussion unavailable'), findsOneWidget);
      expect(find.byKey(const Key('tech-lead-retry')), findsOneWidget);
      expect(find.byKey(const Key('tech-lead-input')), findsNothing);

      await tester.tap(find.byKey(const Key('tech-lead-retry')));
      await tester.pump();
      await tester.pump();
      expect(attempts, 2);
    });

    testWidgets('a missing gateway client is honest, not a crash', (tester) async {
      final gateway = _FakeGateway();

      await _pumpPage(tester, gateway, withoutClient: true);

      expect(find.text('无法打开 Tech Lead 讨论'), findsOneWidget);
      expect(find.textContaining('未配置 Gateway'), findsOneWidget);
      expect(gateway.calls, isEmpty);
    });
  });
}
