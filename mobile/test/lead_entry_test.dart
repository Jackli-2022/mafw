/// Orcalore mobile Task 14: Lead entry + isLead + project-scoped chat list.
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.1（active 项目模型）/ §7.2（聊天 tab 保留 Lead 胶囊）/ §7.7（自由讨论）。
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 14.
///
/// Contract pinned here:
/// - `MafwSession.isLead` recognises the current `lead` role and the legacy
///   `manager` role (badge compatibility for history rows), anything else is not
///   a Lead;
/// - the 工作 tab Lead row resolves the current project Pod and calls
///   `ensureLeadSessionId(podId)`, then hands `(projectDir, sessionID)` to the
///   host, which opens ChatPage through the bare-sessionID entry;
/// - the 聊天 tab list is fetched with `listSessions(projectID: active)` and
///   refetches when the active project changes; no active project = all sessions
///   with an explicit「未选择项目 · 显示全部」note;
/// - 新话题 creates a session in the active project directory (never the gateway
///   default project, spec §7.7) and opens it directly; without an active
///   project the entry is disabled.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/models/pod_models.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';
import 'package:orcalore_mobile/src/network/ws_client_interface.dart';
import 'package:orcalore_mobile/src/pages/chat_page.dart';
import 'package:orcalore_mobile/src/pages/sessions_page.dart';
import 'package:orcalore_mobile/src/pages/work_tab.dart';
import 'package:orcalore_mobile/src/services/active_project.dart';
import 'package:orcalore_mobile/src/services/work_refresh_bus.dart';
import 'package:orcalore_mobile/src/theme.dart';
import 'package:orcalore_mobile/src/widgets/mafw_bottom_nav.dart';

const String _dirA = r'C:\work\projA';
const String _dirB = r'C:\work\projB';

// ── Fixtures ────────────────────────────────────────────────────────────────

MafwSession _roleSession(Object? role, {String id = 'ses_role', String? projectID}) {
  return MafwSession(
    id: id,
    title: 'Role $role',
    projectID: projectID,
    metadata: {
      'mafw': {'role': role},
    },
  );
}

class _FakeWs implements MafwWsClient {
  final StreamController<MafwEvent> _events = StreamController<MafwEvent>.broadcast();

  @override
  Stream<MafwEvent> get events => _events.stream;

  @override
  Stream<bool> get connectionStatus => const Stream<bool>.empty();

  @override
  bool get isConnected => false;

  @override
  Future<void> connect() async {}

  @override
  Future<void> reconnect() async {}

  @override
  void disconnect() {}

  @override
  Future<void> send(String message, {String? sessionID}) async {}

  @override
  void dispose() {
    _events.close();
  }
}

class _FakeClientBase extends GatewayClient {
  _FakeClientBase()
      : super(const ConnectionConfig(
          baseUrl: 'http://127.0.0.1:3000',
          apiToken: 'test-token',
        ));
}

/// WorkTab 的 Lead 入口只依赖 projects / work.overview / presence / lead.ensure。
class _LeadWorkClient extends _FakeClientBase {
  int projectCalls = 0;
  int workCalls = 0;
  final List<String> leadEnsureRequests = <String>[];
  String leadSessionID = 'ses_lead';
  String podId = 'pod-a';

  @override
  Future<List<ProjectInfo>> projects() async {
    projectCalls++;
    return const [ProjectInfo(dir: _dirA)];
  }

  @override
  Future<WorkOverview> workOverview(String projectDir) async {
    workCalls++;
    return WorkOverview.fromJson({
      'projectDir': projectDir,
      'podId': podId,
      'groups': <String, dynamic>{},
      'counts': <String, dynamic>{},
      'total': 0,
    });
  }

  @override
  Future<PresenceInfo> presence() async {
    return PresenceInfo.fromJson({
      'running': <dynamic>[],
      'attention': {'count': 0, 'items': <dynamic>[]},
      'unreadResults': {'count': 0},
    });
  }

  @override
  Future<String> ensureLeadSessionId(String podId) async {
    leadEnsureRequests.add(podId);
    return leadSessionID;
  }

  @override
  Future<PodInfo?> podLookup(String projectDir) async => null;
}

/// 聊天 tab 的列表 / 新建会话入口。
class _ChatClient extends _FakeClientBase {
  final List<String?> listProjectIDs = <String?>[];
  final List<String?> createDirectories = <String?>[];
  List<MafwSession> sessions = const <MafwSession>[];
  String createdSessionID = 'ses_new';
  Object? listError;

