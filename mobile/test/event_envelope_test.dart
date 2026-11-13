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
          'pod.updated',
          'pod.event',
          'run.updated',
        ]),
      );
      for (final flat in kMafwFlatEventTypes) {
        if (kMafwDualShapeEventTypes.contains(flat)) {
          // Dual-shape names (E9-1): the gateway emits them as top-level flat
          // frames (`{type, properties}`) while their names are also canonical
          // (`RUNTIME_EVENT_TYPES`), so a `mafw_event`-wrapped variant stays
          // valid. Both shapes must parse.
          expect(kMafwCanonicalEventTypes.contains(flat), isTrue, reason: flat);
          expect(canonicalEventTypeOf(flat), flat, reason: flat);
          continue;
        }
        expect(kMafwCanonicalEventTypes.contains(flat), isFalse, reason: flat);
        expect(canonicalEventTypeOf(flat), isEmpty, reason: flat);
      }
    });

    test('pod.updated / pod.event / run.updated keep their flat frame payload', () {
      for (final type in const ['pod.updated', 'pod.event', 'run.updated']) {
        final ev = MafwEvent.fromJson({
          'type': type,
          'properties': <String, dynamic>{
            'podId': 'pod-1',
            'kind': 'task',
            'goalId': 'goal-9',
          },
        });

        expect(ev.type, type);
        expect(ev.innerType, isEmpty, reason: type);
        expect(ev.isCanonical, isFalse, reason: type);
        expect(ev.isFlatBroadcast, isTrue, reason: type);
        // The frame itself is kept, so `properties` stays readable.
        expect(ev.data['type'], type, reason: type);
        expect(ev.data['properties'], isNotNull, reason: type);
        expect(ev.goalId, 'goal-9', reason: type);
        expect(ev.podId, 'pod-1', reason: type);
      }
    });

    test('unknown frames keep an empty data map', () {
      final ev = MafwEvent.fromJson({
        'type': 'mystery.broadcast',
        'goalId': 'goal-1',
      });

      expect(ev.type, 'mystery.broadcast');
      expect(ev.isFlatBroadcast, isFalse);
      expect(ev.data, isEmpty);
      expect(ev.goalId, isNull);
    });

    test('goalId falls back properties → data for flat and canonical frames', () {
      // flat with nested properties (pod.updated shape)
      expect(
        MafwEvent.fromJson({
          'type': 'pod.updated',
          'properties': <String, dynamic>{'podId': 'pod-1', 'goalId': 'g-props'},
        }).goalId,
        'g-props',
      );
      // flat top-level payload (goal_node) is unchanged
      expect(
        MafwEvent.fromJson({'type': 'goal_node', 'goalId': 'g-flat'}).goalId,
        'g-flat',
      );
      // canonical properties
      expect(
        MafwEvent.fromJson({
          'type': kMafwEventEnvelope,
          'data': {
            'type': 'pod.event',
            'properties': <String, dynamic>{'goalId': 'g-canon'},
          },
        }).goalId,
        'g-canon',
      );
      // canonical top-level data (no properties)
      expect(
        MafwEvent.fromJson({
          'type': kMafwEventEnvelope,
          'data': {'type': 'run.updated', 'goalId': 'g-data'},
        }).goalId,
        'g-data',
      );
      // malformed values read as null
      expect(
        MafwEvent.fromJson({
          'type': 'pod.updated',
          'properties': <String, dynamic>{'goalId': 42},
        }).goalId,
        isNull,
      );
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

    test('canonical envelopes expose goalId but keep flat-only fields empty', () {
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
      // E9-1: `goalId` is part of the envelope contract (properties → data), so
      // the work tab can patch in place for canonical pod/run frames too.
      expect(ev.goalId, 'goal-1');
      // Remaining flat-only accessors stay flat-only.
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
