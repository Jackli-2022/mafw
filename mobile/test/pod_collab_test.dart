/// Orcalore Pod 协作面 client（Task 10）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 10.
///
/// Contract pinned here（字段名实读 gateway 路由，不按草图猜）：
/// - `POST /api/pods/:podId/goals`（`routes/pods.ts:393`）→
///   `{podId, goalId, status, revision, stage, queueReason, sessionID, goal,
///   sessionError?, promptError?}`；`status` 是 **revision** 状态
///   （`discussing`），`goal` 是 `PodGoalView`；`source` 必须显式传
///   （`normalizeGoalSource` 对未知值 400），移动端固定 `'mobile'`。
/// - `GET /api/pods/:podId/goals/:goalId/tech-lead?limit=`（`routes/pod-collaboration.ts:62`）
///   → `{goalId, revision, sessionID, messages, nextCursor?, sessionError?}`；
///   当前 revision 终态时服务端（`pod-tech-lead-service.requireActiveRevision`）
///   答 409，且没有存活讨论会话时 `sessionID:null` + `messages:[]`——
///   两种都是「讨论已归档」，页面要能照实展示而不是报错。
/// - `POST .../tech-lead/messages` body `{text}`；服务端把 text 前拼
///   ContextManifest（返回 `{goalId, revision, sessionID, text}`）。
/// - `POST .../direction-decision`（`routes/pod-collaboration.ts:86`）body
///   `{mode: decided|clear|needs_user, optionId?, userWords?, reason?, revision?}`
///   → `{...PodDirectionResult, planningStarted, planningError?}`；方向决定已落库但
///   规划启动失败时 `planningStarted:false` + `planningError` 必须可见。
/// - `POST /api/goals/:goalId/questions/:questionId/respond`（`index.ts:6340`）
///   body `{answer}` 或 `{type:'cancel'}`；404 = 问题不存在，409 = 非 pending。
/// - `GET /api/pods/:podId/events?state=`（`routes/pod-events.ts`）→
///   `{items: PodEventRow[], unread}`（行内 `refsJson` 是字符串，SDK DTO 不暴露）。
/// - `POST /api/pods/:podId/events/:id/seen` → `{ok, changed}`。
/// - `GET /api/pods/:podId/sessions/:sessionId/transcript`（`routes/pods.ts:507`）→
///   `{transcript: {sessionID, messages} | null}`（`pod-service.snapshotSession` 写盘形状）。
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';

const String _podId = 'pod-1';
const String _goalId = 'g1';
const String _projectDir = r'C:\work\proj';
const String _token = 'test-token';

// ── Fixtures（形状与 gateway 响应逐字对齐）────────────────────────────────────

Map<String, dynamic> _goalViewJson({int revision = 1}) => {
      'id': 'goalrow-1',
      'podId': _podId,
      'goalId': _goalId,
      'title': '修 CI',
      'status': 'active',
      'phase': null,
      'verdict': null,
      'stage': {'owner': 'team', 'kind': 'working'},
      'resultReady': false,
      'activeRevision': revision,
      'revision': revision,
      'priority': 0,
      'enqueuedAt': '2026-11-06T05:00:00.000Z',
      'startedAt': null,
      'endedAt': null,
    };

/// `POST /api/pods/:podId/goals` 的 tech-lead 分支响应。
Map<String, dynamic> _createdGoalJson({
  String? sessionID = 'ses_tech_lead',
  String? sessionError,
}) =>
    {
      'podId': _podId,
      'goalId': _goalId,
      'status': 'discussing',
      'revision': 1,
      'stage': 'discussing',
      'queueReason': null,
      'sessionID': sessionID,
      'goal': _goalViewJson(),
      'sessionError': ?sessionError,
    };

/// Flat MAFW View DTO message（`packages/gateway-sdk/src/view-dto.ts`）。
Map<String, dynamic> _msgJson(String id, String role, String text) => {
      'id': id,
      'sessionID': 'ses_tech_lead',
      'role': role,
      'parentID': null,
      'content': [
        {'id': '$id-t', 'type': 'text', 'text': text},
      ],
      'time': {'created': 1762400000000},
    };