  @override
  Future<List<MafwSession>> listSessions({String? projectID}) async {
    listProjectIDs.add(projectID);
    final error = listError;
    if (error != null) throw error;
    if (projectID == null) return sessions;
    return sessions.where((s) => s.projectID == projectID).toList();
  }

  @override
  Future<String> createSession({String? directory}) async {
    createDirectories.add(directory);
    return createdSessionID;
  }
}

// ── Harnesses ───────────────────────────────────────────────────────────────

Future<ActiveProjectStore> _pumpWorkTab(
  WidgetTester tester, {
  required _LeadWorkClient client,
  required void Function(String projectDir, String sessionId) onOpenLead,
}) async {
  tester.view.physicalSize = const Size(430, 1500);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final store = ActiveProjectStore();
  await store.load();
  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: Scaffold(
      body: WorkTab(
        client: client,
        activeProject: store,
        refreshBus: WorkRefreshBus(),
        onOpenLead: onOpenLead,
      ),
    ),
  ));
  await tester.pumpAndSettle();
  return store;
}

Future<ActiveProjectStore> _pumpChatTab(
  WidgetTester tester, {
  required _ChatClient client,
  String? activeDir,
  List<MafwSession> sessions = const <MafwSession>[],
  void Function(MafwSession)? onOpen,
}) async {
  final store = ActiveProjectStore();
  await store.load();
  if (activeDir != null) await store.set(activeDir);
  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: SessionsPage(
      sessions: sessions,
      onOpen: onOpen ?? (_) {},
      onSettings: () {},
      client: client,
      activeProject: store,
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

  group('isLead', () {
    test('the current lead role is a Lead', () {
      expect(_roleSession('lead').isLead, isTrue);
    });

    test('the legacy manager role stays recognised (badge compatibility)', () {
      expect(_roleSession('manager').isLead, isTrue);
    });

    test('other or missing roles are not Lead', () {
      expect(_roleSession('worker').isLead, isFalse);
      expect(_roleSession('manager-archived').isLead, isFalse);
      expect(_roleSession(null).isLead, isFalse);
      expect(MafwSession(id: 'ses_plain').isLead, isFalse);
    });

    testWidgets('the chat list badges lead and legacy manager rows as Lead',
        (tester) async {
      final client = _ChatClient()
        ..sessions = [
          _roleSession('lead', id: 'ses_lead', projectID: _dirA),
          _roleSession('manager', id: 'ses_manager', projectID: _dirA),
          _roleSession('worker', id: 'ses_worker', projectID: _dirA),
        ];
      await _pumpChatTab(tester, client: client, activeDir: _dirA);

      // Two Lead badges: the current role and the legacy manager row.
      expect(find.text('LEAD'), findsNWidgets(2));
    });
  });

  group('ChatPage bare session entry', () {
    test('forSessionId opens the given id with the Lead title', () {
      final page = ChatPage.forSessionId(
        'ses_lead',
        client: _ChatClient(),
        ws: _FakeWs(),
        projectID: _dirA,
        onSpeak: () async {},
      );

      expect(page.session.id, 'ses_lead');
      expect(page.session.displayTitle, 'Lead');
      // Task 15「交给 Lead」要按会话目录解析所属 Pod。
      expect(page.session.projectID, _dirA);
      expect(page.session.directory, _dirA);
    });
  });

  group('工作 tab Lead entry', () {
    testWidgets('resolves the project Pod, ensures the Lead session and opens it',
        (tester) async {
      final client = _LeadWorkClient();
      String? openedDir;
      String? openedSession;

      await _pumpWorkTab(
        tester,
        client: client,
        onOpenLead: (dir, sessionId) {
          openedDir = dir;
          openedSession = sessionId;
        },
      );

      await tester.tap(find.byKey(const Key('work-lead-entry')));
      await tester.pumpAndSettle();

      expect(client.leadEnsureRequests, ['pod-a']);
      expect(openedDir, _dirA);
      expect(openedSession, 'ses_lead');
    });

    testWidgets('a project without a Pod does not call lead.ensure', (tester) async {
      final client = _LeadWorkClient()..podId = '';
      var opened = 0;

      await _pumpWorkTab(
        tester,
        client: client,
        onOpenLead: (_, _) => opened++,
      );

      await tester.tap(find.byKey(const Key('work-lead-entry')));
      await tester.pumpAndSettle();

      expect(client.leadEnsureRequests, isEmpty);
      expect(opened, 0);
      expect(find.textContaining('这个项目还没有鲸群'), findsOneWidget);
    });
  });

  group('聊天 tab project filtering', () {
    testWidgets('listSessions receives the active project id', (tester) async {
      final client = _ChatClient()
        ..sessions = [
          MafwSession(id: 'ses_a', title: 'Alpha', projectID: _dirA),
          MafwSession(id: 'ses_b', title: 'Beta', projectID: _dirB),
        ];

      await _pumpChatTab(tester, client: client, activeDir: _dirA);

      expect(client.listProjectIDs, [_dirA]);
      expect(find.text('Alpha'), findsOneWidget);
      expect(find.text('Beta'), findsNothing);
      expect(find.text('未选择项目 · 显示全部'), findsNothing);
    });

    testWidgets('switching the active project refetches the chat list',
        (tester) async {
      final client = _ChatClient()
        ..sessions = [
          MafwSession(id: 'ses_a', title: 'Alpha', projectID: _dirA),
          MafwSession(id: 'ses_b', title: 'Beta', projectID: _dirB),
        ];

      final store = await _pumpChatTab(tester, client: client, activeDir: _dirA);
      expect(client.listProjectIDs, [_dirA]);

      await store.set(_dirB);
      await tester.pumpAndSettle();

      expect(client.listProjectIDs, [_dirA, _dirB]);
      expect(find.text('Beta'), findsOneWidget);
      expect(find.text('Alpha'), findsNothing);
    });

    testWidgets('without an active project the list shows all with a note',
        (tester) async {
      final client = _ChatClient()
        ..sessions = [
          MafwSession(id: 'ses_a', title: 'Alpha', projectID: _dirA),
          MafwSession(id: 'ses_b', title: 'Beta', projectID: _dirB),
        ];

      await _pumpChatTab(tester, client: client, activeDir: null);

      expect(client.listProjectIDs, [null]);
      expect(find.text('未选择项目 · 显示全部'), findsOneWidget);
      expect(find.text('Alpha'), findsOneWidget);
      expect(find.text('Beta'), findsOneWidget);
    });

    testWidgets('a failed first load is not retried by parent rebuilds',
        (tester) async {
      final client = _ChatClient()
        ..sessions = [
          MafwSession(id: 'ses_a', title: 'Alpha', projectID: _dirA),
        ]
        ..listError = Exception('offline');

      final store = await _pumpChatTab(tester, client: client, activeDir: _dirA);
      expect(client.listProjectIDs, [_dirA]);

      // 父级 rebuild（WS 状态变化等）→ didUpdateWidget，但没有任何显式 dirty
      // 来源：离线失败后不允许自动重试。
      await tester.pumpWidget(MaterialApp(
        theme: mafwDarkTheme(),
        home: SessionsPage(
          sessions: const <MafwSession>[],
          onOpen: (_) {},
          onSettings: () {},
          client: client,
          activeProject: store,
        ),
      ));
      await tester.pumpAndSettle();

      expect(client.listProjectIDs, [_dirA],
          reason: '失败后只有显式动作（进 tab / 切项目）才允许重试');

      // 用户重新进入聊天 tab = 显式动作，允许重试。
      await tester.tap(
        find.descendant(
          of: find.byType(MafwBottomNav),
          matching: find.text('聊天'),
        ),
      );
      await tester.pumpAndSettle();

      expect(client.listProjectIDs, [_dirA, _dirA]);
    });
  });

  group('聊天 tab 新话题', () {
    testWidgets('creates the session in the active project directory',
        (tester) async {
      final client = _ChatClient();
      MafwSession? opened;

      await _pumpChatTab(
        tester,
        client: client,
        activeDir: _dirA,
        onOpen: (session) => opened = session,
      );

      await tester.tap(find.byKey(const Key('chat-new-topic')));
      await tester.pumpAndSettle();

      expect(client.createDirectories, [_dirA]);
      expect(opened, isNotNull);
      expect(opened!.id, 'ses_new');
      expect(opened!.directory, _dirA);
    });

    testWidgets('without an active project the entry is disabled and says why',
        (tester) async {
      final client = _ChatClient();

      await _pumpChatTab(tester, client: client, activeDir: null);

      final newTopic = tester.widget<IconButton>(
        find.byKey(const Key('chat-new-topic')),
      );
      expect(newTopic.onPressed, isNull);
      expect(find.text('未选择项目 · 显示全部'), findsOneWidget);
      expect(client.createDirectories, isEmpty);
    });
  });
}
