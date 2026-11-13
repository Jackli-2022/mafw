/// E6-4: the 聊天 list patches in place from the live event stream.
///
/// Spec: `docs/superpowers/specs/2026-11-13-gateway-e6-interaction-model-design.md` §6.2–6.3
/// Plan: `docs/superpowers/plans/2026-11-13-gateway-e6-interaction.md` Task 4
///
/// Contract pinned here:
/// - `SessionsPage(events:)` subscribes on `initState`, re-subscribes when the
///   stream identity changes (`didUpdateWidget`) and cancels on `dispose`;
/// - `session.updated` / `session.deleted` patch an already-loaded 聊天 list
///   **without** another `listSessions` round-trip;
/// - a complete `session.created` appends in place; an incomplete one (or one
///   that cannot be proven to belong to the active project) falls back to
///   exactly one debounced full refresh;
/// - `events: null` (old shell / no WS) keeps the previous fetch-on-demand
///   behaviour.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/models/pod_models.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';
import 'package:orcalore_mobile/src/pages/sessions_page.dart';
import 'package:orcalore_mobile/src/services/active_project.dart';
import 'package:orcalore_mobile/src/theme.dart';

const String _dirA = '/work/a';
const String _dirB = '/work/b';

MafwSession _session(
  String id, {
  String? title,
  String? projectID = _dirA,
  int? timeCreated,
}) =>
    MafwSession(
      id: id,
      title: title,
      projectID: projectID,
      directory: projectID,
      timeCreated: timeCreated,
    );

MafwEvent _event(
  String innerType, {
  Map<String, dynamic>? info,
  String? sessionID,
}) =>
    MafwEvent(
      type: kMafwEventEnvelope,
      innerType: innerType,
      properties: {
        'info': ?info,
        'sessionID': ?sessionID,
      },
      sessionID: sessionID,
    );

/// Chat-list client: counts `listSessions` and serves [sessions].
class _ChatClient extends GatewayClient {
  _ChatClient({List<MafwSession> sessions = const []})
      : sessions = List.of(sessions),
        super(const ConnectionConfig(
          baseUrl: 'http://127.0.0.1:3000',
          apiToken: 'test-token',
        ));

  List<MafwSession> sessions;
  int listCalls = 0;
  final List<String?> listProjectIDs = <String?>[];

  @override
  Future<List<MafwSession>> listSessions({String? projectID}) async {
    listCalls++;
    listProjectIDs.add(projectID);
    if (projectID == null) return List.of(sessions);
    return sessions
        .where((s) => s.projectID == projectID || s.directory == projectID)
        .toList();
  }

  // The 工作 tab is not under test: keep its surface quiet and offline-free.
  @override
  Future<List<ProjectInfo>> projects() async => const [ProjectInfo(dir: _dirA)];

  @override
  Future<WorkOverview> workOverview(String projectDir) async =>
      WorkOverview.fromJson({
        'projectDir': projectDir,
        'podId': '',
        'groups': <String, dynamic>{},
        'counts': <String, dynamic>{},
        'total': 0,
      });

  @override
  Future<PresenceInfo> presence() async => PresenceInfo.fromJson({
        'running': <dynamic>[],
        'attention': {'count': 0, 'items': <dynamic>[]},
        'unreadResults': {'count': 0},
      });

  @override
  Future<PodInfo?> podLookup(String projectDir) async => null;
}

