/// Orcalore 方向裁定面板 + 问答卡（「需要你」形态二/三，Task 13）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.3/§7.4；Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 13.
///
/// Contract pinned here（字段名实读 gateway 路由，不按草图猜）：
/// - 方向裁定 = `POST /api/pods/:podId/goals/:goalId/direction-decision`
///   （`gateway/src/routes/pod-collaboration.ts:86`）：
///   `{mode: decided|clear|needs_user, optionId?, userWords?, reason?, revision?}`。
///   本 UI 只发 `decided`（needs_user 需要 options，移动端不做）；至少要有候选
///   或用户原话，空提交本地拦下。
/// - 候选方向来自 revision 行的 `direction_json` 镜像（`DirectionState.options`；
///   与桌面 `GoalDetailOverlay` 同一来源 —— gateway 没有独立的 GET 方向路由）。
/// - 问答 = `POST /api/goals/:goalId/questions/:questionId/respond`
///   （`gateway/src/index.ts:6340`）：`{answer}` 或 `{type:'cancel'}`；空回答
///   本地拦下（Task 10 报告：空 answer 会真的发 `{answer:''}`）。
/// - 问题文本来源 = `GET /api/approvals`（`{approvals:[{id,goalId,question,
///   status}]}`；与桌面 `GoalDetailOverlay` 的 `approvals.list` 同源）。
/// - 完成动作后 best-effort seen 回写：`GET /api/pods/:podId/events` 里按
///   goalId+revision（可选 kind）找条目 → `POST .../events/:id/seen`；
///   找不到/失败静默（不阻塞主流程，角标等下一次 presence 刷新）。
/// - attention 区是**组合**：内置卡（plan_approval → PlanApprovalCard、
///   direction_review → DirectionPanel、question → QuestionCard）与外部
///   `attentionSlot` 输出同时渲染；都没有才整块隐藏。
/// - 调色板纪律：mint 只用于「需要你」框、选用态描边与 CTA；内容全部中性。
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/pod_models.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';
import 'package:orcalore_mobile/src/pages/goal_detail_page.dart';
import 'package:orcalore_mobile/src/theme.dart';
import 'package:orcalore_mobile/src/widgets/direction_panel.dart';
import 'package:orcalore_mobile/src/widgets/question_card.dart';

const String _podId = 'pod-1';
const String _goalId = 'g1';
const int _revisionNumber = 2;
const String _token = 'test-token';

// ── Fixtures（形状与 gateway 路由文件逐字对齐）────────────────────────────────

Map<String, dynamic> _optionJson(
  String id,
  String title, {
  String? summary,
  List<String> risks = const <String>[],
}) {
  return {
    'id': id,
    'title': title,
    'summary': summary,
    'risks': risks,
  };
}

/// revision 行 `direction_json` 的镜像（`DirectionState`，`direction-decision.ts`）。
String _directionJson({
  String status = 'pending',
  String? reason = '两条链路只能先修一条',
  List<Map<String, dynamic>>? options,
}) {
  final resolved = options ??
      [
        _optionJson(
          'opt-a',
          '先修登录链路',
          summary: '影响所有用户的入口',
          risks: ['改动面大'],
        ),
        _optionJson('opt-b', '先修导出链路'),
      ];
  return jsonEncode({
    'version': 1,
    'goalId': _goalId,
    'revision': _revisionNumber,
    'status': status,
    'options': resolved,
    'requests': reason == null
        ? <dynamic>[]
        : [
            {
              'id': 'dirreq_1',
              'options': resolved,
              'reason': reason,
              'requestedAt': '2026-11-06T05:00:00.000Z',
              'requestedBy': 'tech_lead',
              'revision': _revisionNumber,
            },
          ],
    'decisions': <dynamic>[],
    'updatedAt': '2026-11-06T05:00:00.000Z',
  });
}

Map<String, dynamic> _goalViewJson({
  String stageKind = 'direction_review',
  int revision = _revisionNumber,
  String status = 'active',
  Map<String, dynamic>? pendingQuestion,
  String? stageQuestionId,
}) {
  return {
    'goalId': _goalId,
    'title': '修 CI',
    'status': status,
    'bucket': 'needs_you',
    'revision': revision,
    'activeRevision': revision,
    'verdict': null,
    'resultReady': false,
    'strategy': 'collaborative',
    'stage': {
      'owner': 'person',
      'kind': stageKind,
      if (stageQuestionId != null)
        'action': {'type': 'open_question', 'questionId': stageQuestionId},
    },
    'pendingQuestion': ?pendingQuestion,
  };
}

