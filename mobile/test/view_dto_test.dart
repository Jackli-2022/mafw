/// MAFW View DTO golden — flat history shapes only.
///
/// Contract source: `packages/gateway-sdk/src/view-dto.ts` (MAFW View DTO) served by
/// `GET /api/sessions/:id/messages`. There is **no** legacy fallback:
/// a `{info, parts}` wire item must not be parsed.
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;

import 'package:mafw_mobile/src/config/connection_config.dart';
import 'package:mafw_mobile/src/models/mafw_models.dart';
import 'package:mafw_mobile/src/network/gateway_client.dart';

void main() {
  group('MafwMessage flat DTO', () {
    test('flat history parses content parts without info envelope', () {
      final msg = MafwMessage.fromJson({
        'id': 'm1',
        'sessionID': 's1',
        'role': 'assistant',
        'content': [
          {
            'id': 'p1',
            'type': 'tool',
            'tool': 'shell',
            'state': {'status': 'completed'},
          },
        ],
      }, sessionID: 's1');
      expect(msg.text, isNull);
      expect(msg.parts.single.tool, 'shell');
    });

    test('text is derived from the first text content part', () {
      final msg = MafwMessage.fromJson({
        'id': 'm2',
        'sessionID': 's1',
        'role': 'assistant',
        'content': [
          {'id': 'p1', 'type': 'reasoning', 'text': 'thinking'},
          {'id': 'p2', 'type': 'text', 'text': 'hello'},
        ],
        'time': {'created': 1700000000000},
      }, sessionID: 's1');

      expect(msg.text, 'hello');
      expect(msg.parts.length, 2);
      expect(msg.timeCreated, 1700000000000);
    });

    test('sessionID falls back to the caller session when the DTO omits it', () {
      final msg = MafwMessage.fromJson({
        'id': 'm3',
        'role': 'user',
        'content': [
          {'id': 'p1', 'type': 'text', 'text': 'hi'},
        ],
      }, sessionID: 'caller');

      expect(msg.sessionID, 'caller');
    });

    test('legacy wire item ({info, parts}) is not parsed', () {
      final msg = MafwMessage.fromJson({
        'info': {'id': 'm1', 'role': 'assistant'},
        'parts': [
          {'id': 'p1', 'type': 'text', 'text': 'legacy'},
        ],
      }, sessionID: 's1');

      expect(msg.id, isEmpty);
      expect(msg.role, isEmpty);
      expect(msg.text, isNull);
      expect(msg.parts, isEmpty);
    });

    test('tool part exposes neutral toolClass/canonicalTool/state', () {
      final part = MafwPart.fromJson({
        'id': 'p1',
        'type': 'tool',
        'callID': 'call_1',
        'tool': 'bash',
        'toolClass': 'shell',
        'canonicalTool': 'bash',
        'state': {
          'status': 'completed',
          'title': 'Run tests',
          'output': 'ok',
        },
      });

      expect(part.isTool, isTrue);
      expect(part.toolClass, 'shell');
      expect(part.canonicalTool, 'bash');
      expect(part.displayTool, 'bash');
      expect(part.toolStatus, 'completed');
      expect(part.toolTitle, 'Run tests');
      expect(part.toolOutput, 'ok');
    });

    test('canonicalTool wins over the runtime native tool name', () {
      final part = MafwPart.fromJson({
        'id': 'p2',
        'type': 'tool',
        'tool': 'command_execution',
        'canonicalTool': 'bash',
        'state': {'status': 'running'},
      });

      expect(part.displayTool, 'bash');
    });
  });

  group('GatewayClient flat history', () {
    test('requests the flat history endpoint without a format opt-in', () async {
      late http.Request captured;
      final mockClient = http_testing.MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'data': [
              {
                'id': 'm1',
                'sessionID': 's1',
                'role': 'assistant',
                'content': [
                  {'id': 'p1', 'type': 'text', 'text': 'hello'},
                ],
                'time': {'created': 1700000000000},
              },
            ],
            'nextCursor': null,
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      final client = GatewayClient(
        const ConnectionConfig(baseUrl: 'http://localhost:3000', apiToken: 't'),
        httpClient: mockClient,
      );

      final messages = await client.messages('s1', limit: 10);

      expect(captured.url.path, '/api/sessions/s1/messages');
      expect(captured.url.queryParameters.containsKey('format'), isFalse);
      expect(captured.url.queryParameters['limit'], '10');
      expect(messages.single.id, 'm1');
      expect(messages.single.text, 'hello');
    });

    test('throws an actionable error when the page is all legacy wire items', () async {
      final mockClient = http_testing.MockClient((request) async {
        return http.Response(
          jsonEncode({
            'data': [
              {
                'info': {'id': 'wire-1', 'role': 'assistant'},
                'parts': [
                  {'id': 'p1', 'type': 'text', 'text': 'legacy'},
                ],
              },
            ],
            'nextCursor': null,
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      final client = GatewayClient(
        const ConnectionConfig(baseUrl: 'http://localhost:3000', apiToken: 't'),
        httpClient: mockClient,
      );

      expect(
        client.messages('s1'),
        throwsA(
          isA<GatewayException>().having(
            (e) => e.message,
            'message',
            contains('gateway did not return the MAFW flat history contract — upgrade gateway'),
          ),
        ),
      );
    });

    test('keeps valid messages when only some items are unparseable', () async {
      final mockClient = http_testing.MockClient((request) async {
        return http.Response(
          jsonEncode({
            'data': [
              {
                'info': {'id': 'wire-1', 'role': 'assistant'},
                'parts': const [],
              },
              {
                'id': 'm1',
                'sessionID': 's1',
                'role': 'assistant',
                'content': [
                  {'id': 'p1', 'type': 'text', 'text': 'flat'},
                ],
              },
            ],
            'nextCursor': null,
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      final client = GatewayClient(
        const ConnectionConfig(baseUrl: 'http://localhost:3000', apiToken: 't'),
        httpClient: mockClient,
      );

      final messages = await client.messages('s1');
      expect(messages.length, 2);
      expect(messages.last.text, 'flat');
    });

    test('empty history is not treated as a contract violation', () async {
      final mockClient = http_testing.MockClient((request) async {
        return http.Response(
          jsonEncode({'data': const [], 'nextCursor': null}),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      final client = GatewayClient(
        const ConnectionConfig(baseUrl: 'http://localhost:3000', apiToken: 't'),
        httpClient: mockClient,
      );

      expect(await client.messages('s1'), isEmpty);
    });
  });
}
