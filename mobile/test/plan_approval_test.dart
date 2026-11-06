/// Orcalore Plan 批准（需要你形态一，Task 9）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.4（Plan 批准：`GET /api/goals/:id/plan` → waves + goalEval + hashes →
/// `POST /api/goals/:id/plan-approval {approve, approvalId, planHash, evalHash}`；
/// 不匹配 409 `stale_plan` → 提示重拉）。
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 9.
///
/// Contract pinned here（字段名实读 `gateway/src/routes/goal-plan.ts` 与
/// `gateway/src/core/goal/{goal-eval,plan-package,wave-plan-edit}.ts`）：
/// - `GET /plan` 响应：`{planReview, planApproval{id,status,...}, planFeedback,
///   round, revision, waves{status,taskType,waves[]}, goalEval{outcome,conditions[]},
///   planHash, evalHash, stale}`；
/// - waves 任务两种形态：字符串 / `{taskId?, title, acceptance[]}`；
/// - 批准体四字段（approve + approvalId + planHash + evalHash）；**空值字段必须省略**
///   （服务端 `matchesApproval` 要求 legacy 无 id 时 `approvalId === undefined`，
///   `assertApprovalFresh` 把 `''` 当成真实期望哈希 → 误判 stale）；
/// - 驳回 = 同端点 `approve:false` + `feedback`（服务端 `reject requires feedback`，
///   空反馈本地拦下不发请求）；
/// - 409 `{code:'stale_plan'}` → `StalePlanException`；其它 409（非 pending /
///   approvalId 错）不是 stale；
/// - 卡片挂载点 = Goal 详情的「需要你」slot，仅在 `stageKind == 'plan_approval'` 且
///   计划可读时渲染；
/// - 调色板纪律：mint 只用于 CTA（批准）；waves/Goal Eval 内容全部中性。
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/plan_models.dart';
import 'package:orcalore_mobile/src/models/pod_models.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';
import 'package:orcalore_mobile/src/pages/goal_detail_page.dart';
import 'package:orcalore_mobile/src/theme.dart';
import 'package:orcalore_mobile/src/widgets/plan_approval_card.dart';

const String _goalId = 'g1';
const String _podId = 'pod-1';
const String _planHash = 'ph-1';
const String _evalHash = 'eh-1';
const String _approvalId = 'appr-1';

// ── Fixtures（形状与 `gateway/src/routes/goal-plan.ts` 响应逐字对齐）───────────

/// `GET /api/goals/:id/plan` 的响应体。
Map<String, dynamic> _planJson({
  String? approvalId = _approvalId,
  String approvalStatus = 'pending',
  String planHash = _planHash,
  String evalHash = _evalHash,
  bool stale = false,
  String? planFeedback,
  bool withGoalEval = true,
  dynamic waves,
}) {
  return {
    'planReview': 'manual',
    'planApproval': {
      'id': approvalId,
      'status': approvalStatus,
      'round': 1,
      'revision': 2,
      'planHash': planHash,
      'evalHash': evalHash,
      'decidedAt': null,
    },
    'planFeedback': planFeedback,
    'round': 1,
    'revision': 2,
    'waves': waves ??
        {
          'status': 'ready',
          'strategy': 'collaborative',
          'taskType': 'feature',
          'waves': [
            {
              'id': 'w1',
              'title': '地基',
              'riskNote': '接口变更会波及旧调用方',
              'tasks': [
                {
                  'taskId': 'w1-t1',
                  'title': '重写输入栏',
                  'acceptance': ['空输入禁用发送', '附件上送不丢'],
                },
                '补一条字符串任务',
              ],
            },
            {
              'id': 'w2',
              'title': '收尾',
              'tasks': [
                {'title': '端到端验收'},
              ],
            },
          ],
        },
    'wavePlanPath': null,
    'wavesPath': r'C:\work\proj\.mafw\goals\g1\revisions\g1\rev-2\waves.json',
    'goalEval': withGoalEval
        ? {
            'outcome': '手机能批准计划并进入实施',
            'conditions': [
              {
                'id': 'g1',
                'statement': '批准后时间线出现实施节点',
                'required': true,
                'evidence': '时间线截图',
                'method': '人工观察',
              },
              {
                'id': 'g2',
                'statement': '驳回会开新 revision',
                'required': false,
                'evidence': 'revision 历史',
                'method': '人工观察',
              },
            ],
            'failureConditions': ['批准后没有任何节点启动'],
            'constraints': ['不引入新的颜色语义'],
            'nonGoals': ['离线推送'],
            'mapping': {
              'g1': {
                'tasks': ['w1-t1'],
              },
            },
          }
        : null,
    'goalEvalPath': r'C:\work\proj\.mafw\goals\g1\revisions\g1\rev-2\goal-eval.json',
    'goalEvalError': null,
    'planHash': planHash,
    'evalHash': evalHash,
    'stale': stale,
  };
}

