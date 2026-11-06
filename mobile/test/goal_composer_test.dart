/// Orcalore「新建讨论」Goal composer（Task 11）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.5（创建讨论）/ §7.3（工作 tab FAB）。
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 11.
///
/// Contract pinned here（实读 gateway 路由，不按草图猜）：
/// - `POST /api/pods/:podId/goals` body `{title, objective?, acceptance?, source}`
///   （`gateway/src/routes/pods.ts:393`）：`title` 与 `objective`（或 charter）都是
///   服务端硬要求，`source` 必须是白名单值——移动端固定 `'mobile'`（client 层
///   保证，本测试用真 `GatewayClient` + MockClient 断言请求体）。
/// - 成功响应带 `{goalId, revision, sessionID, status:'discussing'}` 且
///   `onCreated` 原样交给调用方（工作 tab 据此跳 Goal 详情）。
/// - 空 title 本地阻止（不发请求）；服务端错误展示**服务端自己的话**
///   （`{"error": ...}` 正文），页面留在原处可重试。
/// - 无 Pod 流：FAB → `podLookup(dir)` 404 → `podEnsure(dir)` → composer；
///   ensure 失败必须区分「网关过旧（路由缺失）」与「创建鲸群失败（服务端错误）」。
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;
import 'package:shared_preferences/shared_preferences.dart';

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/pod_models.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';
import 'package:orcalore_mobile/src/pages/goal_composer_page.dart';
import 'package:orcalore_mobile/src/pages/work_tab.dart';
import 'package:orcalore_mobile/src/services/active_project.dart';
import 'package:orcalore_mobile/src/services/work_refresh_bus.dart';
import 'package:orcalore_mobile/src/theme.dart';

const String _dirA = r'C:\work\projA';
const String _podId = 'pod-1';
const String _goalId = 'goal-1';
const String _token = 'test-token';

// ── Fixtures（形状与 gateway 响应逐字对齐）────────────────────────────────────

/// `POST /api/pods/:podId/goals` 的 Tech Lead 讨论分支响应。
Map<String, dynamic> _createdGoalJson({
  String? sessionID = 'ses_tech_lead',
  String? sessionError,
  int revision = 1,
}) =>
    {
      'podId': _podId,
      'goalId': _goalId,
      'status': 'discussing',
      'revision': revision,
      'stage': 'discussing',
      'queueReason': null,
      'sessionID': sessionID,
      'goal': {
        'goalId': _goalId,
        'title': '修 CI',
        'status': 'active',
        'bucket': 'in_progress',
        'revision': revision,
        'verdict': null,
        'resultReady': false,
        'strategy': null,
        'stage': {'owner': 'team', 'kind': 'discussing'},
      },
      'sessionError': ?sessionError,
    };

/// `GET /api/projects/:projectId/pod/lookup` / `POST .../pod` 的 detail 信封。
Map<String, dynamic> _podDetailJson() => {
      'pod': {
        'id': _podId,
        'projectDir': _dirA,
        'name': 'projA',
        'status': 'active',
        'activeGoalId': null,
      },
      'members': <dynamic>[],
      'goals': <dynamic>[],
      'tasks': <dynamic>[],
      'sessions': <dynamic>[],
      'attention': <dynamic>[],
      'messageHealth': <dynamic>[],
    };

Map<String, dynamic> _overviewJson() => {
      'projectDir': _dirA,
      'podId': _podId,
      'groups': <String, dynamic>{},
      'counts': <String, dynamic>{},
      'total': 0,
    };

Map<String, dynamic> _presenceJson() => {
      'running': <dynamic>[],
      'attention': {'count': 0, 'items': <dynamic>[]},
      'unreadResults': {'count': 0},
    };

// ── Fake gateway（真 GatewayClient + MockClient：路径/载荷可断言）──────────────

/// 一次被拦截的请求（方法、**解码后**路径、JSON 体）。
class _Call {
  final String method;
  final String path;
  final String body;

  const _Call(this.method, this.path, this.body);