Map<String, dynamic> _techLeadJson({String? sessionID = 'ses_tech_lead'}) => {
      'goalId': _goalId,
      'revision': 2,
      'sessionID': sessionID,
      'messages': [
        _msgJson('m1', 'user', '先看 CI 为什么红'),
        _msgJson('m2', 'assistant', '看了日志，是依赖升级导致的'),
      ],
      'nextCursor': 'cursor-1',
    };

Map<String, dynamic> _directionJson({
  bool planningStarted = true,
  String? planningError,
}) =>
    {
      'podId': _podId,
      'goalId': _goalId,
      'revision': 2,
      'revisionStatus': 'planning',
      'directionStatus': 'decided',
      'state': {'version': 1, 'goalId': _goalId, 'revisions': {}},
      'decision': {
        'id': 'd1',
        'optionId': 'opt-a',
        'userWords': '走 A',
        'reason': null,
        'source': 'user',
        'revision': 2,
        'decidedAt': '2026-11-06T05:00:00.000Z',
        'options': <dynamic>[],
      },
      'artifactPath': r'C:\work\proj\.mafw\goals\g1\direction.json',
      'planningStarted': planningStarted,
      'planningError': ?planningError,
    };

Map<String, dynamic> _eventJson() => {
      'id': 'evt_1',
      'podId': _podId,
      'projectId': _projectDir,
      'goalId': _goalId,
      'revision': 2,
      'kind': 'goal_result',
      'severity': 'p1',
      'reason': 'goal_pass',
      'title': 'Goal 完成',
      'summary': '3 项验收通过',
      'refsJson': '[{"kind":"goal","id":"g1"}]',
      'dedupeKey': 'goal:g1:r2',
      'audience': 'human',
      'state': 'unread',
      'wakeState': 'none',
      'wakeAttempts': 0,
      'wakeAt': null,
      'wakeSessionId': null,
      'createdAt': '2026-11-06T05:00:00.000Z',
      'seenAt': null,
    };

// ── Fake gateway（真 GatewayClient + MockClient：路径/查询/载荷都可断言）──────

/// 一次被拦截的请求（方法、路径、查询参数、JSON 体、Authorization 头）。
class _Call {
  final String method;
  final String path;
  final Map<String, String> query;
  final String body;
  final String? authorization;

  const _Call(this.method, this.path, this.query, this.body, this.authorization);

  Map<String, dynamic> get json => body.isEmpty
      ? const <String, dynamic>{}
      : jsonDecode(body) as Map<String, dynamic>;
}

typedef _Reply = http.Response Function(http.Request request);

class _FakeGateway {
  _FakeGateway();

  final Map<String, _Reply> _routes = <String, _Reply>{};
  final List<_Call> calls = <_Call>[];

  late final GatewayClient client = GatewayClient(
    const ConnectionConfig(baseUrl: 'http://127.0.0.1:3000', apiToken: _token),
    httpClient: http_testing.MockClient(_handle),
  );

  void on(String method, String path, _Reply reply) {
    _routes['$method $path'] = reply;
  }

  Future<http.Response> _handle(http.Request request) async {
    final path = request.url.path;
    calls.add(_Call(
      request.method,
      path,
      request.url.queryParameters,
      request.body,
      request.headers['Authorization'],
    ));
    final reply = _routes['${request.method} $path'];
    if (reply == null) return _json({'error': 'unexpected ${request.method} $path'}, 500);
    return reply(request);
  }
}

