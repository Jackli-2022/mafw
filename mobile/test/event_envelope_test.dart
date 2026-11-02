/// Canonical SSE/WS envelope golden — `mafw_event` only.
///
/// Contract source: `gateway/src/runtime/mafw-vocabulary.ts` (mirrored by
/// `packages/gateway-sdk/src/events.ts`). Legacy `opencode_event`,
/// `message.part.*` and `session.idle` names are gone — no fallback is kept.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:mafw_mobile/src/models/mafw_models.dart';

void main() {
  group('MafwEvent canonical envelope', () {
    test('canonical envelope exposes background job update', () {
      final ev = MafwEvent.fromJson({
        'type': 'mafw_event',
        'data': {
          'type': 'background.job.updated',
          'properties': {
            'job': {'id': 'task_1'},
          },
        },
      });
      expect(ev.innerType, 'background.job.updated');
      expect(ev.isCanonical, isTrue);
    });

    test('message.updated reads properties.message (flat message)', () {
      final ev = MafwEvent.fromJson({
        'type': 'mafw_event',
        'data': {
          'type': 'message.updated',
          'sessionID': 's1',
          'properties': {
            'message': {
              'id': 'm1',
              'sessionID': 's1',
              'role': 'assistant',
              'content': [
                {'id': 'p1', 'type': 'text', 'text': 'hello'},
              ],
            },
          },
        },
      });

      expect(ev.innerType, 'message.updated');
      expect(ev.sessionID, 's1');
      expect(ev.message?['id'], 'm1');
      expect(ev.messageID, 'm1');
    });

    test('sessionID falls back to the canonical message payload', () {
      final ev = MafwEvent.fromJson({
        'type': 'mafw_event',
        'data': {
          'type': 'message.updated',
          'properties': {
            'message': {'id': 'm1', 'sessionID': 's9', 'role': 'assistant'},
          },
        },
      });

      expect(ev.sessionID, 's9');
    });

    test('legacy opencode_event envelope is not canonical', () {
      final ev = MafwEvent.fromJson({
        'type': 'opencode_event',
        'data': {
          'type': 'message.part.delta',
          'properties': {'delta': 'x'},
        },
      });

      expect(ev.type, 'opencode_event');
      expect(ev.innerType, isEmpty);
      expect(ev.isCanonical, isFalse);
    });

    test('legacy inner type names are not recognised', () {
      for (final legacy in const [
        'message.part.updated',
        'message.part.delta',
        'message.complete',
        'message.error',
        'session.idle',
      ]) {
        final ev = MafwEvent.fromJson({
          'type': 'mafw_event',
          'data': {'type': legacy, 'properties': const <String, dynamic>{}},
        });
        expect(ev.innerType, isEmpty, reason: legacy);
        expect(ev.isCanonical, isFalse, reason: legacy);
      }
    });

    test('flat top-level broadcasts are not canonical envelopes', () {
      final ev = MafwEvent.fromJson({
        'type': 'goal_created',
        'goalId': 'g1',
      });

      expect(ev.type, 'goal_created');
      expect(ev.innerType, isEmpty);
      expect(ev.isCanonical, isFalse);
    });

    test('canonical turn and part vocabulary is recognised', () {
      for (final type in const [
        'turn.started',
        'turn.completed',
        'turn.failed',
        'turn.aborted',
        'part.updated',
        'part.delta',
        'part.complete',
        'permission.asked',
        'session.created',
        'session.updated',
        'session.deleted',
        'session.compacted',
      ]) {
        final ev = MafwEvent.fromJson({
          'type': 'mafw_event',
          'data': {'type': type, 'properties': const <String, dynamic>{}},
        });
        expect(ev.innerType, type, reason: type);
      }
    });
  });
}
