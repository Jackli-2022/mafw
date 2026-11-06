/// Orcalore Goal 详情页（Task 8 重写）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.3（Goal 详情 = 审计轨迹：时间线 / revision 历史 / 结果证据 / 打回）。
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 8.
///
/// Contract pinned here:
/// - 头部：title + **中性**阶段徽标（`MafwPalette.badgeText` 字 / badgeBg 底）+
///   `r<n>` + strategy + verdict；
/// - 节点时间线（`GET /api/goals/:id/timeline`）：done = 白实心 ✓、active = mint 环、
///   pending = 灰空心；节点可展开看 attempt / 耗时 / verdict；
/// - 无 state（404）= 可操作空态「还没有执行记录」，不是整页错误；
/// - 版本历史（`GET /api/pods/:podId/goals/:goalId/revisions`）按 revision 倒序；
/// - 结果区（`GET .../result`）：verdict / 验收 / 证据 / 产物 + 打回入口
///   （`POST .../reject` → 「已开启 revision N+1」并刷新）；
/// - **legacy `/api/goals/:id` 旧形状不再被请求**（负断言：请求路径集合）；
/// - `podId` 为 null 时页面自行 `podLookup(projectDir)` 解析 Pod。
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

const String _podId = 'pod-1';
const String _goalId = 'g1';
const String _projectDir = r'C:\work\proj';

// ── Fixtures（形状与 gateway 路由文件逐字对齐）────────────────────────────────

Map<String, dynamic> _goalViewJson({
  String title = '修 CI',
  String status = 'active',
  String bucket = 'in_progress',
  int revision = 2,
  String? verdict,
  String? strategy = 'collaborative',
  String? stageKind = 'implementing',
  String stageOwner = 'team',
  bool resultReady = false,
}) {
  return {
    'goalId': _goalId,
    'title': title,
    'status': status,
    'bucket': bucket,
    'revision': revision,
    'activeRevision': revision,
    'verdict': verdict,
    'resultReady': resultReady,
    'strategy': strategy,
    'stage': {'owner': stageOwner, 'kind': stageKind},
  };
}

/// `goal_node_runs` 行（`gateway/src/routes/goal-timeline.ts` nodes[]）。
Map<String, dynamic> _nodeJson(
  String node,
  String status, {
  int loop = 1,
  int attempt = 1,
  int? durationMs = 12500,
  String? outcome,
  String? error,
}) {
  return {
    'runId': '$loop-$node-$attempt',
    'loop': loop,
    'node': node,
    'attempt': attempt,
    'status': status,
    'sessionId': 'ses_$node',
    'startedAt': '2026-11-06T04:00:00.000Z',
    'finishedAt': '2026-11-06T04:00:12.500Z',
    'durationMs': durationMs,
    'outcome': outcome,
    'error': error,
    'tokensInput': 10,
    'tokensOutput': 20,
    'costUsd': 0.01,
  };
}

Map<String, dynamic> _timelineJson({
  String title = '修 CI',
  String nextAction = 'RUNNING_execute',
  String? nextNode = 'execute',
  String? verdict,
  String? phase = 'EXECUTING',
  int round = 1,
  List<Map<String, dynamic>>? nodes,
}) {
  return {
    'goal': {
      'goalId': _goalId,
      'title': title,
      'phase': phase,
      'round': round,
      'maxRounds': 3,
      'verdict': verdict,
      'nextNode': nextNode,
      'nextAction': nextAction,
      'lastError': null,
      'updatedAt': '2026-11-06T05:00:00.000Z',
      'planReview': 'manual',
      'planApproval': null,
    },
    'nodes': nodes ??
        [
          _nodeJson('plan', 'succeeded', durationMs: 4200, outcome: 'PASS'),
          _nodeJson('execute', 'running', durationMs: null),
        ],
    'artifacts': {
      'wavesPath': r'C:\work\proj\.mafw\goals\g1\waves.json',
      'receipts': [],
      'reviewsDir': r'C:\work\proj\.mafw\goals\g1\reviews',
    },
    'outcome': null,
  };
}

