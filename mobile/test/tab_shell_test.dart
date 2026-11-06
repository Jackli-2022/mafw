// Orcalore 3-tab shell (work / chat / me).
//
// Spec: docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md §7.2
// Plan: docs/superpowers/plans/2026-11-05-mobile-app-v1.md (Task 6)
//
// Contract pinned here:
// - bottom navigation has exactly three destinations: 工作 / 聊天 / 我的
// - the Goal tab is gone (and 记忆 is no longer a top-level destination)
// - 聊天 keeps the plain session list; 我的 hosts the memory search entry
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';
import 'package:orcalore_mobile/src/pages/sessions_page.dart';
import 'package:orcalore_mobile/src/pages/work_tab.dart';
import 'package:orcalore_mobile/src/theme.dart';

/// Offline-safe client: only the memory search is exercised by these tests.
class _FakeClient extends GatewayClient {
  final List<String> queries = [];
  final List<Map<String, dynamic>> results;

  _FakeClient({this.results = const []})
      : super(const ConnectionConfig(
          baseUrl: 'http://127.0.0.1:3000',
          apiToken: 'test-token',
        ));

  @override
  Future<List<Map<String, dynamic>>> memorySearch(String query, {int topK = 20}) async {
    queries.add(query);
    return results;
  }
}

Future<void> _pumpShell(
  WidgetTester tester, {
  List<MafwSession> sessions = const [],
  GatewayClient? client,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: mafwDarkTheme(),
      home: SessionsPage(
        sessions: sessions,
        onOpen: (_) {},
        onCreate: () async {},
        onSettings: () {},
        onScan: () async {},
        client: client,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Taps a bottom destination by its label (the AppBar may repeat the label,
/// so the lookup is scoped to the NavigationBar).
Future<void> _tapTab(WidgetTester tester, String label) async {
  await tester.tap(
    find.descendant(of: find.byType(NavigationBar), matching: find.text(label)),
  );
  await tester.pumpAndSettle();
}

/// Bottom destination labels in order (structural, immune to body text).
List<String?> _navLabels(WidgetTester tester) => tester
    .widgetList<NavigationDestination>(find.byType(NavigationDestination))
    .map((d) => d.label)
    .toList();

void main() {
  group('3-tab shell', () {
    testWidgets('bottom navigation is exactly 工作 / 聊天 / 我的', (tester) async {
      await _pumpShell(tester);

      final bar = tester.widget<NavigationBar>(find.byType(NavigationBar));
      expect(bar.destinations.length, 3);
      expect(_navLabels(tester), ['工作', '聊天', '我的']);
    });

    testWidgets('Goal tab is gone', (tester) async {
      await _pumpShell(tester);

      final labels = _navLabels(tester);
      expect(labels, isNot(contains('Goal')));
      expect(labels, isNot(contains('Goals')));
      // 记忆 is no longer a top-level destination — it lives inside 我的.
      expect(labels, isNot(contains('记忆')));
    });

    testWidgets('default tab is 工作 and renders the WorkTab shell', (tester) async {
      await _pumpShell(tester);

      expect(
        SessionsTab.values,
        [SessionsTab.work, SessionsTab.chat, SessionsTab.me],
      );
      expect(find.byType(WorkTab), findsOneWidget);
      // 工作 is the initial segment: chat chrome must not be mounted yet.
      expect(find.text('搜索会话…'), findsNothing);
    });

    testWidgets('聊天 tab renders the plain session list', (tester) async {
      await _pumpShell(
        tester,
        sessions: [
          MafwSession(id: 'ses_alpha', title: 'Alpha session'),
          MafwSession(id: 'ses_beta', title: 'Beta session'),
        ],
      );
      await _tapTab(tester, '聊天');

      expect(find.text('搜索会话…'), findsOneWidget);
      expect(find.text('Alpha session'), findsOneWidget);
      expect(find.text('Beta session'), findsOneWidget);
      // Memory search belongs to 我的, not 聊天.
      expect(find.text('搜索记忆…'), findsNothing);
    });

    testWidgets('我的 tab hosts memory search + connection entries', (tester) async {
      await _pumpShell(tester);
      await _tapTab(tester, '我的');

      // Memory retrieval migrated from the retired 记忆 tab.
      expect(find.text('搜索记忆…'), findsOneWidget);
      // Existing settings / pairing / debug entries stay reachable.
      expect(find.text('Gateway'), findsOneWidget);
      expect(find.text('扫码配对'), findsOneWidget);
      // Chat-only chrome must not leak into 我的.
      expect(find.text('搜索会话…'), findsNothing);
      expect(find.byType(FloatingActionButton), findsNothing);
    });

    testWidgets('聊天 keeps the new-session FAB; 工作 and 我的 do not', (tester) async {
      await _pumpShell(tester);
      expect(find.byType(FloatingActionButton), findsNothing);

      await _tapTab(tester, '聊天');
      expect(find.byType(FloatingActionButton), findsOneWidget);

      await _tapTab(tester, '我的');
      expect(find.byType(FloatingActionButton), findsNothing);
    });

    testWidgets('我的 memory search queries the gateway and renders results', (tester) async {
      final client = _FakeClient(results: [
        {
          'primary_abstraction': 'mobile shell decision',
          'memory_value': '3-tab work/chat/me',
          'cue_anchors': ['task-6'],
          'energy': 0.9,
        },
      ]);
      await _pumpShell(tester, client: client);
      await _tapTab(tester, '我的');

      await tester.enterText(find.byType(TextField), 'shell');
      await tester.pump(const Duration(milliseconds: 500)); // 400ms debounce
      await tester.pumpAndSettle();

      expect(client.queries, ['shell']);
      expect(find.text('mobile shell decision'), findsOneWidget);
      expect(find.text('#task-6'), findsOneWidget);
    });
  });
}
