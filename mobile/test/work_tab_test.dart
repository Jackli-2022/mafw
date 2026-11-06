/// Orcalore「工作」tab（Task 7）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.2（3-tab）/ §7.3（工作 tab）/ §7.1（active 项目模型）。
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 7.
///
/// Contract pinned here:
/// - brand row = Lore 20px circle asset + `Orcalore` wordmark on the left,
///   project switcher on the right (`projects()` → bottom sheet);
/// - 需要你 = cross-project `presence().attention` cards. A tap on another
///   project's item switches `ActiveProjectStore` first, then calls
///   `onOpenGoal(projectId, goalId)`;
/// - five `work.overview` buckets render with neutral count badges;
/// - refresh = 15s poll + `WorkRefreshBus` (WS `onReconnected` / matching
///   events). An event refresh is a data refetch with a per-goalId patch, never
///   a new tab instance;
/// - three designed empty states (未配置 / 无项目 / 无 Pod) plus the Task 4
///   minor: an over-old gateway also 404s, so it gets its own message.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/models/pod_models.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';
import 'package:orcalore_mobile/src/pages/work_tab.dart';
import 'package:orcalore_mobile/src/services/active_project.dart';
import 'package:orcalore_mobile/src/services/work_refresh_bus.dart';
import 'package:orcalore_mobile/src/theme.dart';


const String _dirA = r'C:\work\projA';
const String _dirB = r'C:\work\projB';

// ── Fixtures ────────────────────────────────────────────────────────────────

Map<String, dynamic> _goal(
  String bucket,
  String goalId,
  String title, {
  String status = 'active',
  int revision = 1,
  String? verdict,
  String? strategy,
  String? stageKind,
  String stageOwner = 'team',
}) {
  return {
    'goalId': goalId,
    'title': title,
    'status': status,
    'bucket': bucket,
    'revision': revision,
    'verdict': verdict,
    'resultReady': bucket == 'result_ready',
    'strategy': strategy,
    'stage': {'owner': stageOwner, 'kind': stageKind},
  };
}

/// Five buckets, one Goal each (counts 1) — the layout contract in one fixture.
WorkOverview _overviewA({String dir = _dirA, String needsTitle = '修 CI'}) {
  return WorkOverview.fromJson({
    'projectDir': dir,
    'podId': 'pod-a',
    'groups': {
      'needs_you': [
        _goal('needs_you', 'g-need', needsTitle,
            revision: 2, strategy: 'collaborative', stageKind: 'plan_approval', stageOwner: 'person'),
      ],
      'queued': [
        _goal('queued', 'g-queued', '排队的', status: 'queued', stageKind: 'queued'),
      ],
      'in_progress': [
        _goal('in_progress', 'g-run', '跑着的', strategy: 'quick', stageKind: 'implementing'),
      ],
      'result_ready': [
        _goal('result_ready', 'g-done', '完成的',
            status: 'done', verdict: 'PASS', stageKind: 'result_notified'),
      ],
      'ended': [
        _goal('ended', 'g-end', '取消的',
            status: 'aborted', verdict: 'CANCELLED', stageKind: 'ended', stageOwner: 'system'),
      ],
    },
    'counts': {
      'needs_you': 1,
      'queued': 1,
      'in_progress': 1,
      'result_ready': 1,
      'ended': 1,
    },
    'total': 5,
  });
}