Map<String, dynamic> _revisionJson(
  int revision,
  String status, {
  String? verdict,
  String? feedback,
}) {
  return {
    'id': 'rev-$revision',
    'podId': _podId,
    'goalId': _goalId,
    'revision': revision,
    'status': status,
    'verdict': verdict,
    'directionStatus': 'none',
    'directionJson': null,
    'planHash': null,
    'evalHash': null,
    'feedback': feedback,
    'priority': 0,
    'enqueuedAt': '2026-11-06T04:00:00.000Z',
    'startedAt': '2026-11-06T04:00:00.000Z',
    'endedAt': revision == 1 ? '2026-11-06T05:00:00.000Z' : null,
  };
}

/// `PodGoalResult`（`gateway/src/core/pod/pod-result.ts`）。
Map<String, dynamic> _resultJson() {
  return {
    'goalId': _goalId,
    'revision': 1,
    'verdict': 'PASS',
    'resultReady': true,
    'reviewed': true,
    'assessment': 'reviewed',
    'goalAcceptance': ['页面能打开'],
    'goalConditions': [
      {
        'id': 'g1',
        'statement': '打开详情页不报错',
        'required': true,
        'evidence': '人工截图',
        'method': 'manual',
      },
    ],
    'goalResults': [
      {'conditionId': 'g1', 'result': 'pass', 'evidence': '截图已附'},
    ],
    'goalEvalValid': true,
    'failure': null,
    'tasks': [
      {'taskId': 'w1-t1', 'result': 'pass', 'evidence': '测试全绿'},
    ],
    'reviewFeedback': '全部通过',
    'receipt': null,
    'artifacts': [r'C:\work\proj\.mafw\goals\g1\loop-1-receipt.json'],
  };
}

Map<String, dynamic> _podLookupJson() {
  return {
    'pod': {'id': _podId, 'projectDir': _projectDir, 'name': 'proj', 'status': 'active'},
    'members': <dynamic>[],
    'goals': [_goalViewJson()],
    'tasks': <dynamic>[],
    'sessions': <dynamic>[],
    'attention': <dynamic>[],
    'messageHealth': <dynamic>[],
  };
}

// ── Fake gateway（真 GatewayClient + MockClient：路径与载荷都可断言）───────────

class _FakeGateway {
  _FakeGateway({
    this.timelineJson,
    this.timelineStatus = 200,
    this.revisionsJson,
    this.resultJson,
    this.resultStatus = 200,
    this.podJson,
  });

  final Map<String, dynamic>? timelineJson;
  final int timelineStatus;
  final List<Map<String, dynamic>>? revisionsJson;
  final Map<String, dynamic>? resultJson;
  final int resultStatus;
  final Map<String, dynamic>? podJson;

  /// 每次请求的解码路径（`/api/goals/g1/timeline` 等）。
  final List<String> paths = <String>[];
  final List<Map<String, dynamic>> rejectBodies = <Map<String, dynamic>>[];
  int timelineCalls = 0;

  late final GatewayClient client = GatewayClient(
    const ConnectionConfig(baseUrl: 'http://127.0.0.1:3000', apiToken: 'test-token'),
    httpClient: http_testing.MockClient(_handle),
  );

  Future<http.Response> _handle(http.Request request) async {
    // pathSegments 已解码，Windows 项目目录（含 `:` / `\`）可原样比较。
    final path = '/${request.url.pathSegments.join('/')}';
    paths.add(path);

    if (path == '/api/goals/$_goalId/timeline') {
      timelineCalls++;
      if (timelineStatus != 200) {
        return _json({'error': 'goal state not found'}, timelineStatus);
      }
      return _json(timelineJson ?? _timelineJson());
    }
    if (path == '/api/pods/$_podId/goals/$_goalId/revisions') {
      return _json({'items': revisionsJson ?? const <Map<String, dynamic>>[]});
    }
    if (path == '/api/pods/$_podId/goals/$_goalId/result') {
      if (resultStatus != 200) {
        return _json({'error': 'goal result not found'}, resultStatus);
      }
      return _json(resultJson ?? _resultJson());
    }
    if (path == '/api/pods/$_podId/goals/$_goalId/reject' && request.method == 'POST') {
      rejectBodies.add(jsonDecode(request.body) as Map<String, dynamic>);
      return _json({
        'podId': _podId,
        'goalId': _goalId,
        'revision': 2,
        'status': 'discussing',
        'feedback': '再加日志',
      });
    }
    if (path == '/api/projects/$_projectDir/pod/lookup') {
      final pod = podJson;
      if (pod == null) return _json({'error': 'pod not found'}, 404);
      return _json(pod);
    }
    return _json({'error': 'unexpected ${request.method} $path'}, 500);
  }
}