Map<String, dynamic> _revisionJson({
  String status = 'direction_review',
  String? directionJson,
  int revision = _revisionNumber,
}) {
  return {
    'id': 'rev-$revision',
    'podId': _podId,
    'goalId': _goalId,
    'revision': revision,
    'status': status,
    'verdict': null,
    'directionStatus': directionJson == null ? 'none' : 'pending',
    'directionJson': directionJson,
    'planHash': null,
    'evalHash': null,
    'feedback': null,
    'priority': 0,
    'enqueuedAt': '2026-11-06T04:00:00.000Z',
    'startedAt': '2026-11-06T04:00:00.000Z',
    'endedAt': null,
  };
}

Map<String, dynamic> _timelineJson() {
  return {
    'goal': {
      'goalId': _goalId,
      'title': '修 CI',
      'phase': 'DISCUSSING',
      'round': 1,
      'maxRounds': 3,
      'verdict': null,
      'nextNode': 'plan',
      'nextAction': 'NEXT_plan',
      'lastError': null,
      'updatedAt': '2026-11-06T05:00:00.000Z',
      'planReview': 'manual',
      'planApproval': null,
    },
    'nodes': <dynamic>[],
    'artifacts': {'wavesPath': null, 'receipts': <String>[], 'reviewsDir': null},
    'outcome': null,
  };
}

/// `GET /api/goals/:id/plan` 的最小可审批载荷（Task 9 组合回归用）。
Map<String, dynamic> _planJson() {
  return {
    'planReview': 'manual',
    'planApproval': {'id': 'appr-1', 'status': 'pending'},
    'planFeedback': null,
    'round': 1,
    'revision': _revisionNumber,
    'waves': {
      'status': 'ready',
      'strategy': 'collaborative',
      'waves': [
        {
          'id': 'w1',
          'title': '地基',
          'tasks': ['跑通登录'],
        },
      ],
    },
    'wavesPath': null,
    'goalEval': {
      'outcome': '登录链路恢复',
      'conditions': [
        {
          'id': 'g1',
          'statement': '登录接口 200',
          'required': true,
          'evidence': 'curl 输出',
          'method': '命令',
        },
      ],
    },
    'goalEvalPath': null,
    'goalEvalError': null,
    'planHash': 'ph-1',
    'evalHash': 'eh-1',
    'stale': false,
  };
}

Map<String, dynamic> _eventJson({
  String id = 'evt_1',
  String goalId = _goalId,
  int? revision = _revisionNumber,
  String kind = 'goal.result',
}) {
  return {
    'id': id,
    'podId': _podId,
    'projectId': r'C:\work\proj',
    'goalId': goalId,
    'revision': revision,
    'kind': kind,
    'severity': 'p1',
    'reason': 'result',
    'title': '修 CI · PASS',
    'summary': null,
    'audience': 'human',
    'state': 'unread',
    'createdAt': '2026-11-06T05:00:00.000Z',
    'seenAt': null,
  };
}

Map<String, dynamic> _approvalsJson() {
  return {
    'approvals': [
      {
        'id': 'q1',
        'goalId': _goalId,
        'question': '你希望先修哪条链路？',
        'status': 'pending',
        'createdAt': '2026-11-06T05:00:00.000Z',
      },
      {
        'id': 'q_other',
        'goalId': 'other-goal',
        'question': '别的目标的问题',
        'status': 'pending',
      },
      {
        'id': 'q_done',
        'goalId': _goalId,
        'question': '已经回答过的问题',
        'status': 'answered',
      },
      {
        // 没有 goalId 的历史问题不能冒充本 Goal 的问题（桌面 approvals
        // 过滤同样是严格 goalId 匹配）。
        'id': 'q_nogoal',
        'question': '不知道属于哪个目标的问题',
        'status': 'pending',
      },
    ],
  };
}