Map<String, dynamic> _goalViewJson({
  String? stageKind = 'plan_approval',
  int revision = 2,
}) {
  return {
    'goalId': _goalId,
    'title': '修 CI',
    'status': 'active',
    'bucket': 'needs_you',
    'revision': revision,
    'activeRevision': revision,
    'verdict': null,
    'resultReady': false,
    'strategy': 'collaborative',
    'stage': {'owner': 'person', 'kind': stageKind},
  };
}

Map<String, dynamic> _timelineJson() {
  return {
    'goal': {
      'goalId': _goalId,
      'title': '修 CI',
      'phase': 'PLANNING_AWAIT_APPROVAL',
      'round': 1,
      'maxRounds': 3,
      'verdict': null,
      'nextNode': null,
      'nextAction': 'AWAIT_PLAN_APPROVAL',
      'lastError': null,
      'updatedAt': '2026-11-06T05:00:00.000Z',
      'planReview': 'manual',
      'planApproval': null,
    },
    'nodes': [
      {
        'runId': '1-plan-1',
        'loop': 1,
        'node': 'plan',
        'attempt': 1,
        'status': 'succeeded',
        'sessionId': 'ses_plan',
        'startedAt': '2026-11-06T04:00:00.000Z',
        'finishedAt': '2026-11-06T04:00:12.500Z',
        'durationMs': 12500,
        'outcome': 'waves=2',
        'error': null,
      },
    ],
    'artifacts': {'wavesPath': null, 'receipts': <String>[], 'reviewsDir': null},
    'outcome': null,
  };
}

// ── Fake gateway（真 GatewayClient + MockClient：路径与载荷都可断言）──────────

class _FakeGateway {
  _FakeGateway({
    this.planJson,
    this.planStatus = 200,
    this.approvalStatus = 200,
    this.approvalErrorBody,
  });

  final Map<String, dynamic>? planJson;
  final int planStatus;
  final int approvalStatus;
  final Map<String, dynamic>? approvalErrorBody;

  final List<String> paths = <String>[];
  final List<Map<String, dynamic>> approvalBodies = <Map<String, dynamic>>[];

  late final GatewayClient client = GatewayClient(
    const ConnectionConfig(baseUrl: 'http://127.0.0.1:3000', apiToken: 'test-token'),
    httpClient: http_testing.MockClient(_handle),
  );