http.Response _json(Object body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

// ── Harness ─────────────────────────────────────────────────────────────────

void _sizeView(WidgetTester tester) {
  tester.view.physicalSize = const Size(440, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpPage(
  WidgetTester tester,
  _FakeGateway gateway, {
  PodGoalView? initial,
  String? podId = _podId,
  String? projectDir,
  GoalAttentionSlotBuilder? attentionSlot,
  VoidCallback? onDiscussWithTechLead,
}) async {
  _sizeView(tester);
  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: GoalDetailPage(
      podId,
      _goalId,
      client: gateway.client,
      projectDir: projectDir,
      initial: initial,
      attentionSlot: attentionSlot,
      onDiscussWithTechLead: onDiscussWithTechLead,
    ),
  ));
  await tester.pumpAndSettle();
}

BoxDecoration _decorationOf(WidgetTester tester, String key) {
  // key 落在 `_NodeMarker` 组件上；断言的是它内部的状态圆点 Container。
  final container = tester.widget<Container>(
    find
        .descendant(of: find.byKey(Key(key)), matching: find.byType(Container))
        .first,
  );
  return container.decoration! as BoxDecoration;
}

void main() {
  group('client endpoints', () {
    test('goalTimeline parses goal / nodes / artifacts', () async {
      final gateway = _FakeGateway(
        timelineJson: _timelineJson(nodes: [
          _nodeJson('plan', 'succeeded', outcome: 'PASS'),
          _nodeJson('execute', 'running', durationMs: null),
        ]),
      );

      final timeline = await gateway.client.goalTimeline(_goalId);

      expect(gateway.paths, ['/api/goals/$_goalId/timeline']);
      expect(timeline.goalId, _goalId);
      expect(timeline.title, '修 CI');
      expect(timeline.nextAction, 'RUNNING_execute');
      expect(timeline.nextNode, 'execute');
      expect(timeline.round, 1);
      expect(timeline.terminal, isFalse);
      expect(timeline.nodes.map((n) => n.node), ['plan', 'execute']);
      expect(timeline.nodes.first.status, 'succeeded');
      expect(timeline.nodes.first.durationMs, 12500);
      expect(timeline.nodes.last.durationMs, isNull);
      expect(timeline.receipts, isEmpty);
    });

    test('goalTimeline maps a 404 "goal state not found" to GoalStateMissingException', () async {
      final gateway = _FakeGateway(timelineStatus: 404);

      expect(
        gateway.client.goalTimeline(_goalId),
        throwsA(isA<GoalStateMissingException>()),
      );
    });

    test('goalRevisions parses items and tolerates absent fields', () async {
      final gateway = _FakeGateway(revisionsJson: [
        _revisionJson(1, 'completed', verdict: 'PASS'),
        _revisionJson(2, 'discussing', feedback: '再加日志'),
        {'revision': 3},
      ]);

      final revisions = await gateway.client.goalRevisions(_podId, _goalId);

      expect(gateway.paths, ['/api/pods/$_podId/goals/$_goalId/revisions']);
      expect(revisions.map((r) => r.revision), [1, 2, 3]);
      expect(revisions[0].status, 'completed');
      expect(revisions[0].verdict, 'PASS');
      expect(revisions[1].feedback, '再加日志');
      expect(revisions[2].status, isEmpty);
      expect(revisions[2].verdict, isNull);
    });

    test('goalResult merges eval conditions with reviewer evidence', () async {
      final gateway = _FakeGateway(resultJson: _resultJson());

      final result = await gateway.client.goalResult(_podId, _goalId);

      expect(gateway.paths, ['/api/pods/$_podId/goals/$_goalId/result']);
      expect(result, isNotNull);
      expect(result!.verdict, 'PASS');
      expect(result.assessment, 'reviewed');
      expect(result.acceptance, ['页面能打开']);
      expect(result.conditions.single.id, 'g1');
      expect(result.conditions.single.required, isTrue);
      expect(result.conditions.single.statement, '打开详情页不报错');
      expect(result.conditions.single.result, 'pass');
      expect(result.conditions.single.evidence, '截图已附');
      expect(result.tasks.single.taskId, 'w1-t1');
      expect(result.tasks.single.result, 'pass');
      expect(result.tasks.single.evidence, '测试全绿');
      expect(result.feedback, '全部通过');
      expect(result.artifacts.single, endsWith('loop-1-receipt.json'));
    });

    test('goalResult returns null when the goal has no state yet', () async {
      final gateway = _FakeGateway(resultStatus: 404);

      expect(await gateway.client.goalResult(_podId, _goalId), isNull);
    });

    test('rejectGoal POSTs the feedback and returns the new revision', () async {
      final gateway = _FakeGateway();

      final rejected = await gateway.client.rejectGoal(_podId, _goalId, '再加日志');

      expect(gateway.paths, ['/api/pods/$_podId/goals/$_goalId/reject']);
      expect(gateway.rejectBodies.single, {'feedback': '再加日志'});
      expect(rejected.revision, 2);
      expect(rejected.status, 'discussing');
    });
  });

  group('header + stage badge', () {
    testWidgets('renders title, neutral stage badge, revision and strategy', (tester) async {
      final gateway = _FakeGateway(
        revisionsJson: [_revisionJson(2, 'implementing')],
      );

      await _pumpPage(tester, gateway, initial: PodGoalView.fromJson(_goalViewJson()));

      expect(find.text('修 CI'), findsOneWidget);
      expect(find.text('实施中'), findsOneWidget);
      expect(find.text('r2'), findsOneWidget);
      expect(find.text('collaborative'), findsOneWidget);

      // 阶段徽标必须中性：badgeText 字（mint 只属于 active/CTA/需要你）。
      final badge = tester.widget<Text>(find.descendant(
        of: find.byKey(const Key('goal-stage-badge')),
        matching: find.byType(Text),
      ));
      expect(badge.style?.color, MafwPalette.badgeText);
      expect(badge.style?.color, isNot(MafwPalette.accent));
    });

    testWidgets('falls back to the timeline title when no Goal row was seeded', (tester) async {
      final gateway = _FakeGateway();

      await _pumpPage(tester, gateway, podId: null);

      expect(find.text('修 CI'), findsOneWidget);
      expect(find.text('未命名目标'), findsNothing);
    });
  });

  group('node timeline', () {
    testWidgets('renders done / active / pending node markers', (tester) async {
      final gateway = _FakeGateway(
        revisionsJson: [_revisionJson(2, 'implementing')],
      );

      await _pumpPage(tester, gateway, initial: PodGoalView.fromJson(_goalViewJson()));

      // 三态各一行：plan=succeeded、execute=running、review 未开始（pending）。
      expect(find.byKey(const Key('goal-node:1:plan')), findsOneWidget);
      expect(find.byKey(const Key('goal-node:1:execute')), findsOneWidget);
      expect(find.byKey(const Key('goal-node:1:review')), findsOneWidget);

      // done = 白实心（cream 填充）
      expect(_decorationOf(tester, 'goal-node-marker:1:plan').color, MafwPalette.text);
      // active = mint 环
      expect(
        _decorationOf(tester, 'goal-node-marker:1:execute').border?.top.color,
        MafwPalette.accent,
      );
      // pending = 灰空心
      expect(
        _decorationOf(tester, 'goal-node-marker:1:review').border?.top.color,
        MafwPalette.faint,
      );
      // done 的勾是白底上的黑勾（不引入绿色）
      final check = tester.widget<Icon>(find.descendant(
        of: find.byKey(const Key('goal-node-marker:1:plan')),
        matching: find.byType(Icon),
      ));
      expect(check.icon, Icons.check);
      expect(check.color, MafwPalette.black);
    });

    testWidgets('expanding a node shows attempt number, duration and verdict', (tester) async {
      final gateway = _FakeGateway(
        timelineJson: _timelineJson(nodes: [
          _nodeJson('plan', 'failed',
              attempt: 1, durationMs: 900, error: 'model 429'),
          _nodeJson('plan', 'succeeded',
              attempt: 2, durationMs: 12500, outcome: 'PASS'),
          _nodeJson('execute', 'running', durationMs: null),
        ]),
      );

      await _pumpPage(tester, gateway, initial: PodGoalView.fromJson(_goalViewJson()));

      // 折叠态不显示 attempt 明细
      expect(find.textContaining('attempt 1'), findsNothing);

      await tester.tap(find.byKey(const Key('goal-node:1:plan')));
      await tester.pumpAndSettle();

      expect(find.textContaining('attempt 1'), findsOneWidget);
      expect(find.textContaining('attempt 2'), findsOneWidget);
      expect(find.textContaining('900ms'), findsOneWidget);
      expect(find.textContaining('12.5s'), findsOneWidget);
      // 每次 attempt 的结论/verdict 与错误原文都在同一行/下一行披露。
      expect(find.text('attempt 2 · 12.5s · PASS'), findsOneWidget);
      expect(find.textContaining('model 429'), findsOneWidget);

      await tester.tap(find.byKey(const Key('goal-node:1:plan')));
      await tester.pumpAndSettle();
      expect(find.textContaining('attempt 1'), findsNothing);
    });

    testWidgets('a goal without state shows an actionable empty state, not an error page',
        (tester) async {
      final gateway = _FakeGateway(timelineStatus: 404, resultStatus: 404);
      final discussing = PodGoalView.fromJson(_goalViewJson(
        status: 'active',
        bucket: 'needs_you',
        stageKind: 'discussing',
        revision: 1,
      ));

      await _pumpPage(tester, gateway, initial: discussing);

      expect(find.text('还没有执行记录'), findsOneWidget);
      expect(find.textContaining('规划'), findsWidgets);
      // 头部仍可用（不是整页失败）
      expect(find.text('修 CI'), findsOneWidget);
      expect(find.text('讨论中'), findsOneWidget);
    });

    testWidgets('never requests the legacy /api/goals/:id shape', (tester) async {
      final gateway = _FakeGateway();

      await _pumpPage(tester, gateway, initial: PodGoalView.fromJson(_goalViewJson()));

      expect(gateway.paths, contains('/api/goals/$_goalId/timeline'));
      expect(
        gateway.paths.where((path) => RegExp(r'^/api/goals/[^/]+$').hasMatch(path)),
        isEmpty,
        reason: 'Task 8 之后不得再请求 legacy /api/goals/:id（字段全不命中）',
      );
      expect(gateway.paths, isNot(contains('/api/goals')));
    });

    testWidgets('the current action bar reads timeline.goal.nextAction', (tester) async {
      final gateway = _FakeGateway();

      await _pumpPage(tester, gateway, initial: PodGoalView.fromJson(_goalViewJson()));

      expect(find.byKey(const Key('goal-action-bar')), findsOneWidget);
      expect(find.text('正在实施'), findsOneWidget);
      expect(find.textContaining('第 1 轮'), findsOneWidget);
    });
  });

  group('revision history', () {
    testWidgets('renders revisions newest first with neutral status text', (tester) async {
      final gateway = _FakeGateway(revisionsJson: [
        _revisionJson(1, 'completed', verdict: 'PASS'),
        _revisionJson(2, 'discussing', feedback: '再加日志'),
      ]);

      await _pumpPage(tester, gateway, initial: PodGoalView.fromJson(_goalViewJson()));

      expect(find.text('版本历史'), findsOneWidget);
      expect(find.text('r2 · 讨论中'), findsOneWidget);
      expect(find.text('r1 · 已完成'), findsOneWidget);

      // 倒序：r2 在 r1 之前
      final r2 = tester.getTopLeft(find.text('r2 · 讨论中')).dy;
      final r1 = tester.getTopLeft(find.text('r1 · 已完成')).dy;
      expect(r2, lessThan(r1));
      // r2 的打回反馈可见
      expect(find.text('再加日志'), findsOneWidget);
    });
  });

  group('result + reject', () {
    Future<_FakeGateway> pumpTerminal(WidgetTester tester) async {
      final terminalGoal = _goalViewJson(
        status: 'done',
        bucket: 'result_ready',
        revision: 1,
        verdict: 'PASS',
        stageKind: 'result_notified',
        resultReady: true,
      );
      final gateway = _FakeGateway(
        timelineJson: _timelineJson(
          nextAction: 'COMPLETED',
          nextNode: null,
          verdict: 'PASS',
          phase: 'ARCHIVED',
          nodes: [
            _nodeJson('plan', 'succeeded', outcome: 'PASS'),
            _nodeJson('execute', 'succeeded', outcome: 'PASS'),
            _nodeJson('review', 'succeeded', outcome: 'PASS'),
          ],
        ),
        revisionsJson: [_revisionJson(1, 'completed', verdict: 'PASS')],
      );
      await _pumpPage(tester, gateway, initial: PodGoalView.fromJson(terminalGoal));
      return gateway;
    }

    testWidgets('renders verdict / acceptance / evidence / artifacts', (tester) async {
      await pumpTerminal(tester);

      expect(find.byKey(const Key('goal-result-card')), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('goal-result-verdict'))).data,
        'PASS',
      );
      expect(find.text('页面能打开'), findsOneWidget);
      expect(find.textContaining('w1-t1'), findsOneWidget);
      expect(find.textContaining('测试全绿'), findsOneWidget);
      expect(find.textContaining('截图已附'), findsOneWidget);
      expect(find.text('loop-1-receipt.json'), findsOneWidget);
      expect(find.text('全部通过'), findsOneWidget);
    });

    testWidgets('reject requires feedback then posts it and refreshes', (tester) async {
      final gateway = await pumpTerminal(tester);

      await tester.tap(find.byKey(const Key('goal-reject')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('goal-reject-input')), findsOneWidget);

      // 空反馈被本地拦下（不发请求）
      await tester.tap(find.byKey(const Key('goal-reject-submit')));
      await tester.pumpAndSettle();
      expect(find.text('请填写打回原因'), findsOneWidget);
      expect(gateway.rejectBodies, isEmpty);

      await tester.enterText(find.byKey(const Key('goal-reject-input')), '再加日志');
      await tester.tap(find.byKey(const Key('goal-reject-submit')));
      await tester.pumpAndSettle();

      expect(gateway.rejectBodies, [
        {'feedback': '再加日志'},
      ]);
      expect(find.text('已开启 revision 2'), findsOneWidget);
      // 成功后刷新时间线（revision N+1 立刻可见）
      expect(gateway.timelineCalls, 2);
    });

    testWidgets('a running revision hides a stale result payload', (tester) async {
      // 结果端点仍会返回上一版 PASS（打回后 state 重建前/缓存窗口），但当前
      // revision 还在 implementing —— 结果区必须让位给进行中的进度。
      final gateway = _FakeGateway(
        revisionsJson: [_revisionJson(2, 'implementing')],
      );

      await _pumpPage(tester, gateway, initial: PodGoalView.fromJson(_goalViewJson()));

      expect(gateway.paths, contains('/api/pods/$_podId/goals/$_goalId/result'));
      expect(find.byKey(const Key('goal-result-card')), findsNothing);
      expect(find.byKey(const Key('goal-reject')), findsNothing);
    });

    testWidgets('a cancelled goal has no result card and no reject', (tester) async {
      final cancelled = _goalViewJson(
        status: 'aborted',
        bucket: 'ended',
        revision: 1,
        verdict: 'CANCELLED',
        stageKind: 'ended',
      );
      final gateway = _FakeGateway(
        revisionsJson: [_revisionJson(1, 'aborted', verdict: 'CANCELLED')],
      );

      await _pumpPage(tester, gateway, initial: PodGoalView.fromJson(cancelled));

      expect(find.byKey(const Key('goal-result-card')), findsNothing);
      expect(find.byKey(const Key('goal-reject')), findsNothing);
      // 头部仍标记真实终态（中性 chip）。
      expect(find.text('CANCELLED'), findsWidgets);
    });
  });

  group('slots + navigation', () {
    testWidgets('reserves the 需要你 slot and the Tech Lead CTA', (tester) async {
      var discussed = 0;
      GoalAttentionContext? slotContext;
      final gateway = _FakeGateway();

      await _pumpPage(
        tester,
        gateway,
        initial: PodGoalView.fromJson(_goalViewJson()),
        attentionSlot: (context, slot) {
          slotContext = slot;
          return const Text('计划批准卡（Task 9 挂入）');
        },
        onDiscussWithTechLead: () => discussed++,
      );

      expect(find.text('需要你'), findsOneWidget);
      expect(find.text('计划批准卡（Task 9 挂入）'), findsOneWidget);
      // 组件位拿到解析后的 Pod / 当前 revision（Task 9/13 据此取计划与问题）。
      expect(slotContext?.podId, _podId);
      expect(slotContext?.goalId, _goalId);
      expect(slotContext?.revision, 2);
      expect(slotContext?.stageKind, 'implementing');
      expect(find.text('与 Tech Lead 讨论'), findsOneWidget);
      expect(find.text('讨论页将在下个版本接通'), findsNothing);

      await tester.tap(find.byKey(const Key('goal-tech-lead')));
      await tester.pumpAndSettle();
      expect(discussed, 1);
    });

    testWidgets('a null slot result hides the 需要你 block entirely', (tester) async {
      final gateway = _FakeGateway();

      await _pumpPage(
        tester,
        gateway,
        initial: PodGoalView.fromJson(_goalViewJson()),
        attentionSlot: (_, _) => null,
      );

      expect(find.byKey(const Key('goal-attention-slot')), findsNothing);
      expect(find.text('需要你'), findsNothing);
    });

    testWidgets('the Tech Lead CTA is a placeholder until Task 12 wires it', (tester) async {
      final gateway = _FakeGateway();

      await _pumpPage(tester, gateway, initial: PodGoalView.fromJson(_goalViewJson()));

      expect(find.text('需要你'), findsNothing);
      expect(find.byKey(const Key('goal-attention-slot')), findsNothing);
      expect(find.text('讨论页将在下个版本接通'), findsOneWidget);

      await tester.tap(find.byKey(const Key('goal-tech-lead')));
      await tester.pumpAndSettle();
      expect(find.text('与 Tech Lead 讨论将在下一版本接通'), findsOneWidget);
    });

    testWidgets('resolves the Pod through podLookup when podId is null', (tester) async {
      final gateway = _FakeGateway(podJson: _podLookupJson());

      await _pumpPage(
        tester,
        gateway,
        podId: null,
        projectDir: _projectDir,
      );

      expect(gateway.paths, contains('/api/projects/$_projectDir/pod/lookup'));
      // Pod 解析后，revisions / result 用真实 podId 请求
      expect(gateway.paths, contains('/api/pods/$_podId/goals/$_goalId/revisions'));
      expect(find.text('修 CI'), findsOneWidget);
      expect(find.text('r2'), findsOneWidget);
    });

    testWidgets('shows the connection error with a retry when the gateway is unreachable',
        (tester) async {
      final gateway = _FakeGateway(timelineStatus: 500);

      await _pumpPage(tester, gateway);

      expect(find.text('无法加载 Goal 详情'), findsOneWidget);
      expect(find.text('重试'), findsOneWidget);
    });
  });
}
