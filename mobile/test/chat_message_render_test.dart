/// Message rendering uses **every** text part (final fix wave, Finding 2).
///
/// A real assistant turn is `text → tool → text`: the first text part is the
/// preamble, the conclusion comes *after* the tool call. `MafwMessage.text` is
/// only the first text part (pinned by `view_dto_test.dart`), so the bubble /
/// copy / read-aloud / cache path must use `displayText` instead — otherwise the
/// handoff conclusion (and any post-tool answer) disappears from chat.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/theme.dart';
import 'package:orcalore_mobile/src/widgets/chat_messages.dart';

Map<String, dynamic> _textPart(
  String id,
  String text, {
  bool synthetic = false,
}) => {
  'id': id,
  'type': 'text',
  'text': text,
  if (synthetic) 'synthetic': true,
};

Map<String, dynamic> _toolPart(String id) => {
  'id': id,
  'type': 'tool',
  'callID': 'call_$id',
  'tool': 'bash',
  'state': {'status': 'completed', 'title': 'Run tests', 'output': 'ok'},
};

MafwMessage _message(List<Map<String, dynamic>> content) =>
    MafwMessage.fromJson({
      'id': 'm1',
      'sessionID': 'ses_1',
      'role': 'assistant',
      'content': content,
      'time': {'created': 1762400000000},
    }, sessionID: 'ses_1');

void main() {
  group('MafwMessage.displayText', () {
    test('keeps the post-tool conclusion of a text → tool → text turn', () {
      final msg = _message([
        _textPart('t1', '先看日志。'),
        _toolPart('x1'),
        _textPart('t2', '结论：升级依赖导致。'),
      ]);

      // `text` 仍是首个 text part（DTO 契约不变）。
      expect(msg.text, '先看日志。');
      expect(msg.displayText, '先看日志。\n结论：升级依赖导致。');
    });

    test('skips synthetic (injected) text parts', () {
      final msg = _message([
        _textPart('t0', '系统注入的记忆块', synthetic: true),
        _textPart('t1', '真正的回答'),
      ]);

      expect(msg.displayText, '真正的回答');
    });

    test(
      'falls back to the convenience text field when there are no parts',
      () {
        final msg = MafwMessage(
          id: 'cached',
          sessionID: 'ses_1',
          role: 'assistant',
          text: '缓存里的全文',
          timeCreated: 1762400000000,
        );

        expect(msg.displayText, '缓存里的全文');
      },
    );

    test('is empty when the message carries no text at all', () {
      final msg = _message([_toolPart('x1')]);
      expect(msg.displayText, isEmpty);
    });
  });

  testWidgets('the bubble renders the tail text after a tool part', (
    tester,
  ) async {
    final msg = _message([
      _textPart('t1', '先看日志。'),
      _toolPart('x1'),
      _textPart('t2', '结论：升级依赖导致。'),
    ]);

    await tester.pumpWidget(
      MaterialApp(
        theme: mafwDarkTheme(),
        home: Scaffold(body: MafwMessageBubble(msg: msg)),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('先看日志。'), findsOneWidget);
    // RED 证据：只取首个 text part 时这一句永远渲染不出来。
    expect(find.textContaining('结论：升级依赖导致。'), findsOneWidget);
  });

  testWidgets('a user message pill renders every text part too', (
    tester,
  ) async {
    final msg = MafwMessage.fromJson({
      'id': 'u1',
      'sessionID': 'ses_1',
      'role': 'user',
      'content': [_textPart('t1', '第一段'), _textPart('t2', '第二段')],
    }, sessionID: 'ses_1');

    await tester.pumpWidget(
      MaterialApp(
        theme: mafwDarkTheme(),
        home: Scaffold(body: MafwMessageBubble(msg: msg)),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('第一段'), findsOneWidget);
    expect(find.textContaining('第二段'), findsOneWidget);
  });
}
