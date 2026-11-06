/// Table tests for [chatEventEffects] / [shouldRefreshSessions].
///
/// The expectation maps below are explicit for **every** canonical event name,
/// so adding vocabulary to `kMafwCanonicalEventTypes` (and its gateway mirror)
/// fails here until the consumer meaning is decided.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:orcalore_mobile/src/models/event_effects.dart';
import 'package:orcalore_mobile/src/models/mafw_models.dart';

void main() {
  group('chatEventEffects', () {
    const expected = <String, ChatEventEffects>{
      // session lifecycle — chat view is scoped to one session
      'session.created': ChatEventEffects.none,
      'session.updated': ChatEventEffects.none,
      'session.deleted': ChatEventEffects.none,
      // turn lifecycle
      'turn.started': ChatEventEffects(refresh: true),
      'turn.completed': ChatEventEffects(turnEnd: true, refresh: true),
      'turn.failed': ChatEventEffects(turnEnd: true, refresh: true),
      'turn.aborted': ChatEventEffects(turnEnd: true, refresh: true),
      // compaction
      'session.compacting': ChatEventEffects.none,
      'session.compacted': ChatEventEffects.none,
      // messages / parts
      'message.updated': ChatEventEffects(refresh: true),
      'part.updated': ChatEventEffects(writing: true, refresh: true),
      'part.delta': ChatEventEffects(writing: true, refresh: true),
      'part.complete': ChatEventEffects(refresh: true),
      // questions / approvals
      'question.asked': ChatEventEffects.none,
      'question.replied': ChatEventEffects.none,
      'question.rejected': ChatEventEffects.none,
      'permission.asked': ChatEventEffects.none,
      'permission.replied': ChatEventEffects.none,
      // data plane
      'plan.updated': ChatEventEffects.none,
      'usage.updated': ChatEventEffects.none,
      'queue.updated': ChatEventEffects.none,
      'task.updated': ChatEventEffects.none,
      'background.job.updated': ChatEventEffects.none,
      'pod.updated': ChatEventEffects.none,
      'session.config': ChatEventEffects.none,
      'session.checkpoint': ChatEventEffects.none,
      'run.updated': ChatEventEffects.none,
      'session.commands': ChatEventEffects.none,
      'trajectory.event': ChatEventEffects.none,
      'trajectory.turn': ChatEventEffects.none,
      'permission_mode': ChatEventEffects.none,
      'session.diff': ChatEventEffects.none,
    };

    test('expectation table covers exactly the canonical vocabulary', () {
      expect(
        expected.keys.toSet(),
        kMafwCanonicalEventTypes,
        reason: 'new canonical event needs an explicit chat meaning',
      );
    });

    test('every canonical event maps to its expected effect', () {
      for (final entry in expected.entries) {
        final actual = chatEventEffects(entry.key);
        expect(actual.writing, entry.value.writing, reason: entry.key);
        expect(actual.turnEnd, entry.value.turnEnd, reason: entry.key);
        expect(actual.refresh, entry.value.refresh, reason: entry.key);
      }
    });

    test('turn terminal events stop the writing phase', () {
      for (final type in const ['turn.completed', 'turn.failed', 'turn.aborted']) {
        expect(chatEventEffects(type).turnEnd, isTrue, reason: type);
      }
    });

    test('legacy names have no effect', () {
      for (final legacy in const [
        'opencode_event',
        '',
        'message.part.updated',
        'message.part.delta',
        'message.complete',
        'message.error',
        'session.idle',
      ]) {
        expect(chatEventEffects(legacy).any, isFalse, reason: legacy);
      }
    });

    test('plugin namespaced events have no chat effect', () {
      expect(chatEventEffects('plugin:example:progress').any, isFalse);
    });
  });

  group('shouldRefreshSessions', () {
    test('refreshes for session list and message/turn activity', () {
      for (final type in const [
        'session.created',
        'session.updated',
        'session.deleted',
        'message.updated',
        'turn.completed',
      ]) {
        expect(shouldRefreshSessions(type), isTrue, reason: type);
      }
    });

    test('ignores part deltas and unrelated data events', () {
      for (final type in const [
        'part.delta',
        'part.updated',
        'part.complete',
        'turn.started',
        'turn.failed',
        'turn.aborted',
        'plan.updated',
        'usage.updated',
        'background.job.updated',
        'permission.asked',
        'opencode_event',
        'message.part.delta',
        'session.idle',
        '',
      ]) {
        expect(shouldRefreshSessions(type), isFalse, reason: type);
      }
    });

    test('refresh triggers are a subset of the canonical vocabulary', () {
      expect(kMafwCanonicalEventTypes.containsAll(kSessionRefreshEventTypes), isTrue);
    });
  });
}
