import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:orcalore_mobile/src/pages/debug_page.dart';
import 'package:orcalore_mobile/src/services/diagnostics.dart';

String _canonicalFrame() => jsonEncode({
      'type': 'mafw_event',
      'data': {
        'type': 'part.delta',
        'sessionID': 'sess-debug-1',
        'properties': {
          'delta': 'hello',
          'part': {
            'id': 'p1',
            'type': 'text',
          },
        },
      },
    });

String _flatFrame() => jsonEncode({
      'type': 'goal_node',
      'goalId': 'goal-1',
      'node': 'plan',
    });

void main() {
  group('DiagnosticsSink ring buffers', () {
    test('keeps only the newest 100 HTTP entries', () {
      final sink = DiagnosticsSink();
      for (var i = 0; i <= 100; i++) {
        sink.recordHttp(
          method: 'GET',
          path: '/api/sessions/$i',
          status: 200,
          durationMs: i,
        );
      }

      expect(sink.httpEntries.length, 100);
      expect(sink.httpEntries.first.path, '/api/sessions/1');
      expect(sink.httpEntries.last.path, '/api/sessions/100');
    });

    test('keeps only the newest 200 WS frames', () {
      final sink = DiagnosticsSink();
      for (var i = 0; i <= 200; i++) {
        sink.recordWsFrame(jsonEncode({'type': 'flat_$i'}));
      }

      expect(sink.wsFrames.length, 200);
      expect(sink.wsFrames.first.raw, contains('flat_1'));
      expect(sink.wsFrames.last.raw, contains('flat_200'));
    });

    test('disabled sink records nothing (release gate)', () {
      final sink = DiagnosticsSink(enabled: false);
      for (var i = 0; i < 5; i++) {
        sink.recordHttp(method: 'GET', path: '/api/x/$i', status: 200);
        sink.recordWsFrame(_canonicalFrame());
      }

      expect(sink.httpEntries, isEmpty);
      expect(sink.wsFrames, isEmpty);
      expect(sink.export()['http'], isEmpty);
      expect(sink.export()['ws'], isEmpty);
    });
  });

  group('DiagnosticsSink frame classification', () {
    test('classifies canonical frames and resolves chat effects', () {
      final sink = DiagnosticsSink();
      sink.recordWsFrame(_canonicalFrame());

      final frame = sink.wsFrames.single;
      expect(frame.kind, WsFrameKind.canonical);
      expect(frame.type, 'part.delta');
      expect(frame.effect, contains('writing'));
      expect(frame.raw, contains('"part.delta"'));
    });

    test('classifies flat frames', () {
      final sink = DiagnosticsSink();
      sink.recordWsFrame(_flatFrame());

      final frame = sink.wsFrames.single;
      expect(frame.kind, WsFrameKind.flat);
      expect(frame.type, 'goal_node');
      expect(frame.effect, 'refreshWork');
    });

    // Parity guard (Task 2 deferred minor): the goal-lifecycle `refreshWork`
    // signal comes from the single `event_effects.shouldRefreshWork` table, so
    // every shared verb must agree with the work tab — including verbs that no
    // longer have a local diagnostics entry.
    test('shared flat refresh signals come from the unified effects table', () {
      final sink = DiagnosticsSink();
      for (final type in const [
        'goal_node',
        'phase_transition',
        'state_change',
        'user_question',
      ]) {
        sink.recordWsFrame(jsonEncode({'type': type, 'goalId': 'goal-1'}));
      }

      expect(sink.wsFrames, hasLength(4));
      for (final frame in sink.wsFrames) {
        expect(frame.kind, WsFrameKind.flat, reason: frame.type);
        expect(frame.effect, 'refreshWork', reason: frame.type);
      }
    });

    test('canonical work signals show refreshWork in the panel', () {
      final sink = DiagnosticsSink();
      for (final type in const ['pod.updated', 'pod.event', 'run.updated']) {
        sink.recordWsFrame(jsonEncode({
          'type': 'mafw_event',
          'data': {'type': type, 'properties': <String, dynamic>{}},
        }));
      }

      expect(sink.wsFrames, hasLength(3));
      for (final frame in sink.wsFrames) {
        expect(frame.kind, WsFrameKind.canonical, reason: frame.type);
        expect(frame.effect, 'refreshWork', reason: frame.type);
      }
    });

    test('marks unparseable / unknown frames as discarded with a reason', () {
      final sink = DiagnosticsSink();
      sink.recordWsFrame('not json');
      sink.recordWsFrame(jsonEncode({'notType': true}));
      sink.recordWsFrame(jsonEncode({
        'type': 'mafw_event',
        'data': {'type': 'legacy.event'},
      }));

      expect(sink.wsFrames[0].kind, WsFrameKind.discarded);
      expect(sink.wsFrames[0].reason, contains('invalid JSON'));
      expect(sink.wsFrames[1].kind, WsFrameKind.discarded);
      expect(sink.wsFrames[1].reason, contains('missing type'));
      expect(sink.wsFrames[2].kind, WsFrameKind.discarded);
      expect(sink.wsFrames[2].reason, contains('legacy.event'));
    });
  });

  group('DiagnosticsSink export', () {
    test('masks the api token and includes HTTP + WS entries', () {
      final sink = DiagnosticsSink();
      sink.updateConnection(
        baseUrl: 'http://pc.tailnet.ts.net:3000',
        apiToken: 'super-secret-token',
      );
      sink.recordHttp(
        method: 'POST',
        path: '/api/chat/enriched',
        status: 500,
        durationMs: 42,
        errorBody: 'boom',
      );
      sink.recordWsFrame(_canonicalFrame());

      final out = sink.export();
      final connection = out['connection'] as Map<String, dynamic>;
      final encoded = jsonEncode(out);

      expect(connection['baseUrl'], 'http://pc.tailnet.ts.net:3000');
      expect(connection['tokenPresent'], isTrue);
      expect(connection['apiToken'], contains('••••'));
      expect(encoded, isNot(contains('super-secret-token')));
      expect((out['http'] as List).single['path'], '/api/chat/enriched');
      expect((out['http'] as List).single['errorBody'], 'boom');
      expect((out['ws'] as List).single['kind'], 'canonical');
    });
  });

  group('DebugPage', () {
    testWidgets('renders connection, frames, HTTP log and health probe', (tester) async {
      final sink = DiagnosticsSink();
      sink.updateConnection(
        baseUrl: 'http://pc.tailnet.ts.net:3000',
        apiToken: 'secret-token-1234',
      );
      sink.recordHttp(
        method: 'GET',
        path: '/api/sessions',
        status: 200,
        durationMs: 12,
      );
      sink.recordWsFrame(_canonicalFrame());

      await tester.pumpWidget(MaterialApp(
        home: DebugPage(
          diagnostics: sink,
          healthProbe: () async => true,
        ),
      ));
      await tester.pump();

      expect(find.textContaining('pc.tailnet.ts.net'), findsWidgets);
      expect(find.textContaining('••••'), findsWidgets);
      expect(find.textContaining('canonical'), findsOneWidget);
      expect(find.textContaining('writing'), findsWidgets);
      expect(find.textContaining('/api/sessions'), findsOneWidget);
      expect(find.textContaining('200'), findsWidgets);

      await tester.tap(find.text('检测连接'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.textContaining('连接正常'), findsOneWidget);
    });

    testWidgets('copy diagnostics bundle action shows confirmation', (tester) async {
      final sink = DiagnosticsSink();
      sink.updateConnection(
        baseUrl: 'http://pc.tailnet.ts.net:3000',
        apiToken: 'secret-token-1234',
      );
      String? copied;

      await tester.pumpWidget(MaterialApp(
        home: DebugPage(
          diagnostics: sink,
          copyToClipboard: (text) async => copied = text,
        ),
      ));
      await tester.pump();

      await tester.tap(find.text('复制诊断包'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 20));

      expect(copied, isNotNull);
      expect(copied, contains('••••'));
      expect(copied, isNot(contains('secret-token-1234')));
      expect(find.textContaining('诊断包已复制'), findsOneWidget);
    });
  });
}