http.Response _json(Object body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

void main() {
  group('createGoal', () {
    test('posts source=mobile + title/objective/acceptance and parses the Goal', () async {
      final gateway = _FakeGateway()
        ..on('POST', '/api/pods/$_podId/goals', (_) => _json(_createdGoalJson()));

      final created = await gateway.client.createGoal(
        _podId,
        title: '修 CI',
        objective: '让主干恢复绿',
        acceptance: const ['CI 全绿', '没有新增 flaky'],
      );

      expect(gateway.calls.single.method, 'POST');
      expect(gateway.calls.single.path, '/api/pods/$_podId/goals');
      // Bearer 自动继承（ConnectionConfig.headers）。
      expect(gateway.calls.single.authorization, 'Bearer $_token');
      // 入口来源必须是 mobile（服务端 normalizeGoalSource 白名单）。
      expect(gateway.calls.single.json, {
        'title': '修 CI',
        'objective': '让主干恢复绿',
        'acceptance': ['CI 全绿', '没有新增 flaky'],
        'source': 'mobile',
      });

      expect(created.goalId, _goalId);
      expect(created.revision, 1);
      expect(created.sessionID, 'ses_tech_lead');
      // 顶层 status 是 revision 状态（discussing），不是 PodGoalView 的 active。
      expect(created.status, 'discussing');
      expect(created.stage, 'discussing');
      expect(created.goal, isNotNull);
      expect(created.goal!.goalId, _goalId);
      expect(created.goal!.status, 'active');
      expect(created.sessionError, isNull);
    });

    test('omits empty objective/acceptance instead of sending ""', () async {
      final gateway = _FakeGateway()
        ..on('POST', '/api/pods/$_podId/goals', (_) => _json(_createdGoalJson()));

      await gateway.client.createGoal(_podId, title: '  修 CI  ');

      // title 去首尾空白；空 objective/acceptance 不出现在请求体里。
      expect(gateway.calls.single.json, {'title': '修 CI', 'source': 'mobile'});
    });

    test('a failed Tech Lead session is surfaced, not turned into a creation failure',
        () async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/pods/$_podId/goals',
          (_) => _json(_createdGoalJson(sessionID: null, sessionError: 'serve unavailable')),
        );

      final created = await gateway.client.createGoal(_podId, title: '修 CI', objective: '绿');

      // Goal 建成了（revision 1 discussing），只是讨论会话没起来。
      expect(created.goalId, _goalId);
      expect(created.sessionID, isNull);
      expect(created.sessionError, 'serve unavailable');
    });

    test('non-200 keeps the server status and body', () async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/pods/$_podId/goals',
          (_) => _json({'error': 'objective or charter is required'}, 400),
        );

      await expectLater(
        gateway.client.createGoal(_podId, title: '修 CI'),
        throwsA(isA<GatewayException>()
            .having((e) => e.statusCode, 'statusCode', 400)
            .having((e) => e.errorBody, 'errorBody', contains('objective or charter'))),
      );
    });
  });

  group('openTechLead', () {
    test('reads the discussion history with the default limit of 50', () async {
      final gateway = _FakeGateway()
        ..on(
          'GET',
          '/api/pods/$_podId/goals/$_goalId/tech-lead',
          (_) => _json(_techLeadJson()),
        );

      final history = await gateway.client.openTechLead(_podId, _goalId);

      expect(gateway.calls.single.method, 'GET');
      expect(gateway.calls.single.query, {'limit': '50'});
      expect(history.sessionID, 'ses_tech_lead');
      expect(history.revision, 2);
      expect(history.messages.length, 2);
      expect(history.messages.first.role, 'user');
      expect(history.messages.first.text, '先看 CI 为什么红');
      expect(history.messages.last.role, 'assistant');
      expect(history.messages.last.text, '看了日志，是依赖升级导致的');
      // 消息自身的 sessionID 原样保留（不该被改成空串）。
      expect(history.messages.first.sessionID, 'ses_tech_lead');
      expect(history.sessionError, isNull);
      expect(history.archived, isFalse);
    });

    test('a custom limit is forwarded', () async {
      final gateway = _FakeGateway()
        ..on(
          'GET',
          '/api/pods/$_podId/goals/$_goalId/tech-lead',
          (_) => _json(_techLeadJson()),
        );

      await gateway.client.openTechLead(_podId, _goalId, limit: 20);

      expect(gateway.calls.single.query, {'limit': '20'});
    });

    test('409 (terminal revision) becomes an archived history, never an error', () async {
      final gateway = _FakeGateway()
        ..on(
          'GET',
          '/api/pods/$_podId/goals/$_goalId/tech-lead',
          (_) => _json({'error': 'revision 2 is terminal (completed)'}, 409),
        );

      final history = await gateway.client.openTechLead(_podId, _goalId);

      expect(history.sessionID, isNull);
      expect(history.messages, isEmpty);
      // 409 没有 revision 载荷 → 不猜。
      expect(history.revision, isNull);
      expect(history.archived, isTrue);
    });

    test('an empty lease (200 with sessionID:null) is an empty history', () async {
      final gateway = _FakeGateway()
        ..on(
          'GET',
          '/api/pods/$_podId/goals/$_goalId/tech-lead',
          (_) => _json({
            'goalId': _goalId,
            'revision': 1,
            'sessionID': null,
            'messages': <dynamic>[],
          }),
        );

      final history = await gateway.client.openTechLead(_podId, _goalId);

      expect(history.sessionID, isNull);
      expect(history.messages, isEmpty);
      expect(history.revision, 1);
      expect(history.archived, isTrue);
    });

    test('non-409 failures still throw (503 = discussion unavailable)', () async {
      final gateway = _FakeGateway()
        ..on(
          'GET',
          '/api/pods/$_podId/goals/$_goalId/tech-lead',
          (_) => _json({'error': 'tech lead discussion unavailable'}, 503),
        );

      await expectLater(
        gateway.client.openTechLead(_podId, _goalId),
        throwsA(isA<GatewayException>()
            .having((e) => e.statusCode, 'statusCode', 503)
            .having((e) => e.errorBody, 'errorBody', contains('tech lead discussion'))),
      );
    });
  });

  group('sendTechLeadMessage', () {
    test('posts the text to tech-lead/messages', () async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/pods/$_podId/goals/$_goalId/tech-lead/messages',
          (_) => _json({
            'goalId': _goalId,
            'revision': 2,
            'sessionID': 'ses_tech_lead',
            'text': '[CONTEXT MANIFEST]\n\n我倾向方案 A',
          }),
        );

      await gateway.client.sendTechLeadMessage(_podId, _goalId, '我倾向方案 A');

      expect(gateway.calls.single.method, 'POST');
      expect(
        gateway.calls.single.path,
        '/api/pods/$_podId/goals/$_goalId/tech-lead/messages',
      );
      expect(gateway.calls.single.json, {'text': '我倾向方案 A'});
    });

    test('empty text is rejected by the server and surfaced verbatim', () async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/pods/$_podId/goals/$_goalId/tech-lead/messages',
          (_) => _json({'error': 'text is required'}, 400),
        );

      await expectLater(
        gateway.client.sendTechLeadMessage(_podId, _goalId, '   '),
        throwsA(isA<GatewayException>()
            .having((e) => e.statusCode, 'statusCode', 400)
            .having((e) => e.errorBody, 'errorBody', contains('text is required'))),
      );
    });
  });

  group('directionDecision', () {
    test('decided posts mode + optionId + userWords + revision and reports planningStarted',
        () async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/pods/$_podId/goals/$_goalId/direction-decision',
          (_) => _json(_directionJson()),
        );

      final result = await gateway.client.directionDecision(
        _podId,
        _goalId,
        mode: 'decided',
        optionId: 'opt-a',
        userWords: '走 A',
        revision: 2,
      );

      expect(gateway.calls.single.path, '/api/pods/$_podId/goals/$_goalId/direction-decision');
      expect(gateway.calls.single.json, {
        'mode': 'decided',
        'optionId': 'opt-a',
        'userWords': '走 A',
        'revision': 2,
      });
      expect(result.revision, 2);
      expect(result.revisionStatus, 'planning');
      expect(result.directionStatus, 'decided');
      expect(result.planningStarted, isTrue);
      expect(result.planningError, isNull);
    });

    test('a decision whose planning did not start stays honest', () async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/pods/$_podId/goals/$_goalId/direction-decision',
          (_) => _json(_directionJson(planningStarted: false, planningError: 'goal state missing')),
        );

      final result = await gateway.client.directionDecision(
        _podId,
        _goalId,
        mode: 'clear',
        userWords: '走 B',
        reason: '   ',
      );

      // 空 optionId/reason 不出现在请求体（服务端把 '' 当字段存在）。
      expect(gateway.calls.single.json, {'mode': 'clear', 'userWords': '走 B'});
      expect(result.planningStarted, isFalse);
      expect(result.planningError, 'goal state missing');
    });
  });

  group('answerQuestion', () {
    test('answers with {answer}', () async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/goals/$_goalId/questions/q1/respond',
          (_) => _json({'status': 'accepted'}),
        );

      await gateway.client.answerQuestion(_goalId, 'q1', answer: '走方案 A');

      expect(gateway.calls.single.method, 'POST');
      expect(gateway.calls.single.path, '/api/goals/$_goalId/questions/q1/respond');
      expect(gateway.calls.single.json, {'answer': '走方案 A'});
    });

    test('cancel posts {type:cancel} and a non-pending question surfaces 409', () async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/goals/$_goalId/questions/q1/respond',
          (_) => _json({'status': 'conflict', 'currentState': 'answered'}, 409),
        );

      await expectLater(
        gateway.client.answerQuestion(_goalId, 'q1', cancel: true),
        throwsA(isA<GatewayException>()
            .having((e) => e.statusCode, 'statusCode', 409)
            .having((e) => e.errorBody, 'errorBody', contains('answered'))),
      );
      expect(gateway.calls.single.json, {'type': 'cancel'});
    });
  });

  group('podEvents', () {
    test('defaults to unread and parses the event rows', () async {
      final gateway = _FakeGateway()
        ..on(
          'GET',
          '/api/pods/$_podId/events',
          (_) => _json({
            'items': [_eventJson()],
            'unread': 3,
          }),
        );

      final events = await gateway.client.podEvents(_podId);

      expect(gateway.calls.single.method, 'GET');
      expect(gateway.calls.single.query, {'state': 'unread'});
      expect(gateway.calls.single.authorization, 'Bearer $_token');
      final event = events.single;
      expect(event.id, 'evt_1');
      expect(event.podId, _podId);
      expect(event.projectId, _projectDir);
      expect(event.goalId, _goalId);
      expect(event.revision, 2);
      expect(event.kind, 'goal_result');
      expect(event.severity, 'p1');
      expect(event.reason, 'goal_pass');
      expect(event.title, 'Goal 完成');
      expect(event.summary, '3 项验收通过');
      expect(event.audience, 'human');
      expect(event.state, 'unread');
      expect(event.createdAt, '2026-11-06T05:00:00.000Z');
      expect(event.seenAt, isNull);
    });

    test('state is passed through verbatim (all = no filter on the gateway)', () async {
      final gateway = _FakeGateway()
        ..on(
          'GET',
          '/api/pods/$_podId/events',
          (_) => _json({'items': <dynamic>[], 'unread': 0}),
        );

      final events = await gateway.client.podEvents(_podId, state: 'all');

      expect(gateway.calls.single.query, {'state': 'all'});
      expect(events, isEmpty);
    });

    test('markPodEventSeen posts to the per-event seen route', () async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/pods/$_podId/events/evt_1/seen',
          (_) => _json({'ok': true, 'changed': true}),
        );

      await gateway.client.markPodEventSeen(_podId, 'evt_1');

      expect(gateway.calls.single.method, 'POST');
      expect(gateway.calls.single.path, '/api/pods/$_podId/events/evt_1/seen');
    });
  });

  group('podTranscript', () {
    test('parses the archived snapshot messages', () async {
      final gateway = _FakeGateway()
        ..on(
          'GET',
          '/api/pods/$_podId/sessions/ses_archived/transcript',
          (_) => _json({
            'transcript': {
              'sessionID': 'ses_archived',
              'messages': [_msgJson('m1', 'user', '历史消息')],
            },
          }),
        );

      final messages = await gateway.client.podTranscript(_podId, 'ses_archived');

      expect(
        gateway.calls.single.path,
        '/api/pods/$_podId/sessions/ses_archived/transcript',
      );
      expect(messages.single.text, '历史消息');
      expect(messages.single.role, 'user');
    });

    test('a missing snapshot (transcript:null) is an empty list, not an error', () async {
      final gateway = _FakeGateway()
        ..on(
          'GET',
          '/api/pods/$_podId/sessions/ses_archived/transcript',
          (_) => _json({'transcript': null}),
        );

      expect(await gateway.client.podTranscript(_podId, 'ses_archived'), isEmpty);
    });
  });
}
