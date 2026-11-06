/// Canonical SSE/WS envelope golden — `mafw_event` only.
///
/// Contract source: `gateway/src/runtime/mafw-vocabulary.ts` (mirrored by
/// `packages/gateway-sdk/src/events.ts`). Legacy `opencode_event`,
/// `message.part.*` and `session.idle` names are gone — no fallback is kept.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:orcalore_mobile/src/models/mafw_models.dart';

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

  // Flat top-level broadcasts (`packages/gateway-sdk/src/events.ts`
  // FLAT_EVENT_TYPES) are not `mafw_event` envelopes: the frame keeps its own
  // `type`, `innerType` is empty, and the payload fields live at the top level
  // of the frame.
  group('MafwEvent flat broadcast payloads', () {
    test('registers the flat vocabulary and keeps it out of canonical', () {
      expect(
        kMafwFlatEventTypes,
        containsAll(<String>[
          'goal_node',
          'phase_transition',
          'state_change',
          'user_question',
        ]),
      );
      for (final flat in kMafwFlatEventTypes) {
        expect(kMafwCanonicalEventTypes.contains(flat), isFalse, reason: flat);
        expect(canonicalEventTypeOf(flat), isEmpty, reason: flat);
      }
    });

    test('goal_node exposes its lifecycle payload fields', () {
      final ev = MafwEvent.fromJson({
        'type': 'goal_node',
        'goalId': 'goal-1',
        'projectDir': '/repo',
        'loop': 2,
        'revision': 3,
        'node': 'execute',
        'transition': 'started',
        'attempt': 1,
        'at': '2026-11-06T00:00:00.000Z',
      });

      expect(ev.type, 'goal_node');
      expect(ev.innerType, isEmpty);
      expect(ev.isCanonical, isFalse);
      expect(ev.isFlatBroadcast, isTrue);
      expect(ev.goalId, 'goal-1');
      expect(ev.loop, 2);
      expect(ev.revision, 3);
      expect(ev.node, 'execute');
      expect(ev.transition, 'started');
      expect(ev.attempt, 1);
      expect(ev.phase, isNull);
      expect(ev.verdict, isNull);
      expect(ev.error, isNull);
    });

    test('goal_node failure frames expose verdict and error', () {
      final ev = MafwEvent.fromJson({
        'type': 'goal_node',
        'goalId': 'goal-1',
        'loop': 1,
        'revision': 1,
        'node': 'plan',
        'transition': 'failed',
        'verdict': 'FAIL',
        'error': 'artifact_missing',
        'attempt': 2,
      });

      expect(ev.transition, 'failed');
      expect(ev.verdict, 'FAIL');
      expect(ev.error, 'artifact_missing');
      expect(ev.attempt, 2);
    });

    test('phase_transition / state_change / user_question payloads', () {
      final phase = MafwEvent.fromJson({
        'type': 'phase_transition',
        'goalId': 'goal-1',
        'phase': 'EXECUTING',
        'loop': 1,
        'revision': 4,
      });
      expect(phase.isFlatBroadcast, isTrue);
      expect(phase.goalId, 'goal-1');
      expect(phase.phase, 'EXECUTING');
      expect(phase.loop, 1);
      expect(phase.revision, 4);
      expect(phase.node, isNull);

      final state = MafwEvent.fromJson({
        'type': 'state_change',
        'goalId': 'goal-2',
        'projectDir': '/repo',
      });
      expect(state.goalId, 'goal-2');
      expect(state.phase, isNull);
      expect(state.loop, isNull);

      final question = MafwEvent.fromJson({
        'type': 'user_question',
        'goalId': 'goal-3',
        'questionId': 'q1',
        'question': 'Proceed?',
      });
      expect(question.goalId, 'goal-3');
      expect(question.verdict, isNull);
      expect(question.error, isNull);
    });

    test('malformed flat payload fields read as null', () {
      final ev = MafwEvent.fromJson({
        'type': 'goal_node',
        'goalId': 42,
        'loop': 'two',
        'node': '',
      });

      expect(ev.goalId, isNull);
      expect(ev.loop, isNull);
      expect(ev.node, isNull);
      expect(ev.transition, isNull);
    });

    test('canonical envelopes expose no flat payload fields', () {
      final ev = MafwEvent.fromJson({
        'type': 'mafw_event',
        'data': {
          'type': 'pod.event',
          'properties': {
            'goalId': 'goal-1',
            'revision': 2,
          },
        },
      });

      expect(ev.isCanonical, isTrue);
      expect(ev.isFlatBroadcast, isFalse);
      expect(ev.goalId, isNull);
      expect(ev.revision, isNull);
      expect(ev.loop, isNull);
      expect(ev.node, isNull);
    });

    test('legacy frames are not flat broadcasts', () {
      final ev = MafwEvent.fromJson({
        'type': 'opencode_event',
        'goalId': 'goal-1',
      });

      expect(ev.isFlatBroadcast, isFalse);
      expect(ev.goalId, isNull);
    });
  });
}