/// [_overviewA] with one more Goal in the **queued** bucket — proves the 15s
/// fallback poll publishes the whole snapshot instead of a stale goalId patch.
WorkOverview _overviewB() {
  return WorkOverview.fromJson({
    'projectDir': _dirA,
    'podId': 'pod-a',
    'groups': {
      'needs_you': [
        _goal('needs_you', 'g-need', '修 CI',
            revision: 2, strategy: 'collaborative', stageKind: 'plan_approval', stageOwner: 'person'),
      ],
      'queued': [
        _goal('queued', 'g-queued', '排队的', status: 'queued', stageKind: 'queued'),
        _goal('queued', 'g-new', '新目标', status: 'queued', stageKind: 'queued'),
      ],
      'in_progress': [
        _goal('in_progress', 'g-run', '跑着的', strategy: 'quick', stageKind: 'implementing'),
      ],
      'result_ready': [
        _goal('result_ready', 'g-done', '完成的',
            status: 'done', verdict: 'PASS', stageKind: 'result_notified'),
      ],
      'ended': [
        _goal('ended', 'g-end', '取消的',
            status: 'aborted', verdict: 'CANCELLED', stageKind: 'ended', stageOwner: 'system'),
      ],
    },
    'counts': {
      'needs_you': 1,
      'queued': 2,
      'in_progress': 1,
      'result_ready': 1,
      'ended': 1,
    },
    'total': 6,
  });
}

PresenceInfo _presence({
  List<Map<String, dynamic>> attention = const [],
  int unreadResults = 0,
  List<String> running = const [],
}) {
  return PresenceInfo.fromJson({
    'running': running,
    'attention': {'count': attention.length, 'items': attention},
    'unreadResults': {'count': unreadResults},
  });
}

Map<String, dynamic> _attentionItem({
  required String id,
  required String goalId,
  String kind = 'plan_approval',
  String title = '批准计划',
  String? projectId,
  String? podId,
  int revision = 1,
}) {
  return {
    'id': id,
    'goalId': goalId,
    'revision': revision,
    'kind': kind,
    'title': title,
    'projectId': ?projectId,
    'podId': ?podId,
  };
}

// ── Fake client ─────────────────────────────────────────────────────────────

class _FakeWorkClient extends GatewayClient {
  _FakeWorkClient({
    List<String>? projectDirs,
    Map<String, WorkOverview>? overviews,
    WorkOverview? fallbackOverview,
    PresenceInfo? presence,
    this.workError,
  })  : projectDirs = projectDirs ?? const <String>[_dirA],
        overviews = overviews ?? const <String, WorkOverview>{},
        fallbackOverview = fallbackOverview ?? _overviewA(),
        presenceInfo = presence ?? _presence(),
        super(const ConnectionConfig(
          baseUrl: 'http://127.0.0.1:3000',
          apiToken: 'test-token',
        ));

  final List<String> projectDirs;
  final Map<String, WorkOverview> overviews;
  final WorkOverview fallbackOverview;
  final PresenceInfo presenceInfo;
  final Object? workError;

  int projectCalls = 0;
  int workCalls = 0;
  int presenceCalls = 0;
  String? lastDir;
  final List<String> dirsRequested = [];

  @override
  Future<List<ProjectInfo>> projects() async {
    projectCalls++;
    return projectDirs.map((dir) => ProjectInfo(dir: dir)).toList();
  }

  @override
  Future<WorkOverview> workOverview(String projectDir) async {
    workCalls++;
    lastDir = projectDir;
    dirsRequested.add(projectDir);
    final error = workError;
    if (error != null) throw error;
    return overviews[projectDir] ?? fallbackOverview;
  }

  @override
  Future<PresenceInfo> presence() async {
    presenceCalls++;
    return presenceInfo;
  }

  @override
  Future<PodInfo?> podLookup(String projectDir) async => null;
}

// ── Harness ─────────────────────────────────────────────────────────────────

/// A phone-ish tall viewport so every bucket card is on screen for taps.
void _sizeView(WidgetTester tester) {
  tester.view.physicalSize = const Size(430, 1500);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<ActiveProjectStore> _pumpWorkTab(
  WidgetTester tester, {
  GatewayClient? client,
  ActiveProjectStore? store,
  WorkRefreshBus? bus,
  void Function(String projectId, String goalId)? onOpenGoal,
  VoidCallback? onCreateDiscussion,
  VoidCallback? onOpenLead,
  VoidCallback? onOpenSettings,
  Duration pollInterval = const Duration(seconds: 15),
  Duration refreshDebounce = const Duration(milliseconds: 250),
  bool settle = true,
}) async {
  _sizeView(tester);
  final active = store ?? ActiveProjectStore();
  await active.load();
  final workBus = bus ?? WorkRefreshBus();
  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: Scaffold(
      body: WorkTab(
        client: client,
        activeProject: active,
        refreshBus: workBus,
        onOpenGoal: onOpenGoal,
        onCreateDiscussion: onCreateDiscussion,
        onOpenLead: onOpenLead,
        onOpenSettings: onOpenSettings,
        pollInterval: pollInterval,
        refreshDebounce: refreshDebounce,
      ),
    ),
  ));
  if (settle) await tester.pumpAndSettle();
  return active;
}