// ── Fake gateway（真 GatewayClient + MockClient：路径/载荷都可断言）──────────

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

  Future<void> installGoalDetailRoutes({
    Map<String, dynamic>? goalView,
    String? directionJson,
    Map<String, dynamic>? planJson,
    Map<String, dynamic>? approvalsJson,
    List<Map<String, dynamic>>? events,
  }) async {
    on('GET', '/api/goals/$_goalId/timeline', (_) => _json(_timelineJson()));
    on('GET', '/api/pods/$_podId/goals/$_goalId/revisions', (_) => _json({
          'items': [
            _revisionJson(
              status: (goalView?['stage']?['kind'] == 'direction_review')
                  ? 'direction_review'
                  : 'plan_review',
              directionJson: directionJson,
            ),
          ],
        }));
    on('GET', '/api/pods/$_podId/goals/$_goalId/result',
        (_) => _json({'error': 'goal result not found'}, 404));
    on('GET', '/api/goals/$_goalId/plan', (_) => _json(planJson ?? _planJson()));
    on('GET', '/api/approvals', (_) => _json(approvalsJson ?? _approvalsJson()));
    on('GET', '/api/pods/$_podId/events',
        (_) => _json({'items': events ?? <dynamic>[], 'unread': 0}));
    on('POST', '/api/pods/$_podId/events/evt_1/seen',
        (_) => _json({'ok': true, 'changed': true}));
    on('POST', '/api/pods/$_podId/goals/$_goalId/direction-decision',
        (_) => _json(_directionResultJson()));
    on('POST', '/api/goals/$_goalId/questions/q1/respond',
        (_) => _json({'status': 'accepted'}));
    on('POST', '/api/goals/$_goalId/questions/q_driver_1/respond',
        (_) => _json({'status': 'accepted'}));
    on('POST', '/api/goals/$_goalId/questions/q_driver_2/respond',
        (_) => _json({'status': 'accepted'}));
    on('POST', '/api/goals/$_goalId/plan-approval',
        (_) => _json({'success': true}));
  }

  Future<http.Response> _handle(http.Request request) async {
    final path = '/${request.url.pathSegments.join('/')}';
    calls.add(_Call(
      request.method,
      path,
      request.url.queryParameters,
      request.body,
    ));
    final reply = _routes['${request.method} $path'];
    if (reply == null) {
      return _json({'error': 'unexpected ${request.method} $path'}, 500);
    }
    return reply(request);
  }

  List<_Call> callsTo(String method, String path) => calls
      .where((call) => call.method == method && call.path == path)
      .toList(growable: false);
}

