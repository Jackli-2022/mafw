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
      // Pod 事件层：work tab 负责刷新，chat view 无 effect（Task 5 改为 refreshWork）。
      'pod.event': ChatEventEffects.none,
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

  // Work-overview refresh is deliberately a separate table from
  // [kChatEventEffectTable]: `pod.event` must refresh the work tab without
  // touching the chat bubbles, and flat goal frames have no chat consumer.
  group('shouldRefreshWork', () {
    const expectedCanonical = <String, bool>{
      // session lifecycle — the work tab is project-scoped, not session-scoped
      'session.created': false,
      'session.updated': false,
      'session.deleted': false,
      // turn lifecycle
      'turn.started': false,
      'turn.completed': false,
      'turn.failed': false,
      'turn.aborted': false,
      // compaction
      'session.compacting': false,
      'session.compacted': false,
      // messages / parts
      'message.updated': false,
      'part.updated': false,
      'part.delta': false,
      'part.complete': false,
      // questions / approvals
      'question.asked': false,
      'question.replied': false,
      'question.rejected': false,
      'permission.asked': false,
      'permission.replied': false,
      // data plane
      'plan.updated': false,
      'usage.updated': false,
      'queue.updated': false,
      'task.updated': false,
      'background.job.updated': false,
      // Pod / work read-model signals
      'pod.updated': true,
      'pod.event': true,
      'session.config': false,
      'session.checkpoint': false,
      'run.updated': true,
      'session.commands': false,
      'trajectory.event': false,
      'trajectory.turn': false,
      'permission_mode': false,
      'session.diff': false,
    };

    const expectedFlat = <String, bool>{
      // agentic goal loop — reorder the work buckets on every transition
      'goal_node': true,
      'phase_transition': true,
      'state_change': true,
      'user_question': true,
      // other flat broadcasts carry no work-overview meaning on mobile
      'user_feedback': false,
      'goal_created': false,
      'memory_written': false,
      'memory_energy_changed': false,
      'memory_distillation_complete': false,
      'automation_triggered': false,
      'automation_completed': false,
      'project_registered': false,
      'runtime_switched': false,
      'mafw_commands_changed': false,
      'plugins.changed': false,
      'connected': false,
    };

    test('canonical expectation table covers exactly the canonical vocabulary', () {
      expect(
        expectedCanonical.keys.toSet(),
        kMafwCanonicalEventTypes,
        reason: 'new canonical event needs an explicit work-refresh meaning',
      );
    });

    test('flat expectation table covers exactly the flat vocabulary', () {
      expect(
        expectedFlat.keys.toSet(),
        kMafwFlatEventTypes,
        reason: 'new flat broadcast needs an explicit work-refresh meaning',
      );
    });

    test('canonical envelopes resolve their work-refresh meaning', () {
      for (final entry in expectedCanonical.entries) {
        final ev = MafwEvent.fromJson({
          'type': kMafwEventEnvelope,
          'data': {
            'type': entry.key,
            'properties': const <String, dynamic>{},
          },
        });
        expect(shouldRefreshWork(ev), entry.value, reason: entry.key);
      }
    });

    test('flat broadcasts resolve their work-refresh meaning', () {
      for (final entry in expectedFlat.entries) {
        final ev = MafwEvent.fromJson({'type': entry.key});
        expect(shouldRefreshWork(ev), entry.value, reason: entry.key);
      }
    });

    test('work refresh and chat effects stay independent', () {
      // `pod.event` refreshes work but must not wake the chat bubbles.
      final podEvent = MafwEvent.fromJson({
        'type': kMafwEventEnvelope,
        'data': {
          'type': 'pod.event',
          'properties': const <String, dynamic>{},
        },
      });
      expect(shouldRefreshWork(podEvent), isTrue);
      expect(chatEventEffects('pod.event').any, isFalse);

      // Flat frames never have a chat effect.
      for (final flat in kWorkRefreshFlatEventTypes) {
        final ev = MafwEvent.fromJson({'type': flat});
        expect(shouldRefreshWork(ev), isTrue, reason: flat);
        expect(chatEventEffects(ev.innerType).any, isFalse, reason: flat);
      }
    });

    test('legacy and empty frames do not refresh work', () {
      for (final type in const ['', 'opencode_event', 'message.part.delta']) {
        expect(shouldRefreshWork(MafwEvent(type: type)), isFalse, reason: type);
      }
    });

    test('refreshWork triggers stay inside their vocabularies', () {
      expect(
        kMafwCanonicalEventTypes.containsAll(kWorkRefreshCanonicalEventTypes),
        isTrue,
      );
      expect(kMafwFlatEventTypes.containsAll(kWorkRefreshFlatEventTypes), isTrue);
      expect(
        kMafwCanonicalEventTypes.intersection(kWorkRefreshFlatEventTypes),
        isEmpty,
      );
    });
  });
}