Future<ActiveProjectStore> _pumpChat(
  WidgetTester tester, {
  required _ChatClient client,
  Stream<MafwEvent>? events,
  String? activeDir = _dirA,
  ActiveProjectStore? store,
  List<MafwSession> sessions = const [],
}) async {
  tester.view.physicalSize = const Size(430, 1600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final activeProject = store ?? ActiveProjectStore();
  await activeProject.load();
  if (activeDir != null) await activeProject.set(activeDir);

  await tester.pumpWidget(MaterialApp(
    theme: mafwDarkTheme(),
    home: SessionsPage(
      sessions: sessions,
      onOpen: (_) {},
      onSettings: () {},
      client: client,
      activeProject: activeProject,
      events: events,
    ),
  ));
  await tester.pumpAndSettle();

  await tester.tap(
    find.descendant(of: find.byType(NavigationBar), matching: find.text('聊天')),
  );
  await tester.pumpAndSettle();

  return activeProject;
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('聊天 list patches from live events', () {
    testWidgets('session.updated retitles in place without refetching',
        (tester) async {
      final client = _ChatClient(sessions: [
        _session('ses_a', title: 'Alpha', timeCreated: 200),
        _session('ses_b', title: 'Beta', timeCreated: 100),
      ]);
      final events = StreamController<MafwEvent>.broadcast();
      addTearDown(events.close);

      await _pumpChat(tester, client: client, events: events.stream);
      expect(find.text('Alpha'), findsOneWidget);
      expect(client.listCalls, 1);

      events.add(_event('session.updated', info: {
        'id': 'ses_a',
        'title': 'Alpha renamed',
      }));
      await tester.pumpAndSettle();

      expect(find.text('Alpha renamed'), findsOneWidget);
      expect(find.text('Alpha'), findsNothing);
      // Incremental patch: no full list fetch.
      expect(client.listCalls, 1);
    });

    testWidgets('session.deleted removes the row without refetching',
        (tester) async {
      final client = _ChatClient(sessions: [
        _session('ses_a', title: 'Alpha', timeCreated: 200),
        _session('ses_b', title: 'Beta', timeCreated: 100),
      ]);
      final events = StreamController<MafwEvent>.broadcast();
      addTearDown(events.close);

      await _pumpChat(tester, client: client, events: events.stream);
      expect(find.text('Alpha'), findsOneWidget);

      events.add(_event('session.deleted', info: {'id': 'ses_a'}));
      await tester.pumpAndSettle();

      expect(find.text('Alpha'), findsNothing);
      expect(find.text('Beta'), findsOneWidget);
      expect(client.listCalls, 1);
    });

    testWidgets('a complete session.created appends without refetching',
        (tester) async {
      final client = _ChatClient(sessions: [
        _session('ses_a', title: 'Alpha', timeCreated: 100),
      ]);
      final events = StreamController<MafwEvent>.broadcast();
      addTearDown(events.close);

      await _pumpChat(tester, client: client, events: events.stream);
      expect(find.text('New topic'), findsNothing);

      events.add(_event('session.created', info: {
        'id': 'ses_new',
        'title': 'New topic',
        'projectID': _dirA,
        'directory': _dirA,
        'time': {'created': 300},
      }));
      await tester.pumpAndSettle();

      expect(find.text('New topic'), findsOneWidget);
      expect(client.listCalls, 1);
    });

    testWidgets('an incomplete session.created triggers exactly one debounced refresh',
        (tester) async {
      final client = _ChatClient(sessions: [
        _session('ses_a', title: 'Alpha', timeCreated: 100),
      ]);
      final events = StreamController<MafwEvent>.broadcast();
      addTearDown(events.close);

      await _pumpChat(tester, client: client, events: events.stream);
      expect(client.listCalls, 1);

      // The gateway says a session exists but the frame carries no title:
      // appending it would render an id-only ghost row, so the page refetches.
      client.sessions = [
        _session('ses_new', title: 'Fresh from list', timeCreated: 300),
        ...client.sessions,
      ];
      events.add(_event('session.created', info: {'id': 'ses_new'}));
      events.add(_event('session.created', info: {'id': 'ses_same'}));
      await tester.pump(const Duration(milliseconds: 100));
      // Debounced (250ms) — not fetched yet.
      expect(client.listCalls, 1);

      await tester.pump(const Duration(milliseconds: 200));
      await tester.pumpAndSettle();

      expect(client.listCalls, 2);
      expect(find.text('Fresh from list'), findsOneWidget);

      // No trailing duplicate refresh.
      await tester.pump(const Duration(milliseconds: 400));
      expect(client.listCalls, 2);
    });

    testWidgets('a session.created for another project is ignored while scoped',
        (tester) async {
      final client = _ChatClient(sessions: [
        _session('ses_a', title: 'Alpha', timeCreated: 100),
      ]);
      final events = StreamController<MafwEvent>.broadcast();
      addTearDown(events.close);

      await _pumpChat(tester, client: client, events: events.stream);

      events.add(_event('session.created', info: {
        'id': 'ses_other',
        'title': 'Other project',
        'projectID': _dirB,
        'directory': _dirB,
        'time': {'created': 300},
      }));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();

      expect(find.text('Other project'), findsNothing);
      expect(client.listCalls, 1);
    });

    testWidgets('a path spelling difference is still the same project',
        (tester) async {
      final client = _ChatClient(sessions: [
        _session('ses_a', title: 'Alpha', timeCreated: 100),
      ]);
      final events = StreamController<MafwEvent>.broadcast();
      addTearDown(events.close);

      await _pumpChat(tester, client: client, events: events.stream);

      events.add(_event('session.created', info: {
        'id': 'ses_new',
        'title': 'Same project',
        // Windows separators / case must not hide a real session.
        'projectID': '${_dirA.toUpperCase()}\\',
        'directory': '${_dirA.toUpperCase()}\\',
        'time': {'created': 300},
      }));
      await tester.pumpAndSettle();

      expect(find.text('Same project'), findsOneWidget);
      expect(client.listCalls, 1);
    });
  });

  group('stream lifecycle', () {
    testWidgets('events: null keeps the old fetch-on-demand behaviour',
        (tester) async {
      final client = _ChatClient(sessions: [
        _session('ses_a', title: 'Alpha', timeCreated: 100),
      ]);

      await _pumpChat(tester, client: client, sessions: [
        _session('ses_fallback', title: 'Fallback row'),
      ]);

      expect(find.text('Alpha'), findsOneWidget);
      expect(client.listCalls, 1);
      // Re-entering the tab still refetches (unchanged legacy behaviour).
      await tester.tap(
        find.descendant(of: find.byType(NavigationBar), matching: find.text('工作')),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(of: find.byType(NavigationBar), matching: find.text('聊天')),
      );
      await tester.pumpAndSettle();
      expect(client.listCalls, 2);
    });

    testWidgets('didUpdateWidget re-subscribes to the replacement stream',
        (tester) async {
      final client = _ChatClient(sessions: [
        _session('ses_a', title: 'Alpha', timeCreated: 200),
        _session('ses_b', title: 'Beta', timeCreated: 100),
      ]);
      final first = StreamController<MafwEvent>.broadcast();
      final second = StreamController<MafwEvent>.broadcast();
      addTearDown(first.close);
      addTearDown(second.close);

      final store = await _pumpChat(
        tester,
        client: client,
        events: first.stream,
      );

      // WS rebuilt: the page is rebuilt with a new stream.
      await _pumpChat(
        tester,
        client: client,
        events: second.stream,
        store: store,
      );

      first.add(_event('session.updated', info: {
        'id': 'ses_a',
        'title': 'Stale stream',
      }));
      await tester.pumpAndSettle();
      expect(find.text('Stale stream'), findsNothing);

      second.add(_event('session.updated', info: {
        'id': 'ses_a',
        'title': 'Live stream',
      }));
      await tester.pumpAndSettle();
      expect(find.text('Live stream'), findsOneWidget);
    });

    testWidgets('disposing the page stops applying events', (tester) async {
      final client = _ChatClient(sessions: [
        _session('ses_a', title: 'Alpha', timeCreated: 200),
      ]);
      final events = StreamController<MafwEvent>.broadcast();
      addTearDown(events.close);

      await _pumpChat(tester, client: client, events: events.stream);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();

      // A closed listener must not throw `setState() after dispose`.
      events.add(_event('session.updated', info: {
        'id': 'ses_a',
        'title': 'after dispose',
      }));
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  });
}
