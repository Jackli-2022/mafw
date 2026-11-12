// Basic smoke test: the app boots to the sessions page shell.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:orcalore_mobile/main.dart';
import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/services/event_recovery.dart';

class _GateCursorStore implements EventCursorStore {
  final gate = Completer<void>();
  final loadStarted = Completer<void>();

  @override
  Future<({int? seq, String? instanceId})> load() async {
    if (!loadStarted.isCompleted) loadStarted.complete();
    await gate.future;
    return (seq: null, instanceId: null);
  }

  @override
  Future<void> save(int? seq, String? instanceId) async {}

  @override
  Future<void> clear() async {}
}

void main() {
  setUp(() {
    // The 工作 tab persists its active project (Task 7).
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('app boots', (WidgetTester tester) async {
    await tester.pumpWidget(const MafwMobileApp());
    await tester.pump(const Duration(milliseconds: 100));
    // Should reach either the connecting spinner or the sessions page.
    expect(tester.takeException(), isNull);
  });

  testWidgets('disposing while the cursor loads does not touch the State',
      (WidgetTester tester) async {
    final store = _GateCursorStore();
    await tester.pumpWidget(MafwMobileApp(
      initialConfig: const ConnectionConfig(
        baseUrl: 'http://127.0.0.1:1',
        apiToken: 'tok-dispose',
      ),
      cursorStore: store,
    ));

    for (var i = 0; i < 100 && !store.loadStarted.isCompleted; i++) {
      await tester.pump(const Duration(milliseconds: 5));
    }
    expect(store.loadStarted.isCompleted, isTrue,
        reason: 'recovery.init should be in flight');

    await tester.pumpWidget(const SizedBox());
    store.gate.complete();
    await tester.pump(const Duration(milliseconds: 20));

    expect(tester.takeException(), isNull);
  });
}
