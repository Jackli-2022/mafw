/// E5b-2 `MafwEvent.seq` + `EventReplayPage` + `GatewayClient.replayEvents`.
///
/// Wire contract source: `gateway/src/routes/events-replay.ts` (handler is the
/// truth) — `{events:[{seq, ts, type, sessionId, envelope}], headSeq, oldestSeq,
/// hasMore, nextSince, reset, truncated}`.
///
/// Consumer contract (spec §3.3/§4.2): the column `seq`/`ts` win over anything
/// the stored envelope carries, so a replay item can never lose its cursor even
/// when the original event object had no `seq` (flat broadcasts).
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';

GatewayClient _client(http_testing.MockClient mock) => GatewayClient(
      const ConnectionConfig(baseUrl: 'http://localhost:3000', apiToken: 't'),
      httpClient: mock,
    );

http.Response _json(Object body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

Map<String, dynamic> _canonicalEnvelope({
  String innerType = 'message.updated',
  String sessionID = 's1',
}) =>
    {
      'type': 'mafw_event',
      'data': {
        'type': innerType,
        'sessionID': sessionID,
      },
    };

void main() {
  group('MafwEvent.seq', () {
    test('reads the top-level frame seq (SSE id / WS frame)', () {
      final ev = MafwEvent.fromJson({
        ..._canonicalEnvelope(),
        'seq': 41,
      });

      expect(ev.seq, 41);
      expect(ev.innerType, 'message.updated');
    });

    test('falls back to the canonical inner data.seq', () {
      final ev = MafwEvent.fromJson({
        'type': 'mafw_event',
        'data': {'type': 'message.updated', 'seq': 42},
      });

      expect(ev.seq, 42);
    });

    test('prefers the top-level seq over the inner one', () {
      final ev = MafwEvent.fromJson({
        'type': 'mafw_event',
        'seq': 7,
        'data': {'type': 'message.updated', 'seq': 42},
      });

      expect(ev.seq, 7);
    });

    test('stays null when the frame carries no seq (non-persisted delta)', () {
      final ev = MafwEvent.fromJson({
        'type': 'mafw_event',
        'data': {'type': 'message.part.delta', 'properties': {'delta': 'x'}},
      });

      expect(ev.seq, isNull);
    });

    test('reads seq on flat broadcast frames', () {
      final ev = MafwEvent.fromJson({
        'type': 'goal_created',
        'goalId': 'g1',
        'seq': 5,
      });

      expect(ev.seq, 5);
      expect(ev.goalId, 'g1');
    });

    test('connected greeting exposes headSeq from the payload', () {
      final ev = MafwEvent.fromJson({'type': 'connected', 'headSeq': 99});

      expect(ev.headSeq, 99);
    });

    test('connected greeting exposes instanceId from the payload', () {
      final ev = MafwEvent.fromJson({
        'type': 'connected',
        'vocab': 'v2',
        'headSeq': 99,
        'instanceId': 'inst-abc',
      });

      expect(ev.headSeq, 99);
      expect(ev.instanceId, 'inst-abc');
    });

    test('greeting accessors are null when the fields are absent or null', () {
      final absent = MafwEvent.fromJson({'type': 'connected'});
      expect(absent.headSeq, isNull);
      expect(absent.instanceId, isNull);

      // An old gateway already emits `headSeq: null`; `instanceId` follows the
      // same additive shape.
      final nulls = MafwEvent.fromJson({
        'type': 'connected',
        'headSeq': null,
        'instanceId': null,
      });
      expect(nulls.headSeq, isNull);
      expect(nulls.instanceId, isNull);
    });

    test('a non-greeting frame does not invent greeting fields', () {
      final ev = MafwEvent.fromJson({
        'type': 'mafw_event',
        'data': {'type': 'message.updated', 'headSeq': 5, 'instanceId': 'x'},
      });

      expect(ev.headSeq, isNull);
      expect(ev.instanceId, isNull);
    });
  });

  group('MafwEvent recovery provenance', () {
    test('wire frames are live, not recovered', () {
      final ev = MafwEvent.fromJson({
        ..._canonicalEnvelope(),
        'seq': 11,
      });

      expect(ev.recovered, isFalse);
    });

    test('asRecovered keeps the frame identity and marks provenance', () {
      final live = MafwEvent.fromJson({
        ..._canonicalEnvelope(),
        'seq': 11,
      });

      final recovered = live.asRecovered();

      expect(recovered.recovered, isTrue);
      expect(recovered.type, live.type);
      expect(recovered.innerType, live.innerType);
      expect(recovered.sessionID, live.sessionID);
      expect(recovered.seq, 11);
    });
  });

  group('EventReplayPage.fromJson', () {
    test('parses the page and merges column seq into each envelope', () {
      final page = EventReplayPage.fromJson({
        'events': [
          {
            'seq': 7,
            'ts': '2026-11-12T01:02:03.000Z',
            'type': 'mafw_event',
            'sessionId': 's1',
            'envelope': _canonicalEnvelope(),
          },
        ],
        'headSeq': 10,
        'oldestSeq': 3,
        'hasMore': true,
        'nextSince': 7,
        'reset': false,
        'truncated': false,
      });

      expect(page.events, hasLength(1));
      expect(page.events.single.seq, 7);
      expect(page.events.single.innerType, 'message.updated');
      expect(page.headSeq, 10);
      expect(page.oldestSeq, 3);
      expect(page.hasMore, isTrue);
      expect(page.nextSince, 7);
      expect(page.reset, isFalse);
      expect(page.truncated, isFalse);
    });

    test('keeps flat envelopes and their top-level payload', () {
      final page = EventReplayPage.fromJson({
        'events': [
          {
            'seq': 8,
            'ts': '2026-11-12T01:02:03.000Z',
            'type': 'goal_created',
            'sessionId': null,
            'envelope': {'type': 'goal_created', 'goalId': 'g9'},
          },
        ],
        'headSeq': 8,
        'oldestSeq': 1,
        'hasMore': false,
        'nextSince': 8,
        'reset': false,
        'truncated': false,
      });

      expect(page.events.single.seq, 8);
      expect(page.events.single.goalId, 'g9');
    });

    test('defaults missing counters and flags', () {
      final page = EventReplayPage.fromJson({'events': []});

      expect(page.events, isEmpty);
      expect(page.headSeq, 0);
      expect(page.oldestSeq, 0);
      expect(page.hasMore, isFalse);
      expect(page.nextSince, 0);
      expect(page.reset, isFalse);
      expect(page.truncated, isFalse);
    });
  });

  group('GatewayClient.replayEvents', () {
    test('GETs /api/events/replay with since/limit and auth headers', () async {
      http.Request? seen;
      final client = _client(http_testing.MockClient((request) async {
        seen = request;
        return _json({
          'events': [],
          'headSeq': 0,
          'oldestSeq': 0,
          'hasMore': false,
          'nextSince': 12,
          'reset': false,
          'truncated': false,
        });
      }));

      final page = await client.replayEvents(since: 12, limit: 250);

      expect(seen, isNotNull);
      expect(seen!.method, 'GET');
      expect(seen!.url.path, '/api/events/replay');
      expect(seen!.url.queryParameters, {'since': '12', 'limit': '250'});
      expect(seen!.headers['Authorization'], 'Bearer t');
      expect(page, isNotNull);
      expect(page!.nextSince, 12);
    });

    test('uses the default page size of 500', () async {
      Uri? seen;
      final client = _client(http_testing.MockClient((request) async {
        seen = request.url;
        return _json({
          'events': [],
          'headSeq': 1,
          'oldestSeq': 1,
          'hasMore': false,
          'nextSince': 1,
        });
      }));

      await client.replayEvents(since: 1);

      expect(seen!.queryParameters['limit'], '500');
    });

    test('merges the column seq into envelopes that carry none', () async {
      final client = _client(http_testing.MockClient((_) async => _json({
            'events': [
              {
                'seq': 21,
                'ts': '2026-11-12T01:02:03.000Z',
                'type': 'mafw_event',
                'sessionId': 's1',
                'envelope': _canonicalEnvelope(),
              },
            ],
            'headSeq': 21,
            'oldestSeq': 1,
            'hasMore': false,
            'nextSince': 21,
          })));

      final page = await client.replayEvents(since: 20);

      expect(page, isNotNull);
      expect(page!.events.single.seq, 21);
      expect(page.events.single.innerType, 'message.updated');
    });

    test('returns null on 404 (old gateway without replay)', () async {
      final client = _client(
        http_testing.MockClient((_) async => http.Response('Not Found', 404)),
      );

      expect(await client.replayEvents(since: 1), isNull);
    });

    test('returns null on an HTML 200 (reverse proxy / SPA fallback)', () async {
      final client = _client(http_testing.MockClient(
        (_) async => http.Response(
          '<!doctype html><html><body>index</body></html>',
          200,
          headers: {'content-type': 'text/html'},
        ),
      ));

      expect(await client.replayEvents(since: 1), isNull);
    });

    test('returns null on 503 (event store unavailable)', () async {
      final client = _client(http_testing.MockClient(
        (_) async => _json({'error': 'event store unavailable'}, 503),
      ));

      expect(await client.replayEvents(since: 1), isNull);
    });

    test('throws GatewayException on 400 (client bug, no retry)', () async {
      final client = _client(http_testing.MockClient(
        (_) async => _json({'error': 'invalid since'}, 400),
      ));

      await expectLater(
        client.replayEvents(since: -1),
        throwsA(
          isA<GatewayException>().having((e) => e.statusCode, 'statusCode', 400),
        ),
      );
    });

    test('throws on other non-2xx responses', () async {
      final client = _client(http_testing.MockClient(
        (_) async => _json({'error': 'boom'}, 500),
      ));

      await expectLater(
        client.replayEvents(since: 1),
        throwsA(
          isA<GatewayException>().having((e) => e.statusCode, 'statusCode', 500),
        ),
      );
    });

    test('throws when the gateway stalls past the replay timeout', () async {
      final client = _client(
        http_testing.MockClient((_) => Completer<http.Response>().future),
      );

      await expectLater(
        client.replayEvents(
          since: 1,
          timeout: const Duration(milliseconds: 20),
        ),
        throwsA(isA<TimeoutException>()),
      );
    });
  });
}
