/// Orcalore mobile Task 15: 交给 Lead（handoff）.
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.7（自由讨论可以显式升级为 Goal，由 Lead 接管）。
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 15.
///
/// Contract pinned here（实读 gateway `routes/pods.ts:314-365` + 桌面
/// `packages/desktop/src/renderer/mafw/lead-handoff.ts:46-70`，不按草图猜）：
/// - 快照 = 最后一条 user + 之后 assistant 的**文本**拼接（工具输出永不进入）；
/// - 截断：snapshot ≤ 4000、title ≤ 80（79 字 + `…`）；
/// - 请求体 = `{title, objective, sourceRef:{sessionID, snapshot, capturedAt}}`
///   发往 `POST /api/pods/:podId/goals/handoff`；
/// - 无 Pod（lookup 404）时先 `podEnsure`，再 handoff；
/// - 响应里的 `goalId` 交回调用方做导航（`onOpenGoal(projectDir, goalId)`）；
/// - 失败绝不静默：无 Pod 创建失败 / 旧网关 / 网络错误各有可操作提示。
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;
import 'package:shared_preferences/shared_preferences.dart';

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/models/pod_models.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';
import 'package:orcalore_mobile/src/pages/sessions_page.dart';
import 'package:orcalore_mobile/src/services/active_project.dart';
import 'package:orcalore_mobile/src/services/lead_handoff.dart';
import 'package:orcalore_mobile/src/theme.dart';
import 'package:orcalore_mobile/src/widgets/mafw_bottom_nav.dart';

const String _dirA = r'C:\work\projA';
const String _podId = 'pod-1';
const String _goalId = 'goal-9';
const String _token = 'test-token';

// ── Fixtures ────────────────────────────────────────────────────────────────

MafwMessage _msg(
  String role,
  String? text, {
  String id = '',
  List<MafwPart> parts = const <MafwPart>[],
  String sessionID = 'ses_a',
}) {
  return MafwMessage(
    id: id,
    sessionID: sessionID,
    role: role,
    text: text,
    timeCreated: 0,
    parts: parts,
  );
}

MafwSession _session({
  String id = 'ses_a',
  String title = 'Alpha',
  String? directory = _dirA,
  Map<String, dynamic>? metadata,
}) {
  return MafwSession(
    id: id,
    title: title,
    projectID: directory,
    directory: directory,
    metadata: metadata,
  );
}

PodInfo _pod({String id = _podId, String dir = _dirA}) {
  return PodInfo(
    id: id,
    projectDir: dir,
    name: 'projA',
    status: 'active',
    activeGoalId: null,
    goals: const <PodGoalView>[],
    attention: const <AttentionItem>[],
  );
}

Map<String, dynamic> _handoffJson({
  String goalId = _goalId,
  String podId = _podId,
}) =>
    {
      'podId': podId,
      'goalId': goalId,
      'status': 'discussing',
      'revision': 1,
      'stage': 'discussing',
      'queueReason': null,
      'sessionID': 'ses_tech_lead',
      'goal': {
        'goalId': goalId,
        'title': 'Alpha',
        'status': 'active',
        'bucket': 'in_progress',
        'revision': 1,
        'verdict': null,
        'resultReady': false,
        'strategy': null,
        'stage': {'owner': 'team', 'kind': 'discussing'},
      },
    };