http.Response _json(Object body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

Map<String, dynamic> _directionResultJson({
  bool planningStarted = true,
  String? planningError,
}) {
  return {
    'goalId': _goalId,
    'revision': _revisionNumber,
    'revisionStatus': 'planning',
    'directionStatus': 'decided',
    'state': {
      'version': 1,
      'goalId': _goalId,
      'revision': _revisionNumber,
      'status': 'decided',
      'options': <dynamic>[],
      'requests': <dynamic>[],
      'decisions': <dynamic>[],
      'updatedAt': '2026-11-06T05:00:00.000Z',
    },
    'decision': null,
    'artifactPath': r'C:\work\proj\.mafw\goals\g1\direction.json',
    'planningStarted': planningStarted,
    'planningError': ?planningError,
  };
}

// ── Harness ─────────────────────────────────────────────────────────────────

void _sizeView(WidgetTester tester, {double width = 440, double height = 2400}) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpDirectionPanel(
  WidgetTester tester,
  _FakeGateway gateway, {
  DirectionStateInfo? state,
  int? revision = _revisionNumber,
  String? eventId,
  void Function(DirectionDecisionResult result)? onDecided,
}) async {
  _sizeView(tester);
  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: Scaffold(
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(12),
        child: DirectionPanel(
          _podId,
          _goalId,
          client: gateway.client,
          revision: revision,
          state: state ?? DirectionStateInfo.parse(_directionJson()),
          eventId: eventId,
          onDecided: onDecided,
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

Future<void> _pumpQuestionCard(
  WidgetTester tester,
  _FakeGateway gateway, {
  String questionId = 'q1',
  String question = '你希望先修哪条链路？',
  int? revision = _revisionNumber,
  VoidCallback? onAnswered,
}) async {
  _sizeView(tester);
  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: Scaffold(
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(12),
        child: QuestionCard(
          _goalId,
          questionId,
          question,
          client: gateway.client,
          podId: _podId,
          revision: revision,
          onAnswered: onAnswered,
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

Future<void> _pumpGoalDetail(
  WidgetTester tester,
  _FakeGateway gateway, {
  required Map<String, dynamic> goalView,
  GoalAttentionSlotBuilder? attentionSlot,
}) async {
  _sizeView(tester);
  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: GoalDetailPage(
      _podId,
      _goalId,
      client: gateway.client,
      initial: PodGoalView.fromJson(goalView),
      attentionSlot: attentionSlot,
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  group('client: pendingGoalQuestions', () {
    test('reads /api/approvals and keeps only pending questions of this goal', () async {
      final gateway = _FakeGateway()
        ..on('GET', '/api/approvals', (_) => _json(_approvalsJson()));

      final questions = await gateway.client.pendingGoalQuestions(_goalId);

      expect(gateway.calls.single.path, '/api/approvals');
      expect(questions.map((q) => q.id), ['q1']);
      expect(questions.single.goalId, _goalId);
      // 无 goalId 的问题不能出现在任何一个 Goal 的问答卡里。
      expect(questions.any((q) => q.id == 'q_nogoal'), isFalse);
      expect(questions.single.question, '你希望先修哪条链路？');
      expect(questions.single.status, 'pending');
      expect(questions.single.createdAt, '2026-11-06T05:00:00.000Z');
    });

    test('surfaces a gateway failure instead of pretending there are no questions', () async {
      final gateway = _FakeGateway()
        ..on('GET', '/api/approvals', (_) => _json({'error': 'boom'}, 500));

      await expectLater(
        gateway.client.pendingGoalQuestions(_goalId),
        throwsA(isA<GatewayException>().having((e) => e.statusCode, 'statusCode', 500)),
      );
    });
  });

  group('DirectionPanel', () {
    testWidgets('selecting a candidate posts mode=decided + optionId (mint selected border)',
        (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes();
      var decided = 0;

      await _pumpDirectionPanel(tester, gateway, onDecided: (_) => decided++);

      // 候选卡：选中态是 mint 描边（调色板纪律：选用态允许 mint）。
      final option = tester.widget<Container>(
        find.byKey(const Key('direction-option:opt-a')),
      );
      var decoration = option.decoration! as BoxDecoration;
      expect(decoration.border?.top.color, MafwPalette.border);

      await tester.tap(find.byKey(const Key('direction-option:opt-a')));
      await tester.pumpAndSettle();

      final selected = tester.widget<Container>(
        find.byKey(const Key('direction-option:opt-a')),
      );
      decoration = selected.decoration! as BoxDecoration;
      expect(decoration.border?.top.color, MafwPalette.accent);

      await tester.tap(find.byKey(const Key('direction-submit')));
      await tester.pumpAndSettle();

      final posts = gateway.callsTo(
        'POST',
        '/api/pods/$_podId/goals/$_goalId/direction-decision',
      );
      expect(posts, hasLength(1));
      expect(posts.single.json, {
        'mode': 'decided',
        'optionId': 'opt-a',
        'revision': _revisionNumber,
      });
      expect(decided, 1);
    });

    testWidgets('free text posts the user words verbatim when no candidate is selected',
        (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes();
      var decided = 0;

      await _pumpDirectionPanel(tester, gateway, onDecided: (_) => decided++);

      await tester.enterText(
        find.byKey(const Key('direction-input')),
        '  就走 B 方案  ',
      );
      await tester.tap(find.byKey(const Key('direction-submit')));
      await tester.pumpAndSettle();

      final posts = gateway.callsTo(
        'POST',
        '/api/pods/$_podId/goals/$_goalId/direction-decision',
      );
      expect(posts.single.json, {
        'mode': 'decided',
        'userWords': '就走 B 方案',
        'revision': _revisionNumber,
      });
      expect(decided, 1);
    });

    testWidgets('an empty decision is blocked locally (no request)', (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes();

      await _pumpDirectionPanel(tester, gateway);

      await tester.tap(find.byKey(const Key('direction-submit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('direction-error')), findsOneWidget);
      expect(
        gateway.callsTo(
          'POST',
          '/api/pods/$_podId/goals/$_goalId/direction-decision',
        ),
        isEmpty,
      );
    });

    testWidgets('planningStarted=false surfaces the server planningError', (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes();
      gateway.on(
        'POST',
        '/api/pods/$_podId/goals/$_goalId/direction-decision',
        (_) => _json(_directionResultJson(
          planningStarted: false,
          planningError: 'planner crashed on start',
        )),
      );
      var decided = 0;
      DirectionDecisionResult? settled;

      await _pumpDirectionPanel(tester, gateway, onDecided: (result) {
        decided++;
        settled = result;
      });

      await tester.tap(find.byKey(const Key('direction-option:opt-a')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('direction-submit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('direction-planning-error')), findsOneWidget);
      expect(find.textContaining('planner crashed on start'), findsOneWidget);
      // 决定已落库：onDecided 仍要触发（宿主据此决定是否刷新阶段）。
      expect(decided, 1);
      expect(settled?.planningStarted, isFalse);
      expect(settled?.planningError, 'planner crashed on start');
    });

    testWidgets('a recorded decision marks the matching Pod event seen', (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes(events: [
        _eventJson(id: 'evt_other', goalId: 'other-goal'),
        _eventJson(id: 'evt_1'),
      ]);

      await _pumpDirectionPanel(tester, gateway);

      await tester.tap(find.byKey(const Key('direction-option:opt-a')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('direction-submit')));
      await tester.pumpAndSettle();

      final seen = gateway.callsTo('POST', '/api/pods/$_podId/events/evt_1/seen');
      expect(seen, hasLength(1));
      expect(
        gateway.callsTo('POST', '/api/pods/$_podId/events/evt_other/seen'),
        isEmpty,
      );
    });

    testWidgets('an explicit attention eventId is marked without listing events',
        (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes();
      gateway.on('POST', '/api/pods/$_podId/events/evt_direct/seen',
          (_) => _json({'ok': true, 'changed': true}));

      await _pumpDirectionPanel(tester, gateway, eventId: 'evt_direct');

      await tester.tap(find.byKey(const Key('direction-option:opt-a')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('direction-submit')));
      await tester.pumpAndSettle();

      expect(
        gateway.callsTo('POST', '/api/pods/$_podId/events/evt_direct/seen'),
        hasLength(1),
      );
      expect(gateway.callsTo('GET', '/api/pods/$_podId/events'), isEmpty);
    });

    test('DirectionStateInfo.parse is fail-open on broken mirrors', () {
      expect(DirectionStateInfo.parse(null), isNull);
      expect(DirectionStateInfo.parse('not-json'), isNull);
      expect(DirectionStateInfo.parse('{}'), isNull);

      final parsed = DirectionStateInfo.parse(_directionJson());
      expect(parsed, isNotNull);
      expect(parsed!.status, 'pending');
      expect(parsed.options.map((o) => o.id), ['opt-a', 'opt-b']);
      expect(parsed.options.first.title, '先修登录链路');
      expect(parsed.options.first.summary, '影响所有用户的入口');
      expect(parsed.options.first.risks, ['改动面大']);
      expect(parsed.requestReason, '两条链路只能先修一条');
    });
  });

  group('QuestionCard', () {
    testWidgets('a non-empty answer posts {answer} and calls onAnswered', (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes();
      var answered = 0;

      await _pumpQuestionCard(tester, gateway, onAnswered: () => answered++);

      expect(find.text('你希望先修哪条链路？'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('question-answer')),
        '  先修登录  ',
      );
      await tester.tap(find.byKey(const Key('question-submit')));
      await tester.pumpAndSettle();

      final posts = gateway.callsTo(
        'POST',
        '/api/goals/$_goalId/questions/q1/respond',
      );
      expect(posts.single.json, {'answer': '先修登录'});
      expect(answered, 1);
    });

    testWidgets('an empty answer is blocked locally (Task 10: "" would really be sent)',
        (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes();

      await _pumpQuestionCard(tester, gateway);

      await tester.tap(find.byKey(const Key('question-submit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('question-error')), findsOneWidget);
      expect(
        gateway.callsTo('POST', '/api/goals/$_goalId/questions/q1/respond'),
        isEmpty,
      );
    });

    testWidgets('cancel asks for confirmation first and sends nothing until confirmed',
        (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes();
      var answered = 0;

      await _pumpQuestionCard(tester, gateway, onAnswered: () => answered++);

      await tester.tap(find.byKey(const Key('question-cancel')));
      await tester.pumpAndSettle();

      // 取消不是「跳过问题」：gateway `handleCancel` 会把整个 Goal 归档失败，
      // 所以必须先二次确认（文案明确后果）。
      expect(find.byKey(const Key('question-cancel-confirm')), findsOneWidget);
      expect(find.textContaining('本 Goal 将以失败归档'), findsOneWidget);
      expect(
        gateway.callsTo('POST', '/api/goals/$_goalId/questions/q1/respond'),
        isEmpty,
      );
      expect(answered, 0);
    });

    testWidgets('dismissing the confirmation sends no cancel request', (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes();
      var answered = 0;

      await _pumpQuestionCard(tester, gateway, onAnswered: () => answered++);

      await tester.tap(find.byKey(const Key('question-cancel')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('question-cancel-dismiss')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('question-cancel-confirm')), findsNothing);
      expect(
        gateway.callsTo('POST', '/api/goals/$_goalId/questions/q1/respond'),
        isEmpty,
      );
      expect(answered, 0);
    });

    testWidgets('confirming posts {type:cancel} and calls onAnswered', (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes();
      var answered = 0;

      await _pumpQuestionCard(tester, gateway, onAnswered: () => answered++);

      await tester.tap(find.byKey(const Key('question-cancel')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('question-cancel-confirm-ok')));
      await tester.pumpAndSettle();

      final posts = gateway.callsTo(
        'POST',
        '/api/goals/$_goalId/questions/q1/respond',
      );
      expect(posts.single.json, {'type': 'cancel'});
      expect(answered, 1);
    });

    testWidgets('a server failure keeps the draft and shows the server message', (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes();
      gateway.on(
        'POST',
        '/api/goals/$_goalId/questions/q1/respond',
        (_) => _json({
          'status': 'conflict',
          'currentState': 'answered',
        }, 409),
      );

      await _pumpQuestionCard(tester, gateway);

      await tester.enterText(
        find.byKey(const Key('question-answer')),
        '先修登录',
      );
      await tester.tap(find.byKey(const Key('question-submit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('question-error')), findsOneWidget);
      expect(find.textContaining('answered'), findsOneWidget);
      // 失败不丢草稿（用户原话还在输入框里）。
      expect(
        tester.widget<TextField>(find.byKey(const Key('question-answer'))).controller?.text,
        '先修登录',
      );
    });

    testWidgets('answering marks the matching Pod event seen (best-effort)', (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes(events: [_eventJson(id: 'evt_1')]);

      await _pumpQuestionCard(tester, gateway);

      await tester.enterText(
        find.byKey(const Key('question-answer')),
        '先修登录',
      );
      await tester.tap(find.byKey(const Key('question-submit')));
      await tester.pumpAndSettle();

      expect(
        gateway.callsTo('POST', '/api/pods/$_podId/events/evt_1/seen'),
        hasLength(1),
      );
    });
  });

  group('Goal 详情 attention 分发', () {
    testWidgets('plan approval card renders TOGETHER with an external attention slot',
        (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes(
        goalView: _goalViewJson(stageKind: 'plan_approval'),
      );

      await _pumpGoalDetail(
        tester,
        gateway,
        goalView: _goalViewJson(stageKind: 'plan_approval'),
        attentionSlot: (_, _) => const Text('外部插槽内容'),
      );

      // 回归：外部 builder 不再吃掉 Task 9 的计划批准卡。
      expect(find.byKey(const Key('plan-approval-card')), findsOneWidget);
      expect(find.text('外部插槽内容'), findsOneWidget);
      expect(find.byKey(const Key('goal-attention-slot')), findsOneWidget);
    });

    testWidgets('direction_review renders the panel with candidates from revision.directionJson',
        (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes(
        goalView: _goalViewJson(stageKind: 'direction_review'),
        directionJson: _directionJson(),
      );

      await _pumpGoalDetail(
        tester,
        gateway,
        goalView: _goalViewJson(stageKind: 'direction_review'),
      );

      expect(find.byKey(const Key('goal-attention-slot')), findsOneWidget);
      expect(find.byKey(const Key('direction-panel')), findsOneWidget);
      expect(find.byKey(const Key('direction-option:opt-a')), findsOneWidget);
      expect(find.text('两条链路只能先修一条'), findsOneWidget);

      await tester.tap(find.byKey(const Key('direction-option:opt-b')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('direction-submit')));
      await tester.pumpAndSettle();

      final posts = gateway.callsTo(
        'POST',
        '/api/pods/$_podId/goals/$_goalId/direction-decision',
      );
      expect(posts.single.json, {
        'mode': 'decided',
        'optionId': 'opt-b',
        'revision': _revisionNumber,
      });
    });

    testWidgets('a decision that failed to start planning keeps the panel + error visible',
        (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes(
        goalView: _goalViewJson(stageKind: 'direction_review'),
        directionJson: _directionJson(),
      );
      gateway.on(
        'POST',
        '/api/pods/$_podId/goals/$_goalId/direction-decision',
        (_) => _json(_directionResultJson(
          planningStarted: false,
          planningError: 'planner crashed on start',
        )),
      );

      await _pumpGoalDetail(
        tester,
        gateway,
        goalView: _goalViewJson(stageKind: 'direction_review'),
      );

      await tester.tap(find.byKey(const Key('direction-option:opt-a')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('direction-submit')));
      await tester.pumpAndSettle();

      // 决定已落库但规划没起：面板必须留在原地把 planningError 说完。
      expect(find.byKey(const Key('direction-panel')), findsOneWidget);
      expect(find.byKey(const Key('direction-planning-error')), findsOneWidget);
      expect(find.textContaining('planner crashed on start'), findsOneWidget);
      // 不刷新阶段：刷新后 revision 已是 planning，面板会被收掉，错误就消失了。
      expect(
        gateway.callsTo('GET', '/api/goals/$_goalId/timeline'),
        hasLength(1),
      );
    });

    testWidgets('a decision that started planning refreshes the stage', (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes(
        goalView: _goalViewJson(stageKind: 'direction_review'),
        directionJson: _directionJson(),
      );

      await _pumpGoalDetail(
        tester,
        gateway,
        goalView: _goalViewJson(stageKind: 'direction_review'),
      );

      await tester.tap(find.byKey(const Key('direction-option:opt-a')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('direction-submit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('direction-planning-error')), findsNothing);
      expect(
        gateway.callsTo('GET', '/api/goals/$_goalId/timeline'),
        hasLength(2),
      );
    });

    testWidgets('question stage renders the card from pending approvals and answers it',
        (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes(
        goalView: _goalViewJson(stageKind: 'question'),
      );

      await _pumpGoalDetail(
        tester,
        gateway,
        goalView: _goalViewJson(stageKind: 'question'),
      );

      expect(gateway.callsTo('GET', '/api/approvals'), hasLength(1));
      expect(find.byKey(const Key('question-card')), findsOneWidget);
      expect(find.text('你希望先修哪条链路？'), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('question-answer')),
        '先修登录',
      );
      await tester.tap(find.byKey(const Key('question-submit')));
      await tester.pumpAndSettle();

      final posts = gateway.callsTo(
        'POST',
        '/api/goals/$_goalId/questions/q1/respond',
      );
      expect(posts.single.json, {'answer': '先修登录'});
    });

    testWidgets('question stage prefers the goal pendingQuestion over approvals', (tester) async {
      final gateway = _FakeGateway();
      final goalView = _goalViewJson(
        stageKind: 'question',
        pendingQuestion: {
          'questionId': 'q_driver_1',
          'node': 'plan',
          'questions': ['登录先走 SSO 还是密码？'],
        },
      );
      await gateway.installGoalDetailRoutes(
        goalView: goalView,
        // 真实 driver 问题不在 approvals 里：空列表就是当前网关的行为。
        approvalsJson: {'approvals': <dynamic>[]},
      );

      await _pumpGoalDetail(tester, gateway, goalView: goalView);

      expect(find.byKey(const Key('question-card')), findsOneWidget);
      expect(find.text('登录先走 SSO 还是密码？'), findsOneWidget);
      // 不能因为 approvals 为空就谎称「已不在待回答列表」。
      expect(find.byKey(const Key('question-missing')), findsNothing);

      await tester.enterText(
        find.byKey(const Key('question-answer')),
        '先走 SSO',
      );
      await tester.tap(find.byKey(const Key('question-submit')));
      await tester.pumpAndSettle();

      // 回答必须落到 driver 的 questionId（不是 approvals 的 id）。
      final posts = gateway.callsTo(
        'POST',
        '/api/goals/$_goalId/questions/q_driver_1/respond',
      );
      expect(posts.single.json, {'answer': '先走 SSO'});
    });

    testWidgets('question stage uses the stage action questionId when the text is not on the wire',
        (tester) async {
      final gateway = _FakeGateway();
      final goalView = _goalViewJson(
        stageKind: 'question',
        stageQuestionId: 'q_driver_2',
      );
      await gateway.installGoalDetailRoutes(
        goalView: goalView,
        approvalsJson: {'approvals': <dynamic>[]},
      );

      await _pumpGoalDetail(tester, gateway, goalView: goalView);

      // 当前网关的 PodGoalView 只带 stage.action.questionId：卡片仍要出现，
      // 且回答用这个 id（否则 respond 一律 404）。
      expect(find.byKey(const Key('question-card')), findsOneWidget);
      expect(find.byKey(const Key('question-missing')), findsNothing);

      await tester.enterText(
        find.byKey(const Key('question-answer')),
        '先走密码',
      );
      await tester.tap(find.byKey(const Key('question-submit')));
      await tester.pumpAndSettle();

      final posts = gateway.callsTo(
        'POST',
        '/api/goals/$_goalId/questions/q_driver_2/respond',
      );
      expect(posts.single.json, {'answer': '先走密码'});
    });

    testWidgets('question stage reads approvals even when the page has no Pod id',
        (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes(
        goalView: _goalViewJson(stageKind: 'question'),
      );

      _sizeView(tester);
      await tester.pumpWidget(MaterialApp(
        theme: mafwDarkTheme(),
        home: GoalDetailPage(
          null,
          _goalId,
          client: gateway.client,
          initial: PodGoalView.fromJson(_goalViewJson(stageKind: 'question')),
        ),
      ));
      await tester.pumpAndSettle();

      // 问题正文只需要 goalId（`/api/approvals`），不该被 Pod 查询拦住。
      expect(gateway.callsTo('GET', '/api/approvals'), hasLength(1));
      expect(find.byKey(const Key('question-card')), findsOneWidget);
      expect(find.byKey(const Key('question-missing')), findsNothing);
    });

    testWidgets('plan approval marks the matching Pod event seen (Task 9 card + Task 13 回写)',
        (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes(
        goalView: _goalViewJson(stageKind: 'plan_approval'),
        events: [
          _eventJson(id: 'evt_other', goalId: 'other-goal'),
          _eventJson(id: 'evt_1'),
        ],
      );

      await _pumpGoalDetail(
        tester,
        gateway,
        goalView: _goalViewJson(stageKind: 'plan_approval'),
      );

      await tester.tap(find.byKey(const Key('plan-approve')));
      await tester.pumpAndSettle();

      expect(
        gateway.callsTo('POST', '/api/pods/$_podId/events/evt_1/seen'),
        hasLength(1),
      );
      expect(
        gateway.callsTo('POST', '/api/pods/$_podId/events/evt_other/seen'),
        isEmpty,
      );
    });

    testWidgets('no matching stage and no builder hides the block entirely', (tester) async {
      final gateway = _FakeGateway();
      await gateway.installGoalDetailRoutes(
        goalView: _goalViewJson(stageKind: 'implementing'),
      );

      await _pumpGoalDetail(
        tester,
        gateway,
        goalView: _goalViewJson(stageKind: 'implementing'),
        attentionSlot: (_, _) => null,
      );

      expect(find.byKey(const Key('goal-attention-slot')), findsNothing);
      expect(find.text('需要你'), findsNothing);
    });
  });
}