  Map<String, dynamic> get json => body.isEmpty
      ? const <String, dynamic>{}
      : jsonDecode(body) as Map<String, dynamic>;
}

typedef _Reply = FutureOr<http.Response> Function(http.Request request);

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
    // pathSegments 已解码：Windows 目录里的 `:` / `\` 与路由注册值一致。
    final path = '/${request.url.pathSegments.join('/')}';
    calls.add(_Call(request.method, path, request.body));
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

/// 直接挂 composer 页面（页面自身不依赖 WorkTab）。
Future<void> _pumpComposer(
  WidgetTester tester, {
  GatewayClient? client,
  void Function(CreateGoalResult created)? onCreated,
}) async {
  _sizeView(tester);
  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: GoalComposerPage(
      _podId,
      client: client,
      onCreated: onCreated,
    ),
  ));
  await tester.pumpAndSettle();
}

/// 挂整个工作 tab（FAB 流 + composer 路由 + onOpenGoal 回调）。
Future<void> _pumpWorkTab(
  WidgetTester tester, {
  required GatewayClient? client,
  required ActiveProjectStore store,
  void Function(String projectId, String goalId)? onOpenGoal,
}) async {
  _sizeView(tester);
  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: Scaffold(
      body: WorkTab(
        client: client,
        activeProject: store,
        refreshBus: WorkRefreshBus(),
        onOpenGoal: onOpenGoal,
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

Future<ActiveProjectStore> _storeFor(String dir) async {
  final store = ActiveProjectStore(prefsKey: 'goal-composer-test-active');
  await store.load();
  await store.set(dir);
  return store;
}

/// 工作 tab 的基础数据路由（项目 / 五桶 / presence）。
void _stubWorkSurface(_FakeGateway gateway) {
  gateway
    ..on('GET', '/api/projects', (_) => _json({
          'projects': [
            {'id': _dirA},
          ],
        }))
    ..on('GET', '/api/projects/$_dirA/work', (_) => _json(_overviewJson()))
    ..on('GET', '/api/presence', (_) => _json(_presenceJson()));
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('GoalComposerPage', () {
    testWidgets(
        'submits title/objective/acceptance with source=mobile and hands back sessionID/revision',
        (tester) async {
      final gateway = _FakeGateway()
        ..on('POST', '/api/pods/$_podId/goals', (_) => _json(_createdGoalJson()));
      CreateGoalResult? created;

      await _pumpComposer(
        tester,
        client: gateway.client,
        onCreated: (result) => created = result,
      );

      await tester.enterText(find.byKey(const Key('goal-composer-title')), '修 CI');
      await tester.enterText(
        find.byKey(const Key('goal-composer-objective')),
        '让主干恢复绿',
      );
      // 「一行一条」：空行与首尾空白都要被丢掉。
      await tester.enterText(
        find.byKey(const Key('goal-composer-acceptance')),
        'CI 全绿\n\n  没有新增 flaky  ',
      );
      await tester.tap(find.byKey(const Key('goal-composer-submit')));
      await tester.pumpAndSettle();

      final call = gateway.calls.single;
      expect(call.method, 'POST');
      expect(call.path, '/api/pods/$_podId/goals');
      expect(call.json, {
        'title': '修 CI',
        'objective': '让主干恢复绿',
        'acceptance': ['CI 全绿', '没有新增 flaky'],
        // 入口来源由 client 层保证（服务端 normalizeGoalSource 白名单）。
        'source': 'mobile',
      });

      expect(created, isNotNull);
      expect(created!.goalId, _goalId);
      expect(created!.revision, 1);
      expect(created!.sessionID, 'ses_tech_lead');
      expect(created!.status, 'discussing');
    });

    testWidgets('an empty title is blocked locally and never reaches the gateway',
        (tester) async {
      final gateway = _FakeGateway()
        ..on('POST', '/api/pods/$_podId/goals', (_) => _json(_createdGoalJson()));
      CreateGoalResult? created;

      await _pumpComposer(
        tester,
        client: gateway.client,
        onCreated: (result) => created = result,
      );

      await tester.enterText(
        find.byKey(const Key('goal-composer-objective')),
        '让主干恢复绿',
      );
      await tester.tap(find.byKey(const Key('goal-composer-submit')));
      await tester.pumpAndSettle();

      expect(gateway.calls, isEmpty);
      expect(created, isNull);
      expect(find.text('请先写一个标题'), findsOneWidget);
    });

    testWidgets('an empty objective is blocked locally too (server requires both)',
        (tester) async {
      final gateway = _FakeGateway()
        ..on('POST', '/api/pods/$_podId/goals', (_) => _json(_createdGoalJson()));
      CreateGoalResult? created;

      await _pumpComposer(
        tester,
        client: gateway.client,
        onCreated: (result) => created = result,
      );

      await tester.enterText(find.byKey(const Key('goal-composer-title')), '修 CI');
      await tester.tap(find.byKey(const Key('goal-composer-submit')));
      await tester.pumpAndSettle();

      // gateway `routes/pods.ts:401` 要求 objective（或 charter）非空；
      // composer 没有 charter 字段，所以在本地就按同一契约拦下。
      expect(gateway.calls, isEmpty);
      expect(created, isNull);
      expect(find.textContaining('再写一句目标'), findsOneWidget);
    });

    testWidgets('shows the server error verbatim and stays retryable', (tester) async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/pods/$_podId/goals',
          (_) => _json({'error': 'goal queue unavailable'}, 503),
        );
      CreateGoalResult? created;

      await _pumpComposer(
        tester,
        client: gateway.client,
        onCreated: (result) => created = result,
      );

      await tester.enterText(find.byKey(const Key('goal-composer-title')), '修 CI');
      await tester.enterText(
        find.byKey(const Key('goal-composer-objective')),
        '让主干恢复绿',
      );
      await tester.tap(find.byKey(const Key('goal-composer-submit')));
      await tester.pumpAndSettle();

      expect(created, isNull);
      expect(find.byKey(const Key('goal-composer-error')), findsOneWidget);
      expect(find.textContaining('goal queue unavailable'), findsOneWidget);
      // 页面没有离开：用户能改内容再试。
      expect(find.byKey(const Key('goal-composer-title')), findsOneWidget);
      final button = tester.widget<FilledButton>(
        find.byKey(const Key('goal-composer-submit')),
      );
      expect(button.onPressed, isNotNull);
    });

    testWidgets('disables the submit button while the request is in flight',
        (tester) async {
      final gate = Completer<void>();
      final gateway = _FakeGateway()
        ..on('POST', '/api/pods/$_podId/goals', (_) async {
          await gate.future;
          return _json(_createdGoalJson());
        });
      CreateGoalResult? created;

      await _pumpComposer(
        tester,
        client: gateway.client,
        onCreated: (result) => created = result,
      );

      await tester.enterText(find.byKey(const Key('goal-composer-title')), '修 CI');
      await tester.enterText(
        find.byKey(const Key('goal-composer-objective')),
        '让主干恢复绿',
      );
      await tester.tap(find.byKey(const Key('goal-composer-submit')));
      await tester.pump();

      final button = tester.widget<FilledButton>(
        find.byKey(const Key('goal-composer-submit')),
      );
      expect(button.onPressed, isNull);

      // 提交中再点一次不会发第二个请求。
      await tester.tap(
        find.byKey(const Key('goal-composer-submit')),
        warnIfMissed: false,
      );
      await tester.pump();
      expect(gateway.calls.length, 1);

      gate.complete();
      await tester.pumpAndSettle();
      expect(created, isNotNull);
    });

    test('parseAcceptanceLines splits on lines, trims and drops blanks', () {
      expect(parseAcceptanceLines('  一  \r\n二\n\n  \n三 '), ['一', '二', '三']);
      expect(parseAcceptanceLines(''), isEmpty);
      expect(parseAcceptanceLines(' \n\t\n'), isEmpty);
    });

    test('goalComposerErrorMessage prefers the gateway {"error"} body', () {
      expect(
        goalComposerErrorMessage(GatewayException(
          'createGoal: HTTP 400',
          statusCode: 400,
          errorBody: '{"error":"objective or charter is required"}',
        )),
        'objective or charter is required',
      );
      // 非 JSON 正文 / 传输错误：退回异常自身的 message，不把 HTML 糊到 UI。
      expect(
        goalComposerErrorMessage(GatewayException('createGoal: HTTP 502')),
        'createGoal: HTTP 502',
      );
      expect(goalComposerErrorMessage(StateError('boom')), contains('boom'));
    });
  });

  group('WorkTab FAB → composer', () {
    testWidgets(
        'no Pod (404) → podEnsure → composer → onCreated → onOpenGoal(projectId, goalId)',
        (tester) async {
      final gateway = _FakeGateway();
      _stubWorkSurface(gateway);
      gateway
        ..on(
          'GET',
          '/api/projects/$_dirA/pod/lookup',
          (_) => _json({'error': 'pod not found'}, 404),
        )
        ..on('POST', '/api/projects/$_dirA/pod', (_) => _json(_podDetailJson()))
        ..on('POST', '/api/pods/$_podId/goals', (_) => _json(_createdGoalJson()));

      final opened = <String>[];
      await _pumpWorkTab(
        tester,
        client: gateway.client,
        store: await _storeFor(_dirA),
        onOpenGoal: (projectId, goalId) => opened.add('$projectId|$goalId'),
      );

      await tester.tap(find.byKey(const Key('work-fab')));
      await tester.pumpAndSettle();

      // 404 → ensure → 带着后端返回的 podId 打开 composer。
      expect(find.byKey(const Key('goal-composer-title')), findsOneWidget);
      final lookupIndex = gateway.calls.indexWhere(
        (call) => call.path == '/api/projects/$_dirA/pod/lookup',
      );
      final ensureIndex = gateway.calls.indexWhere(
        (call) =>
            call.method == 'POST' && call.path == '/api/projects/$_dirA/pod',
      );
      expect(lookupIndex, isNot(-1));
      expect(ensureIndex, greaterThan(lookupIndex));

      await tester.enterText(find.byKey(const Key('goal-composer-title')), '修 CI');
      await tester.enterText(
        find.byKey(const Key('goal-composer-objective')),
        '让主干恢复绿',
      );
      await tester.tap(find.byKey(const Key('goal-composer-submit')));
      await tester.pumpAndSettle();

      expect(opened, ['$_dirA|$_goalId']);
      final created = gateway.calls
          .where((call) => call.path == '/api/pods/$_podId/goals')
          .single;
      expect(created.json['source'], 'mobile');
      expect(created.json['title'], '修 CI');
      // composer 已退回工作 tab（详情页由外壳导航，不在本测试范围）。
      expect(find.byKey(const Key('goal-composer-title')), findsNothing);
      expect(find.byKey(const Key('work-fab')), findsOneWidget);
    });

    testWidgets('ensuring a missing Pod refreshes the work surface right away',
        (tester) async {
      final gateway = _FakeGateway();
      _stubWorkSurface(gateway);
      gateway
        ..on(
          'GET',
          '/api/projects/$_dirA/pod/lookup',
          (_) => _json({'error': 'pod not found'}, 404),
        )
        ..on('POST', '/api/projects/$_dirA/pod', (_) => _json(_podDetailJson()));

      await _pumpWorkTab(
        tester,
        client: gateway.client,
        store: await _storeFor(_dirA),
      );
      final before = gateway.calls
          .where((call) => call.path == '/api/projects/$_dirA/work')
          .length;

      await tester.tap(find.byKey(const Key('work-fab')));
      await tester.pumpAndSettle();

      // Pod 刚建好就重拉五桶：取消 composer 也不会继续看到「还没有鲸群」。
      final after = gateway.calls
          .where((call) => call.path == '/api/projects/$_dirA/work')
          .length;
      expect(after, greaterThan(before));
      expect(find.byKey(const Key('goal-composer-title')), findsOneWidget);
    });

    testWidgets('an existing Pod skips podEnsure and opens the composer directly',
        (tester) async {      final gateway = _FakeGateway();
      _stubWorkSurface(gateway);
      gateway.on(
        'GET',
        '/api/projects/$_dirA/pod/lookup',
        (_) => _json(_podDetailJson()),
      );

      await _pumpWorkTab(
        tester,
        client: gateway.client,
        store: await _storeFor(_dirA),
      );

      await tester.tap(find.byKey(const Key('work-fab')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('goal-composer-title')), findsOneWidget);
      expect(
        gateway.calls.where(
          (call) =>
              call.method == 'POST' && call.path == '/api/projects/$_dirA/pod',
        ),
        isEmpty,
      );
    });

    testWidgets('an over-old gateway gets a distinct actionable message',
        (tester) async {
      final gateway = _FakeGateway();
      _stubWorkSurface(gateway);
      gateway
        ..on(
          'GET',
          '/api/projects/$_dirA/pod/lookup',
          (_) => _json({'error': 'pod not found'}, 404),
        )
        // 无路由载荷的 404 = 老网关（Task 4/7 的 GatewayRouteMissingException 语义）。
        ..on('POST', '/api/projects/$_dirA/pod', (_) => http.Response('', 404));

      await _pumpWorkTab(
        tester,
        client: gateway.client,
        store: await _storeFor(_dirA),
      );

      await tester.tap(find.byKey(const Key('work-fab')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('goal-composer-title')), findsNothing);
      expect(find.textContaining('网关版本过旧'), findsOneWidget);
      expect(find.textContaining('创建鲸群失败'), findsNothing);
    });

    testWidgets('a real Pod creation failure keeps the server message', (tester) async {
      final gateway = _FakeGateway();
      _stubWorkSurface(gateway);
      gateway
        ..on(
          'GET',
          '/api/projects/$_dirA/pod/lookup',
          (_) => _json({'error': 'pod not found'}, 404),
        )
        ..on(
          'POST',
          '/api/projects/$_dirA/pod',
          (_) => _json({'error': 'project is not registered: $_dirA'}, 404),
        );

      await _pumpWorkTab(
        tester,
        client: gateway.client,
        store: await _storeFor(_dirA),
      );

      await tester.tap(find.byKey(const Key('work-fab')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('goal-composer-title')), findsNothing);
      expect(find.textContaining('创建鲸群失败'), findsOneWidget);
      expect(find.textContaining('project is not registered'), findsOneWidget);
      expect(find.textContaining('网关版本过旧'), findsNothing);
    });

    testWidgets('an unconfigured gateway says so instead of pretending to create',
        (tester) async {
      await _pumpWorkTab(
        tester,
        client: null,
        store: await _storeFor(_dirA),
      );

      await tester.tap(find.byKey(const Key('work-fab')));
      await tester.pumpAndSettle();

      expect(find.textContaining('未配置 Gateway'), findsWidgets);
      expect(find.byKey(const Key('goal-composer-title')), findsNothing);
    });

    testWidgets('the FAB asks for a project when none is registered', (tester) async {
      final gateway = _FakeGateway()
        ..on('GET', '/api/projects', (_) => _json({'projects': <dynamic>[]}))
        ..on('GET', '/api/presence', (_) => _json(_presenceJson()));

      await _pumpWorkTab(
        tester,
        client: gateway.client,
        store: ActiveProjectStore(prefsKey: 'goal-composer-test-empty'),
      );

      await tester.tap(find.byKey(const Key('work-fab')));
      await tester.pumpAndSettle();

      expect(
        find.descendant(
          of: find.byType(SnackBar),
          matching: find.text('还没有已注册的项目'),
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('goal-composer-title')), findsNothing);
    });
  });
}