http.Response _json(Object body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

void _sizeView(WidgetTester tester) {
  tester.view.physicalSize = const Size(430, 1400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

// ── Service-level fake（record ordered calls, no HTTP）──────────────────────

class _FlowClient extends GatewayClient {
  _FlowClient()
      : super(const ConnectionConfig(
          baseUrl: 'http://127.0.0.1:3000',
          apiToken: _token,
        ));

  final List<String> calls = <String>[];
  List<MafwMessage> history = const <MafwMessage>[];
  PodInfo? lookupPod;
  PodInfo? ensuredPod;
  Object? lookupError;
  Object? ensureError;
  Object? handoffError;
  Map<String, dynamic> handoffResponse = _handoffJson();
  Map<String, dynamic>? handoffRequest;

  @override
  Future<List<MafwMessage>> messages(String sessionID, {int limit = 50}) async {
    calls.add('messages:$sessionID:$limit');
    return history;
  }

  @override
  Future<PodInfo?> podLookup(String projectDir) async {
    calls.add('lookup:$projectDir');
    final error = lookupError;
    if (error != null) throw error;
    return lookupPod;
  }

  @override
  Future<PodInfo> podEnsure(String projectDir) async {
    calls.add('ensure:$projectDir');
    final error = ensureError;
    if (error != null) throw error;
    return ensuredPod ?? _pod(dir: projectDir);
  }

  @override
  Future<Map<String, dynamic>> goalHandoff(
    String podId, {
    required String title,
    required String objective,
    required Map<String, dynamic> sourceRef,
  }) async {
    calls.add('handoff:$podId');
    handoffRequest = {
      'title': title,
      'objective': objective,
      'sourceRef': sourceRef,
    };
    final error = handoffError;
    if (error != null) throw error;
    return handoffResponse;
  }
}

// ── Widget-level fake（SessionsPage long-press flow）────────────────────────

class _ChatClient extends _FlowClient {
  List<MafwSession> sessions = const <MafwSession>[];

  @override
  Future<List<ProjectInfo>> projects() async => const <ProjectInfo>[];

  @override
  Future<PresenceInfo> presence() async => PresenceInfo.fromJson({
        'running': <dynamic>[],
        'attention': {'count': 0, 'items': <dynamic>[]},
        'unreadResults': {'count': 0},
      });

  @override
  Future<List<MafwSession>> listSessions({String? projectID}) async {
    calls.add('listSessions:${projectID ?? ''}');
    if (projectID == null) return sessions;
    return sessions.where((s) => s.directory == projectID).toList();
  }
}

Future<ActiveProjectStore> _pumpChatTab(
  WidgetTester tester, {
  required _ChatClient client,
  List<MafwSession> sessions = const <MafwSession>[],
  void Function(String projectId, String goalId)? onOpenGoal,
}) async {
  _sizeView(tester);
  client.sessions = sessions;
  final store = ActiveProjectStore(prefsKey: 'lead-handoff-test-active');
  await store.load();
  await store.set(_dirA);

  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: SessionsPage(
      sessions: const <MafwSession>[],
      onOpen: (_) {},
      onSettings: () {},
      client: client,
      activeProject: store,
      onOpenGoal: onOpenGoal,
    ),
  ));
  await tester.pumpAndSettle();
  await tester.tap(
    find.descendant(of: find.byType(MafwBottomNav), matching: find.text('聊天')),
  );
  await tester.pumpAndSettle();
  return store;
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('buildLeadHandoff', () {
    test('snapshot joins the last user + following assistant text only', () {
      final history = <MafwMessage>[
        _msg('user', '第一轮问题'),
        _msg('assistant', '第一轮回答'),
        _msg('user', '最后一问'),
        _msg('assistant', '第一段回答'),
        _msg('assistant', '第二段回答'),
      ];

      final input = buildLeadHandoff(history)!;

      expect(input.sourceRef.snapshot, '最后一问\n\n第一段回答\n\n第二段回答');
      expect(input.objective, input.sourceRef.snapshot);
      expect(input.sourceRef.sessionID, 'ses_a');
      expect(input.title, '最后一问');
    });

    test('tool output never enters the snapshot', () {
      final toolPart = MafwPart(
        id: 'tp1',
        type: 'tool',
        tool: 'bash',
        state: const {'status': 'completed', 'output': 'TOOL OUTPUT'},
      );
      final history = <MafwMessage>[
        _msg('user', '跑一下测试'),
        _msg('assistant', null, parts: [toolPart]),
        _msg('assistant', '测试通过'),
      ];

      final input = buildLeadHandoff(history)!;

      expect(input.sourceRef.snapshot, '跑一下测试\n\n测试通过');
      expect(input.sourceRef.snapshot.contains('TOOL OUTPUT'), isFalse);
    });

    test('all text parts of one message contribute (text → tool → text)', () {
      // Real `MafwMessage.fromJson` sets `text` to the FIRST text part; the tail
      // conclusion after a tool call lives in a later text part. Desktop
      // `textOfMessage` joins every text part (`pod-transcript.ts:3-19`), so the
      // handoff must not silently drop the second half.
      final history = <MafwMessage>[
        _msg('user', '跑一下测试'),
        MafwMessage(
          id: 'm2',
          sessionID: 'ses_a',
          role: 'assistant',
          text: '开始检查',
          timeCreated: 0,
          parts: <MafwPart>[
            MafwPart(id: 't1', type: 'text', text: '开始检查'),
            MafwPart(
              id: 'tp1',
              type: 'tool',
              tool: 'bash',
              state: {'status': 'completed', 'output': 'TOOL OUTPUT'},
            ),
            MafwPart(id: 't2', type: 'text', text: '后半段结论'),
          ],
        ),
      ];

      final input = buildLeadHandoff(history)!;

      expect(input.sourceRef.snapshot, '跑一下测试\n\n开始检查\n后半段结论');
      expect(input.sourceRef.snapshot.contains('TOOL OUTPUT'), isFalse);
    });

    test('snapshot and title are truncated at 4000 / 80 characters', () {
      final longLine = 'x' * 5000;

      final input = buildLeadHandoff([_msg('user', longLine)])!;

      expect(input.sourceRef.snapshot.length, 4000);
      expect(input.sourceRef.snapshot, longLine.substring(0, 4000));
      expect(input.objective, input.sourceRef.snapshot);
      expect(input.title.length, 80);
      expect(input.title, '${'x' * 79}…');
    });

    test('title strips markdown heading + session ids and collapses whitespace',
        () {
      final input = buildLeadHandoff([
        _msg('user', '\n# Fix ses_abc123 CI\n第二行'),
      ])!;

      expect(input.title, 'Fix CI');
    });

    test('title falls back to the session title, then 未命名讨论', () {
      expect(
        buildLeadHandoff(
          [_msg('user', 'ses_abc123')],
          sessionTitle: '  Alpha  ',
        )!.title,
        'Alpha',
      );
      expect(
        buildLeadHandoff([_msg('user', 'ses_abc123')])!.title,
        '未命名讨论',
      );
    });

    test('capturedAt is a UTC ISO timestamp', () {
      final input = buildLeadHandoff(
        [_msg('user', '修 CI')],
        now: DateTime.utc(2026, 11, 9, 12, 0, 0),
      )!;

      expect(input.sourceRef.capturedAt, '2026-11-09T12:00:00.000Z');
    });

    test('an empty discussion has nothing to hand off', () {
      expect(buildLeadHandoff(const <MafwMessage>[]), isNull);
      expect(buildLeadHandoff([_msg('user', '   ')]), isNull);
      expect(
        buildLeadHandoff([
          _msg('assistant', null, parts: [
            MafwPart(id: 'tp', type: 'tool', state: const {'output': 'x'}),
          ]),
        ]),
        isNull,
      );
    });
  });

  group('handoffGoal request contract', () {
    test('POSTs title/objective/sourceRef to the handoff route', () async {
      late http.Request captured;
      final client = GatewayClient(
        const ConnectionConfig(baseUrl: 'http://127.0.0.1:3000', apiToken: _token),
        httpClient: http_testing.MockClient((request) async {
          captured = request;
          return _json(_handoffJson());
        }),
      );
      final input = buildLeadHandoff(
        [_msg('user', '修 CI', id: 'm1')],
        now: DateTime.utc(2026, 11, 9, 12),
      )!;

      final result = await LeadHandoffService(client).handoffGoal(_podId, input);

      expect(result.goalId, _goalId);
      expect(result.podId, _podId);
      expect(result.revision, 1);
      expect(result.sessionID, 'ses_tech_lead');

      expect(captured.method, 'POST');
      expect(
        '/${captured.url.pathSegments.join('/')}',
        '/api/pods/$_podId/goals/handoff',
      );
      final body = jsonDecode(captured.body) as Map<String, dynamic>;
      expect(body.keys.toSet(), {'title', 'objective', 'sourceRef'});
      expect(body['title'], '修 CI');
      expect(body['objective'], '修 CI');
      final ref = body['sourceRef'] as Map<String, dynamic>;
      expect(ref.keys.toSet(), {'sessionID', 'snapshot', 'capturedAt'});
      expect(ref['sessionID'], 'ses_a');
      expect(ref['snapshot'], '修 CI');
      expect(ref['capturedAt'], '2026-11-09T12:00:00.000Z');
    });

    test('an old gateway without the handoff route is a route-missing failure',
        () async {
      final client = GatewayClient(
        const ConnectionConfig(baseUrl: 'http://127.0.0.1:3000', apiToken: _token),
        httpClient: http_testing.MockClient((_) async => http.Response('', 404)),
      );
      final input = buildLeadHandoff([_msg('user', '修 CI')])!;

      await expectLater(
        LeadHandoffService(client).handoffGoal(_podId, input),
        throwsA(isA<LeadHandoffException>().having(
          (e) => e.message,
          'message',
          contains('网关版本过旧'),
        )),
      );
    });
  });

  group('LeadHandoffService.handoff flow', () {
    test('no Pod → podEnsure runs before handoff and the goalId comes back',
        () async {
      final client = _FlowClient()
        ..history = [_msg('user', '把这段讨论交给你')]
        ..lookupPod = null
        ..ensuredPod = _pod();

      final result = await LeadHandoffService(client).handoff(
        'ses_a',
        projectDir: _dirA,
        sessionTitle: 'Alpha',
      );

      expect(client.calls, [
        'messages:ses_a:100',
        'lookup:$_dirA',
        'ensure:$_dirA',
        'handoff:$_podId',
      ]);
      expect(result.goalId, _goalId);
      final request = client.handoffRequest!;
      expect(request['title'], '把这段讨论交给你');
      expect(request['objective'], '把这段讨论交给你');
      final ref = request['sourceRef'] as Map<String, dynamic>;
      expect(ref['sessionID'], 'ses_a');
      expect(ref['snapshot'], '把这段讨论交给你');
      expect(ref['capturedAt'], isNotEmpty);
    });

    test('an existing Pod skips podEnsure', () async {
      final client = _FlowClient()
        ..history = [_msg('user', '修 CI')]
        ..lookupPod = _pod();

      await LeadHandoffService(client).handoff('ses_a', projectDir: _dirA);

      expect(client.calls, [
        'messages:ses_a:100',
        'lookup:$_dirA',
        'handoff:$_podId',
      ]);
    });

    test('creating a missing Pod fails with an actionable message', () async {
      final client = _FlowClient()
        ..history = [_msg('user', '修 CI')]
        ..lookupPod = null
        ..ensureError = GatewayException(
          'podEnsure: HTTP 404',
          statusCode: 404,
          errorBody: jsonEncode({'error': 'project is not registered: $_dirA'}),
        );

      await expectLater(
        LeadHandoffService(client).handoff('ses_a', projectDir: _dirA),
        throwsA(isA<LeadHandoffException>().having(
          (e) => e.message,
          'message',
          allOf(contains('创建鲸群失败'), contains('project is not registered')),
        )),
      );
    });

    test('an old gateway for pod creation is distinguished from a real failure',
        () async {
      final client = _FlowClient()
        ..history = [_msg('user', '修 CI')]
        ..lookupPod = null
        ..ensureError = GatewayRouteMissingException('podEnsure: old gateway');

      await expectLater(
        LeadHandoffService(client).handoff('ses_a', projectDir: _dirA),
        throwsA(isA<LeadHandoffException>().having(
          (e) => e.message,
          'message',
          contains('网关版本过旧'),
        )),
      );
    });

    test('a discussion without text never resolves a Pod or posts', () async {
      final client = _FlowClient()..history = const <MafwMessage>[];

      await expectLater(
        LeadHandoffService(client).handoff('ses_a', projectDir: _dirA),
        throwsA(isA<LeadHandoffException>().having(
          (e) => e.message,
          'message',
          contains('还没有可交接的对话内容'),
        )),
      );
      // 只读了历史；没有 lookup / ensure / handoff。
      expect(client.calls, ['messages:ses_a:100']);
    });
  });

  group('leadHandoffErrorMessage', () {
    test('separates old gateway, server message and network failures', () {
      expect(
        leadHandoffErrorMessage(GatewayRouteMissingException('old')),
        contains('网关版本过旧'),
      );
      expect(
        leadHandoffErrorMessage(GatewayException(
          'goalHandoff: HTTP 503',
          statusCode: 503,
          errorBody: '{"error":"tech lead unavailable"}',
        )),
        'tech lead unavailable',
      );
      expect(
        leadHandoffErrorMessage(Exception('Connection refused')),
        contains('网络错误'),
      );
    });
  });

  group('聊天 tab 长按 → 交给 Lead', () {
    testWidgets('hands the session over, toasts and opens the new Goal',
        (tester) async {
      final client = _ChatClient()
        ..history = [
          _msg('user', '帮我把 CI 修好'),
          _msg('assistant', '收到，先看看失败日志'),
        ]
        ..lookupPod = _pod();
      final opened = <String>[];

      await _pumpChatTab(
        tester,
        client: client,
        sessions: [_session()],
        onOpenGoal: (projectId, goalId) => opened.add('$projectId|$goalId'),
      );

      await tester.longPress(find.text('Alpha'));
      await tester.pumpAndSettle();
      expect(find.text('交给 Lead'), findsOneWidget);

      await tester.tap(find.text('交给 Lead'));
      await tester.pumpAndSettle();

      expect(client.calls, [
        'listSessions:$_dirA',
        'messages:ses_a:100',
        'lookup:$_dirA',
        'handoff:$_podId',
      ]);
      final ref =
          client.handoffRequest!['sourceRef'] as Map<String, dynamic>;
      expect(ref['snapshot'], '帮我把 CI 修好\n\n收到，先看看失败日志');
      expect(opened, ['$_dirA|$_goalId']);
      expect(find.text('已交给 Lead'), findsOneWidget);
    });

    testWidgets('a missing Pod is created before the handoff', (tester) async {
      final client = _ChatClient()
        ..history = [_msg('user', '修 CI')]
        ..lookupPod = null
        ..ensuredPod = _pod();
      final opened = <String>[];

      await _pumpChatTab(
        tester,
        client: client,
        sessions: [_session()],
        onOpenGoal: (projectId, goalId) => opened.add('$projectId|$goalId'),
      );

      await tester.longPress(find.text('Alpha'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('交给 Lead'));
      await tester.pumpAndSettle();

      expect(client.calls, [
        'listSessions:$_dirA',
        'messages:ses_a:100',
        'lookup:$_dirA',
        'ensure:$_dirA',
        'handoff:$_podId',
      ]);
      expect(opened, ['$_dirA|$_goalId']);
    });

    testWidgets('an old gateway says so and never navigates', (tester) async {
      final client = _ChatClient()
        ..history = [_msg('user', '修 CI')]
        ..lookupPod = _pod()
        ..handoffError = GatewayRouteMissingException('handoff: old gateway');
      final opened = <String>[];

      await _pumpChatTab(
        tester,
        client: client,
        sessions: [_session()],
        onOpenGoal: (projectId, goalId) => opened.add('$projectId|$goalId'),
      );

      await tester.longPress(find.text('Alpha'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('交给 Lead'));
      await tester.pumpAndSettle();

      expect(find.textContaining('网关版本过旧'), findsOneWidget);
      expect(find.text('已交给 Lead'), findsNothing);
      expect(opened, isEmpty);
    });

    testWidgets('a Lead session is not handoffable', (tester) async {
      final client = _ChatClient()
        ..history = [_msg('user', '修 CI')]
        ..lookupPod = _pod();

      await _pumpChatTab(
        tester,
        client: client,
        sessions: [
          _session(metadata: {
            'mafw': {'role': 'lead'},
          }),
        ],
      );

      await tester.longPress(find.text('Alpha'));
      await tester.pumpAndSettle();

      expect(find.text('交给 Lead'), findsNothing);
      expect(find.textContaining('Lead 会话'), findsOneWidget);
    });
  });
}