  Future<http.Response> _handle(http.Request request) async {
    final path = '/${request.url.pathSegments.join('/')}';
    paths.add(path);

    if (path == '/api/goals/$_goalId/plan' && request.method == 'GET') {
      if (planStatus != 200) {
        return _json({'error': 'goal state not found'}, planStatus);
      }
      return _json(planJson ?? _planJson());
    }
    if (path == '/api/goals/$_goalId/plan-approval' && request.method == 'POST') {
      approvalBodies.add(jsonDecode(request.body) as Map<String, dynamic>);
      if (approvalStatus != 200) {
        return _json(
          approvalErrorBody ?? {'error': 'plan approval is not pending (or goal is terminal)'},
          approvalStatus,
        );
      }
      return _json({'success': true});
    }
    if (path == '/api/goals/$_goalId/timeline') {
      return _json(_timelineJson());
    }
    if (path == '/api/pods/$_podId/goals/$_goalId/revisions') {
      return _json({
        'items': [
          {
            'id': 'rev-2',
            'podId': _podId,
            'goalId': _goalId,
            'revision': 2,
            'status': 'plan_review',
            'verdict': null,
            'directionStatus': 'none',
            'directionJson': null,
            'planHash': _planHash,
            'evalHash': _evalHash,
            'feedback': null,
            'priority': 0,
            'enqueuedAt': '2026-11-06T04:00:00.000Z',
            'startedAt': '2026-11-06T04:00:00.000Z',
            'endedAt': null,
          },
        ],
      });
    }
    if (path == '/api/pods/$_podId/goals/$_goalId/result') {
      return _json({'error': 'goal result not found'}, 404);
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

Future<void> _pumpCard(
  WidgetTester tester,
  _FakeGateway gateway, {
  GoalPlanInfo? plan,
  VoidCallback? onApproved,
  VoidCallback? onRejected,
  VoidCallback? onRefresh,
  String goalId = _goalId,
  double width = 440,
}) async {
  tester.view.physicalSize = Size(width, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final resolved = plan ?? GoalPlanInfo.fromJson(_planJson());
  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: Scaffold(
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(12),
        child: PlanApprovalCard(
          key: const Key('plan-approval-card'),
          client: gateway.client,
          goalId: goalId,
          plan: resolved,
          onApproved: onApproved,
          onRejected: onRejected,
          onRefresh: onRefresh,
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

Future<void> _pumpGoalDetail(
  WidgetTester tester,
  _FakeGateway gateway, {
  String? stageKind = 'plan_approval',
}) async {
  _sizeView(tester);
  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: GoalDetailPage(
      _podId,
      _goalId,
      client: gateway.client,
      initial: PodGoalView.fromJson(_goalViewJson(stageKind: stageKind)),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  group('client: goalPlan', () {
    test('parses waves / goalEval / hashes from the route payload', () async {
      final gateway = _FakeGateway(planJson: _planJson(planFeedback: '上一版太粗'));
      final plan = await gateway.client.goalPlan(_goalId);

      expect(gateway.paths, ['/api/goals/$_goalId/plan']);
      expect(plan.approvalId, _approvalId);
      expect(plan.approvalStatus, 'pending');
      expect(plan.pending, isTrue);
      expect(plan.planHash, _planHash);
      expect(plan.evalHash, _evalHash);
      expect(plan.revision, 2);
      expect(plan.planReview, 'manual');
      expect(plan.stale, isFalse);
      expect(plan.planFeedback, '上一版太粗');
      expect(plan.waves.map((w) => w.id), ['w1', 'w2']);
      expect(plan.waves.first.title, '地基');
      expect(plan.waves.first.riskNote, '接口变更会波及旧调用方');
      expect(plan.waves.first.tasks.length, 2);
      expect(plan.waves.first.tasks.first.taskId, 'w1-t1');
      expect(plan.waves.first.tasks.first.title, '重写输入栏');
      expect(plan.waves.first.tasks.first.acceptance, ['空输入禁用发送', '附件上送不丢']);
      // 字符串任务：标题保留，taskId 走 gateway 同款位置兜底 `w1-t2`。
      expect(plan.waves.first.tasks.last.title, '补一条字符串任务');
      expect(plan.waves.first.tasks.last.taskId, 'w1-t2');
      expect(plan.waves.first.tasks.last.acceptance, isEmpty);
      expect(plan.waves.last.tasks.single.taskId, 'w2-t1');
      expect(plan.taskCount, 3);

      final evalDoc = plan.goalEval;
      expect(evalDoc, isNotNull);
      expect(evalDoc!.outcome, '手机能批准计划并进入实施');
      expect(evalDoc.conditions.map((c) => c.id), ['g1', 'g2']);
      expect(evalDoc.conditions.first.statement, '批准后时间线出现实施节点');
      expect(evalDoc.conditions.first.required, isTrue);
      expect(evalDoc.conditions.first.evidence, '时间线截图');
      expect(evalDoc.conditions.first.method, '人工观察');
      expect(evalDoc.conditions.last.required, isFalse);
      expect(evalDoc.failureConditions, ['批准后没有任何节点启动']);
    });

    test('tolerates a plan whose waves payload is empty / absent', () async {
      final gateway = _FakeGateway(
        planJson: _planJson(waves: {'waves': <dynamic>[]}, withGoalEval: false),
      );
      final plan = await gateway.client.goalPlan(_goalId);

      expect(plan.waves, isEmpty);
      expect(plan.goalEval, isNull);
      expect(plan.approvalId, _approvalId);
    });

    test('maps the designed 404 to GoalStateMissingException', () async {
      final gateway = _FakeGateway(planStatus: 404);

      expect(
        gateway.client.goalPlan(_goalId),
        throwsA(isA<GoalStateMissingException>()),
      );
    });
  });

  group('client: planApproval', () {
    test('approve posts exactly approve + approvalId + planHash + evalHash', () async {
      final gateway = _FakeGateway();

      await gateway.client.planApproval(
        _goalId,
        approve: true,
        approvalId: _approvalId,
        planHash: _planHash,
        evalHash: _evalHash,
      );

      expect(gateway.paths, ['/api/goals/$_goalId/plan-approval']);
      expect(gateway.approvalBodies.single, {
        'approve': true,
        'approvalId': _approvalId,
        'planHash': _planHash,
        'evalHash': _evalHash,
      });
    });

    test('legacy approvals omit empty ids/hashes instead of sending ""', () async {
      // 服务端：legacy 无 id 时要求 approvalId === undefined；
      // '' 会被当成真实期望哈希 → 误判 stale。
      final gateway = _FakeGateway();

      await gateway.client.planApproval(
        _goalId,
        approve: true,
        approvalId: '',
        planHash: '',
        evalHash: '',
      );

      expect(gateway.approvalBodies.single, {'approve': true});
    });

    test('reject posts approve:false + feedback (server requires non-empty feedback)', () async {
      final gateway = _FakeGateway();

      await gateway.client.planApproval(
        _goalId,
        approve: false,
        approvalId: _approvalId,
        planHash: _planHash,
        evalHash: _evalHash,
        planFeedback: '  再加日志  ',
      );

      expect(gateway.approvalBodies.single, {
        'approve': false,
        'approvalId': _approvalId,
        'planHash': _planHash,
        'evalHash': _evalHash,
        'feedback': '再加日志',
      });
    });

    test('409 stale_plan becomes StalePlanException carrying fresh hashes', () async {
      final gateway = _FakeGateway(
        approvalStatus: 409,
        approvalErrorBody: {
          'error': 'plan content changed since approval was requested (plan)',
          'code': 'stale_plan',
          'planHash': 'ph-new',
          'evalHash': 'eh-new',
        },
      );

      await expectLater(
        gateway.client.planApproval(
          _goalId,
          approve: true,
          approvalId: _approvalId,
          planHash: _planHash,
          evalHash: _evalHash,
        ),
        throwsA(isA<StalePlanException>()
            .having((e) => e.planHash, 'planHash', 'ph-new')
            .having((e) => e.evalHash, 'evalHash', 'eh-new')
            .having((e) => e.statusCode, 'statusCode', 409)),
      );
    });

    test('other 409s are plain GatewayException (not stale)', () async {
      final gateway = _FakeGateway(
        approvalStatus: 409,
        approvalErrorBody: {'error': 'plan approval is not pending (or goal is terminal)'},
      );

      await expectLater(
        gateway.client.planApproval(
          _goalId,
          approve: true,
          approvalId: _approvalId,
          planHash: _planHash,
          evalHash: _evalHash,
        ),
        throwsA(isA<GatewayException>().having(
          (e) => e is StalePlanException,
          'isStale',
          isFalse,
        )),
      );
    });
  });

  group('card', () {
    testWidgets('renders waves summary, expands tasks, shows Goal Eval neutrally', (tester) async {
      await _pumpCard(tester, _FakeGateway());

      expect(find.byKey(const Key('plan-approval-card')), findsOneWidget);
      // waves 摘要：标题 + 任务数（折叠态不泄露任务标题）
      expect(find.textContaining('地基'), findsOneWidget);
      expect(find.textContaining('2 个任务'), findsOneWidget);
      expect(find.textContaining('收尾'), findsOneWidget);
      expect(find.textContaining('重写输入栏'), findsNothing);

      // Goal Eval 条目（必需/可选 + 陈述），中性色。
      expect(find.text('手机能批准计划并进入实施'), findsOneWidget);
      expect(find.textContaining('g1'), findsWidgets);
      expect(find.textContaining('批准后时间线出现实施节点'), findsOneWidget);
      expect(find.textContaining('g2'), findsWidgets);
      expect(find.textContaining('驳回会开新 revision'), findsOneWidget);

      final waveTitle = tester.widget<Text>(find.textContaining('地基').first);
      expect(waveTitle.style?.color, isNot(MafwPalette.accent),
          reason: 'mint 只用于 CTA/需要你，wave 标题必须中性');

      // 展开 wave：任务标题 + 验收标准
      await tester.tap(find.byKey(const Key('plan-wave:w1')));
      await tester.pumpAndSettle();
      expect(find.textContaining('重写输入栏'), findsOneWidget);
      expect(find.textContaining('空输入禁用发送'), findsOneWidget);
      expect(find.textContaining('补一条字符串任务'), findsOneWidget);

      // 收起
      await tester.tap(find.byKey(const Key('plan-wave:w1')));
      await tester.pumpAndSettle();
      expect(find.textContaining('重写输入栏'), findsNothing);

      // 批准是唯一 mint CTA
      final approve = find.byKey(const Key('plan-approve'));
      expect(approve, findsOneWidget);
      expect(tester.widget<FilledButton>(approve), isNotNull);
      expect(find.byKey(const Key('plan-reject')), findsOneWidget);
    });

    testWidgets('approve posts the four fields then calls onApproved', (tester) async {
      final gateway = _FakeGateway();
      var approved = 0;
      var refreshed = 0;
      await _pumpCard(
        tester,
        gateway,
        onApproved: () => approved++,
        onRefresh: () => refreshed++,
      );

      await tester.tap(find.byKey(const Key('plan-approve')));
      await tester.pumpAndSettle();

      expect(gateway.approvalBodies.single, {
        'approve': true,
        'approvalId': _approvalId,
        'planHash': _planHash,
        'evalHash': _evalHash,
      });
      expect(approved, 1);
      expect(refreshed, 0);
    });

    testWidgets('reject requires feedback locally, then posts it', (tester) async {
      final gateway = _FakeGateway();
      var rejected = 0;
      await _pumpCard(tester, gateway, onRejected: () => rejected++);

      await tester.tap(find.byKey(const Key('plan-reject')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('plan-reject-input')), findsOneWidget);

      // 空反馈：本地拦下（服务端 400 reject requires feedback）
      await tester.tap(find.byKey(const Key('plan-reject-submit')));
      await tester.pumpAndSettle();
      expect(find.text('请填写驳回原因'), findsOneWidget);
      expect(gateway.approvalBodies, isEmpty);

      await tester.enterText(find.byKey(const Key('plan-reject-input')), '再加日志');
      await tester.tap(find.byKey(const Key('plan-reject-submit')));
      await tester.pumpAndSettle();

      expect(gateway.approvalBodies.single, {
        'approve': false,
        'approvalId': _approvalId,
        'planHash': _planHash,
        'evalHash': _evalHash,
        'feedback': '再加日志',
      });
      expect(rejected, 1);
    });

    testWidgets('409 stale_plan shows the re-pull message and calls onRefresh', (tester) async {
      final gateway = _FakeGateway(
        approvalStatus: 409,
        approvalErrorBody: {
          'error': 'plan content changed since approval was requested (plan)',
          'code': 'stale_plan',
          'planHash': 'ph-new',
          'evalHash': 'eh-new',
        },
      );
      var approved = 0;
      var refreshed = 0;
      await _pumpCard(
        tester,
        gateway,
        onApproved: () => approved++,
        onRefresh: () => refreshed++,
      );

      await tester.tap(find.byKey(const Key('plan-approve')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan-stale-notice')), findsOneWidget);
      expect(find.textContaining('计划已更新'), findsOneWidget);
      expect(refreshed, 1);
      expect(approved, 0);
      // 有明确提示的失败不是成功：批准入口仍可重试（刷新后是新的 hash）。
      expect(find.byKey(const Key('plan-approve')), findsOneWidget);
    });

    testWidgets('a non-stale failure shows the server message without the stale notice',
        (tester) async {
      final gateway = _FakeGateway(
        approvalStatus: 409,
        approvalErrorBody: {'error': 'plan approval is not pending (or goal is terminal)'},
      );
      await _pumpCard(tester, gateway);

      await tester.tap(find.byKey(const Key('plan-approve')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan-stale-notice')), findsNothing);
      expect(find.textContaining('plan approval is not pending'), findsOneWidget);
    });

    testWidgets('lays out at a 320dp phone width without overflow', (tester) async {
      // 窄机（320dp）+ 长 wave 标题 + 两位数任务数：Header 行必须 ellipsis，
      // 不能 RenderFlex overflow（Flutter 会把它抛成异常）。
      final plan = GoalPlanInfo.fromJson(_planJson(waves: {
        'waves': [
          {
            'id': 'w1',
            'title': '重写输入栏、附件菜单与窄窗档位（很长很长的一整段标题）',
            'tasks': [
              for (var i = 1; i <= 12; i++) {'taskId': 'w1-t$i', 'title': '任务 $i'},
            ],
          },
        ],
      }));

      await _pumpCard(tester, _FakeGateway(), plan: plan, width: 320);

      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('plan-approve')), findsOneWidget);
    });
  });

  group('goal detail slot', () {
    testWidgets('renders the card inside 需要你 only for stageKind plan_approval',
        (tester) async {
      final gateway = _FakeGateway();

      await _pumpGoalDetail(tester, gateway);

      expect(find.byKey(const Key('goal-attention-slot')), findsOneWidget);
      expect(find.byKey(const Key('plan-approval-card')), findsOneWidget);
      expect(gateway.paths, contains('/api/goals/$_goalId/plan'));
      expect(find.byKey(const Key('plan-approve')), findsOneWidget);
    });

    testWidgets('does not fetch or render the plan card for other stages', (tester) async {
      final gateway = _FakeGateway();

      await _pumpGoalDetail(tester, gateway, stageKind: 'implementing');

      expect(find.byKey(const Key('goal-attention-slot')), findsNothing);
      expect(find.byKey(const Key('plan-approval-card')), findsNothing);
      expect(gateway.paths, isNot(contains('/api/goals/$_goalId/plan')));
    });

    testWidgets('a missing plan (404) shows an honest empty state, not a card', (tester) async {
      final gateway = _FakeGateway(planStatus: 404);

      await _pumpGoalDetail(tester, gateway);

      expect(find.byKey(const Key('plan-missing')), findsOneWidget);
      expect(find.byKey(const Key('plan-approval-card')), findsNothing);
      expect(find.byKey(const Key('plan-approve')), findsNothing);
      // 整页不是错误页：头部与时间线照常可用。
      expect(find.text('修 CI'), findsOneWidget);
    });
  });
}