MafwEvent _goalNodeEvent(String goalId, {String transition = 'started'}) {
  return MafwEvent.fromJson({
    'type': 'goal_node',
    'goalId': goalId,
    'loop': 1,
    'node': 'execute',
    'transition': transition,
    'revision': 1,
  });
}

MafwEvent _canonicalEvent(String type) {
  return MafwEvent.fromJson({
    'type': 'mafw_event',
    'data': {'type': type, 'properties': <String, dynamic>{}},
  });
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('brand row', () {
    testWidgets('renders the Lore icon asset + Orcalore wordmark', (tester) async {
      await _pumpWorkTab(tester, client: _FakeWorkClient());

      expect(find.text('Orcalore'), findsOneWidget);
      final images = tester.widgetList<Image>(find.byType(Image)).toList();
      final assets = images
          .map((image) => image.image)
          .whereType<AssetImage>()
          .map((image) => image.assetName)
          .toList();
      expect(assets, contains('assets/lore/Lore_avatar_20.png'));

      // The asset is declared in pubspec.yaml, so the bundle can serve it.
      final data = await rootBundle.load('assets/lore/Lore_avatar_20.png');
      expect(data.lengthInBytes, greaterThan(0));
    });

    testWidgets('project switcher shows the active project basename', (tester) async {
      await _pumpWorkTab(tester, client: _FakeWorkClient(projectDirs: [_dirA, _dirB]));

      expect(
        find.descendant(
          of: find.byKey(const Key('work-project-switcher')),
          matching: find.text('projA'),
        ),
        findsOneWidget,
      );
    });
  });

  group('five buckets', () {
    testWidgets('renders every bucket, count badge, stage chip, revision, strategy and verdict',
        (tester) async {
      await _pumpWorkTab(tester, client: _FakeWorkClient());

      for (final label in ['需要你', '排队中', '进行中', '结果待看', '历史']) {
        expect(find.text(label), findsOneWidget, reason: 'bucket header $label');
      }
      for (final title in ['修 CI', '排队的', '跑着的', '完成的', '取消的']) {
        expect(find.text(title), findsOneWidget, reason: 'goal card $title');
      }
      // Neutral count badges: one per bucket (all counts are 1).
      expect(find.text('1'), findsNWidgets(5));
      // Card metadata (spec §7.3).
      expect(find.text('计划待批准'), findsOneWidget);
      expect(find.text('实施中'), findsOneWidget);
      expect(find.text('r2'), findsOneWidget);
      expect(find.text('r1'), findsNWidgets(4));
      expect(find.text('collaborative'), findsOneWidget);
      expect(find.text('quick'), findsOneWidget);
      expect(find.text('PASS'), findsOneWidget);
      expect(find.text('CANCELLED'), findsOneWidget);
    });

    testWidgets('stage chips stay neutral (mint is reserved for 需要你/active)', (tester) async {
      await _pumpWorkTab(tester, client: _FakeWorkClient());

      final chip = tester.widget<Text>(find.text('计划待批准'));
      expect(chip.style?.color, MafwPalette.badgeText);
    });

    testWidgets('empty buckets still render their header with a zero badge', (tester) async {
      final empty = WorkOverview.fromJson({
        'projectDir': _dirA,
        'podId': 'pod-a',
        'groups': <String, dynamic>{},
        'counts': <String, dynamic>{},
        'total': 0,
      });
      await _pumpWorkTab(tester, client: _FakeWorkClient(fallbackOverview: empty));

      for (final label in ['需要你', '排队中', '进行中', '结果待看', '历史']) {
        expect(find.text(label), findsOneWidget);
      }
      expect(find.text('0'), findsNWidgets(5));
    });
  });

  group('需要你 (cross-project attention)', () {
    testWidgets('a foreign-project item switches the active project then opens the Goal',
        (tester) async {
      final opened = <String>[];
      final client = _FakeWorkClient(
        projectDirs: [_dirA, _dirB],
        presence: _presence(attention: [
          _attentionItem(
            id: 'g-other:blocked:r1',
            goalId: 'g-other',
            kind: 'blocked',
            title: '卡住了',
            projectId: _dirB,
            podId: 'pod-b',
          ),
        ]),
      );
      final store = await _pumpWorkTab(
        tester,
        client: client,
        onOpenGoal: (projectId, goalId) => opened.add('$projectId|$goalId'),
      );
      expect(store.current(), _dirA);

      await tester.tap(find.text('卡住了'));
      await tester.pumpAndSettle();

      expect(store.current(), _dirB);
      expect(opened, ['$_dirB|g-other']);
      // The tab follows the switch: the new project's overview is fetched.
      expect(client.lastDir, _dirB);
      expect(client.dirsRequested, contains(_dirB));
    });

    testWidgets('an item without projectId stays on the current project', (tester) async {
      final opened = <String>[];
      final client = _FakeWorkClient(
        projectDirs: [_dirA, _dirB],
        presence: _presence(attention: [
          _attentionItem(id: 'g1:question:r1', goalId: 'g1', kind: 'question', title: '回答我'),
        ]),
      );
      final store = await _pumpWorkTab(
        tester,
        client: client,
        onOpenGoal: (projectId, goalId) => opened.add('$projectId|$goalId'),
      );

      await tester.tap(find.text('回答我'));
      await tester.pumpAndSettle();

      expect(store.current(), _dirA);
      expect(opened, ['$_dirA|g1']);
      expect(client.workCalls, 1); // no cross-project refetch
    });

    testWidgets('unread results surface next to the attention section', (tester) async {
      await _pumpWorkTab(
        tester,
        client: _FakeWorkClient(presence: _presence(unreadResults: 2)),
      );

      expect(find.text('现在需要你'), findsOneWidget);
      expect(find.text('2 个结果待查看'), findsOneWidget);
    });

    testWidgets('section is hidden when nothing needs a human', (tester) async {
      await _pumpWorkTab(tester, client: _FakeWorkClient());

      expect(find.text('现在需要你'), findsNothing);
    });
  });

  group('refresh', () {
    testWidgets('a work event refetches data without recreating the tab state', (tester) async {
      final bus = WorkRefreshBus();
      final client = _FakeWorkClient();
      await _pumpWorkTab(
        tester,
        client: client,
        bus: bus,
        refreshDebounce: Duration.zero,
      );
      expect(client.workCalls, 1);
      final stateBefore = tester.state(find.byType(WorkTab));

      bus.onEvent(_goalNodeEvent('g-run'));
      await tester.pump();
      await tester.pumpAndSettle();

      expect(client.workCalls, 2);
      expect(identical(tester.state(find.byType(WorkTab)), stateBefore), isTrue);
    });

    testWidgets('an event without work meaning does not refetch', (tester) async {
      final bus = WorkRefreshBus();
      final client = _FakeWorkClient();
      await _pumpWorkTab(
        tester,
        client: client,
        bus: bus,
        refreshDebounce: Duration.zero,
      );

      bus.onEvent(_canonicalEvent('message.updated'));
      await tester.pump();
      await tester.pumpAndSettle();

      expect(client.workCalls, 1);
    });

    testWidgets('an event keeps unrelated goal cards (goalId patch)', (tester) async {
      final bus = WorkRefreshBus();
      final client = _FakeWorkClient(overviews: {_dirA: _overviewA()});
      await _pumpWorkTab(
        tester,
        client: client,
        bus: bus,
        refreshDebounce: Duration.zero,
      );

      // The refetched overview renames one Goal; a goalId-scoped event must only
      // adopt that Goal's rows, leaving the other cards untouched.
      client.overviews[_dirA] = _overviewA(needsTitle: '修 CI（已更新）');
      bus.onEvent(_goalNodeEvent('g-need'));
      await tester.pump();
      await tester.pumpAndSettle();

      expect(find.text('修 CI（已更新）'), findsOneWidget);
      expect(find.text('跑着的'), findsOneWidget);
      expect(find.text('完成的'), findsOneWidget);
    });

    testWidgets('15s poll refetches on its own', (tester) async {
      final client = _FakeWorkClient();
      await _pumpWorkTab(tester, client: client);
      expect(client.workCalls, 1);

      await tester.pump(const Duration(seconds: 15));
      await tester.pumpAndSettle();

      expect(client.workCalls, 2);
      expect(client.presenceCalls, greaterThanOrEqualTo(2));
    });

    testWidgets('the 15s poll stays authoritative after a goal event', (tester) async {
      final bus = WorkRefreshBus();
      final client = _FakeWorkClient(overviews: {_dirA: _overviewA()});
      await _pumpWorkTab(
        tester,
        client: client,
        bus: bus,
        refreshDebounce: Duration.zero,
      );

      // 1. A goal-scoped event: the refresh that follows is a local patch.
      bus.onEvent(_goalNodeEvent('g-need'));
      await tester.pump();
      await tester.pumpAndSettle();
      expect(client.workCalls, 2);
      expect(find.text('新目标'), findsNothing);

      // 2. Another bucket gains a Goal *after* the event (not in its payload).
      client.overviews[_dirA] = _overviewB();

      // 3. The 15s fallback poll must publish the full snapshot.
      //
      // Regression (Task 7 review, Important): the timer used to go through the
      // event signal, and the bus kept `lastEvent` forever — so every tick
      // re-patched g-need and the queued bucket never picked up the new Goal.
      await tester.pump(const Duration(seconds: 15));
      await tester.pumpAndSettle();

      expect(client.workCalls, 3);
      expect(find.text('新目标'), findsOneWidget);
    });

    test('patchWorkOverview replaces only the buckets that hold the touched Goal', () {
      final current = _overviewA();
      final fresh = _overviewA(needsTitle: '修 CI（已更新）');

      final patched = patchWorkOverview(current, fresh, {'g-need'});

      expect(patched.bucket('needs_you').single.title, '修 CI（已更新）');
      // Unrelated buckets keep the previous list objects (no churn).
      expect(identical(patched.bucket('queued'), current.bucket('queued')), isTrue);
      expect(identical(patched.bucket('in_progress'), current.bucket('in_progress')), isTrue);
      expect(patched.counts['needs_you'], 1);
      expect(patched.total, 5);
    });

    test('patchWorkOverview with no goalIds keeps the full fresh snapshot', () {
      final current = _overviewA();
      final fresh = _overviewA(needsTitle: '修 CI（已更新）');

      final patched = patchWorkOverview(current, fresh, const {});

      expect(identical(patched.bucket('queued'), fresh.bucket('queued')), isTrue);
      expect(patched.bucket('needs_you').single.title, '修 CI（已更新）');
    });
  });

  group('project switcher', () {
    testWidgets('picking another project persists it and refetches its overview', (tester) async {
      final client = _FakeWorkClient(
        projectDirs: [_dirA, _dirB],
        overviews: {_dirB: _overviewA(dir: _dirB, needsTitle: 'B 的目标')},
      );
      final store = await _pumpWorkTab(tester, client: client);
      expect(store.current(), _dirA);

      await tester.tap(find.byKey(const Key('work-project-switcher')));
      await tester.pumpAndSettle();
      expect(find.text('切换项目'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('work-project-option:$_dirB')));
      await tester.pumpAndSettle();

      expect(store.current(), _dirB);
      expect(client.lastDir, _dirB);
      expect(find.text('B 的目标'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const Key('work-project-switcher')),
          matching: find.text('projB'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('a remembered project is restored on the next mount', (tester) async {
      SharedPreferences.setMockInitialValues({kActiveProjectPrefsKey: _dirB});
      final client = _FakeWorkClient(
        projectDirs: [_dirA, _dirB],
        overviews: {_dirB: _overviewA(dir: _dirB, needsTitle: 'B 的目标')},
      );

      await _pumpWorkTab(tester, client: client);

      expect(client.lastDir, _dirB);
      expect(find.text('B 的目标'), findsOneWidget);
    });
  });

  group('FAB + Lead placeholder', () {
    testWidgets('the FAB calls the discussion placeholder', (tester) async {
      var taps = 0;
      await _pumpWorkTab(
        tester,
        client: _FakeWorkClient(),
        onCreateDiscussion: () => taps++,
      );

      await tester.tap(find.text('新建讨论'));
      await tester.pump();

      expect(taps, 1);
    });

    testWidgets('the Lead entry row is present and wired to its placeholder', (tester) async {
      var taps = 0;
      await _pumpWorkTab(
        tester,
        client: _FakeWorkClient(),
        onOpenLead: () => taps++,
      );

      expect(find.text('跟 Lead 说件事'), findsOneWidget);
      await tester.tap(find.byKey(const Key('work-lead-entry')));
      await tester.pump();

      expect(taps, 1);
    });
  });

  group('empty states (spec §7.3)', () {
    testWidgets('unconfigured gateway asks the user to pair', (tester) async {
      await _pumpWorkTab(tester);

      expect(find.text('未配置 Gateway'), findsOneWidget);
      expect(find.text('Orcalore'), findsOneWidget);
    });

    testWidgets('no registered projects is its own state', (tester) async {
      await _pumpWorkTab(tester, client: _FakeWorkClient(projectDirs: const []));

      expect(find.text('还没有已注册的项目'), findsOneWidget);
      expect(find.byKey(const Key('work-project-switcher')), findsOneWidget);
    });

    testWidgets('a project without a Pod says so instead of failing', (tester) async {
      await _pumpWorkTab(
        tester,
        client: _FakeWorkClient(workError: NoPodException('workOverview: no Pod for this project (HTTP 404)')),
      );

      expect(find.text('这个项目还没有鲸群'), findsOneWidget);
    });

    testWidgets('an old gateway (route missing) gets a distinct message', (tester) async {
      await _pumpWorkTab(
        tester,
        client: _FakeWorkClient(
          workError: GatewayRouteMissingException('workOverview: HTTP 404 (unknown endpoint)'),
        ),
      );

      expect(find.text('网关版本过旧'), findsOneWidget);
      expect(find.text('这个项目还没有鲸群'), findsNothing);
    });

    testWidgets('a fetch failure shows a retryable error state', (tester) async {
      await _pumpWorkTab(
        tester,
        client: _FakeWorkClient(workError: GatewayException('workOverview: HTTP 500')),
      );

      expect(find.text('无法连接 Gateway'), findsOneWidget);
      expect(find.text('重试'), findsOneWidget);
    });
  });

  group('ActiveProjectStore', () {
    test('current() is null before any project is known', () async {
      final store = ActiveProjectStore();
      await store.load();
      expect(store.current(), isNull);
    });

    test('resolve() prefers the remembered project, else the first one', () async {
      final store = ActiveProjectStore();
      await store.load();

      expect(
        store.resolve(const [ProjectInfo(dir: _dirA), ProjectInfo(dir: _dirB)]),
        _dirA,
      );

      await store.set(_dirB);
      expect(
        store.resolve(const [ProjectInfo(dir: _dirA), ProjectInfo(dir: _dirB)]),
        _dirB,
      );
      // A remembered project that disappeared falls back to the first one.
      expect(store.resolve(const [ProjectInfo(dir: _dirA)]), _dirA);
      expect(store.resolve(const []), isNull);
    });

    test('set() persists to SharedPreferences', () async {
      final first = ActiveProjectStore();
      await first.load();
      await first.set(_dirB);

      final restored = ActiveProjectStore();
      await restored.load();
      expect(restored.current(), _dirB);
    });
  });
}
