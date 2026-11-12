/// E5b-3 `RecoveryCoordinator`: greeting → baseline/replay → refresh order.
///
/// `main.dart` wiring is a widget-level concern; the decision tree lives here so
/// it can be unit tested: what a `connected` greeting does for a first connect
/// (baseline only) versus a reconnect (replay, then refresh), and which
/// fallbacks force a full reload.
///
/// Contract (spec §4.4):
///  - first connect, no cursor → baseline `headSeq`, no replay, no refresh;
///  - persisted cursor → replay is drained **before** the refresh callbacks;
///  - reset / truncated / unsupported / error / epoch change → refresh **and**
///    a full reload (the gap cannot be bridged);
///  - reconnect with a clean gap → refresh only.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/services/event_recovery.dart';
import 'package:orcalore_mobile/src/services/recovery_coordinator.dart';

MafwEvent _event(int seq) => MafwEvent(
      type: 'mafw_event',
      innerType: 'message.updated',
      seq: seq,
    );

MafwEvent _greeting({int? headSeq, String? instanceId}) => MafwEvent.fromJson({
      'type': 'connected',
      'headSeq': headSeq,
      'instanceId': instanceId,
    });

EventReplayPage _page({
  List<MafwEvent> events = const [],
  int headSeq = 10,
  int oldestSeq = 1,
  bool hasMore = false,
  int nextSince = 0,
  bool reset = false,
  bool truncated = false,
}) =>
    EventReplayPage(
      events: events,
      headSeq: headSeq,
      oldestSeq: oldestSeq,
      hasMore: hasMore,
      nextSince: nextSince,
      reset: reset,
      truncated: truncated,
    );

class _Harness {
  _Harness({
    int? cursor,
    String? instanceId,
    required Future<EventReplayPage?> Function(int since, int limit) fetch,
    bool throwRefresh = false,
  }) : store = MemoryEventCursorStore(seq: cursor, instanceId: instanceId) {
    recovery = EventRecoveryService(
      fetch: (since, limit) {
        fetchCalls.add(since);
        return fetch(since, limit);
      },
      cursorStore: store,
      emit: (event) {
        emitted.add(event);
        log.add('emit:${event.seq}');
      },
      onFallback: fallbacks.add,
    );
    coordinator = RecoveryCoordinator(
      recovery: recovery,
      onRefresh: () async {
        log.add('refresh');
        if (throwRefresh) throw StateError('refresh failed');
      },
      onFullReload: () async => log.add('reload'),
    );
  }

  final MemoryEventCursorStore store;
  final List<MafwEvent> emitted = [];
  final List<String> log = [];
  final List<int> fetchCalls = [];
  final List<RecoveryFallback> fallbacks = [];
  late final EventRecoveryService recovery;
  late final RecoveryCoordinator coordinator;

  Future<void> init() => recovery.init();
}

void main() {
  group('RecoveryCoordinator first connect', () {
    test('baselines headSeq/instanceId without replaying or refreshing', () async {
      final h = _Harness(fetch: (_, _) => throw StateError('must not fetch'));
      await h.init();

      final result = await h.coordinator.handle(
        _greeting(headSeq: 12, instanceId: 'inst-a'),
        isReconnect: false,
      );

      expect(h.recovery.cursor, 12);
      expect(h.recovery.instanceId, 'inst-a');
      expect(h.fetchCalls, isEmpty);
      expect(h.emitted, isEmpty);
      expect(h.log, isEmpty);
      expect(result.refreshed, isFalse);
      expect(result.fullReload, isFalse);
      expect(result.baselined, isTrue);
      expect(result.applied, 0);
      expect(result.fallback, isNull);
    });

    test('greeting without headSeq keeps the cursor untouched', () async {
      final h = _Harness(fetch: (_, _) => throw StateError('must not fetch'));
      await h.init();

      final result = await h.coordinator.handle(
        _greeting(headSeq: null, instanceId: 'inst-a'),
        isReconnect: false,
      );

      expect(h.recovery.cursor, isNull);
      expect(h.log, isEmpty);
      expect(result.refreshed, isFalse);
    });

    test('cold start with a persisted cursor replays then refreshes', () async {
      final h = _Harness(
        cursor: 5,
        instanceId: 'inst-a',
        fetch: (since, limit) async =>
            _page(events: [_event(6), _event(7)], headSeq: 7, nextSince: 7),
      );
      await h.init();

      final result = await h.coordinator.handle(
        _greeting(headSeq: 7, instanceId: 'inst-a'),
        isReconnect: false,
      );

      expect(h.fetchCalls, [5]);
      expect(h.emitted.map((e) => e.seq), [6, 7]);
      expect(h.log, ['emit:6', 'emit:7', 'refresh']);
      expect(result.applied, 2);
      expect(result.refreshed, isTrue);
      expect(result.fullReload, isFalse);
    });
  });

  group('RecoveryCoordinator reconnect', () {
    test('drains the replay before the refresh callbacks', () async {
      final h = _Harness(
        cursor: 10,
        instanceId: 'inst-a',
        fetch: (since, limit) async => _page(
          events: [_event(11)],
          headSeq: 11,
          nextSince: 11,
          hasMore: true,
        ),
      );
      await h.init();

      final result = await h.coordinator.handle(
        _greeting(headSeq: 12, instanceId: 'inst-a'),
        isReconnect: true,
      );

      // Cursor is at 11 after the page; the follow-up page repeats `nextSince`
      // and the loop stops on the no-progress guard.
      expect(h.log, ['emit:11', 'refresh']);
      expect(result.refreshed, isTrue);
      expect(result.fullReload, isFalse);
      expect(result.applied, 1);
    });

    test('reconnect with no gap still refreshes (delta frames are lost)', () async {
      final h = _Harness(
        cursor: 10,
        instanceId: 'inst-a',
        fetch: (since, limit) async => _page(headSeq: 10, nextSince: 10),
      );
      await h.init();

      final result = await h.coordinator.handle(
        _greeting(headSeq: 10, instanceId: 'inst-a'),
        isReconnect: true,
      );

      expect(h.emitted, isEmpty);
      expect(h.log, ['refresh']);
      expect(result.refreshed, isTrue);
      expect(result.fullReload, isFalse);
      expect(result.applied, 0);
    });

    test('unsupported replay refreshes and falls back to a full reload', () async {
      final h = _Harness(
        cursor: 10,
        instanceId: 'inst-a',
        fetch: (_, _) async => null,
      );
      await h.init();

      final result = await h.coordinator.handle(
        _greeting(headSeq: 10, instanceId: 'inst-a'),
        isReconnect: true,
      );

      expect(h.log, ['refresh', 'reload']);
      expect(h.fallbacks, [RecoveryFallback.unsupported]);
      expect(result.refreshed, isTrue);
      expect(result.fullReload, isTrue);
      expect(result.fallback, RecoveryFallback.unsupported);
    });

    test('reset / truncated replay also reloads in full', () async {
      for (final reset in [true, false]) {
        final h = _Harness(
          cursor: 3,
          instanceId: 'inst-a',
          fetch: (_, _) async =>
              _page(headSeq: 40, nextSince: 3, reset: reset, truncated: !reset),
        );
        await h.init();

        final result = await h.coordinator.handle(
          _greeting(headSeq: 40, instanceId: 'inst-a'),
          isReconnect: true,
        );

        expect(h.log, ['refresh', 'reload']);
        expect(h.recovery.cursor, 40);
        expect(result.fullReload, isTrue);
        expect(
          result.fallback,
          reset ? RecoveryFallback.reset : RecoveryFallback.truncated,
        );
      }
    });

    test('a failing fetch refreshes + reloads and keeps the cursor', () async {
      final h = _Harness(
        cursor: 10,
        instanceId: 'inst-a',
        fetch: (_, _) async => throw StateError('network down'),
      );
      await h.init();

      final result = await h.coordinator.handle(
        _greeting(headSeq: 20, instanceId: 'inst-a'),
        isReconnect: true,
      );

      expect(h.log, ['refresh', 'reload']);
      expect(h.fallbacks, [RecoveryFallback.error]);
      expect(h.recovery.cursor, 10);
      expect(result.fullReload, isTrue);
    });

    test('a new gateway instance discards the cursor and reloads', () async {
      final h = _Harness(
        cursor: 10,
        instanceId: 'inst-old',
        fetch: (_, _) => throw StateError('must not fetch'),
      );
      await h.init();

      final result = await h.coordinator.handle(
        _greeting(headSeq: 3, instanceId: 'inst-new'),
        isReconnect: true,
      );

      expect(h.fetchCalls, isEmpty);
      expect(h.emitted, isEmpty);
      expect(h.recovery.cursor, isNull);
      expect(h.log, ['refresh', 'reload']);
      expect(result.fullReload, isTrue);
      expect(result.epochChanged, isTrue);
    });

    test('a throwing refresh still triggers the full reload', () async {
      final h = _Harness(
        cursor: 10,
        instanceId: 'inst-a',
        fetch: (_, _) async => null,
        throwRefresh: true,
      );
      await h.init();

      await expectLater(
        h.coordinator.handle(
          _greeting(headSeq: 10, instanceId: 'inst-a'),
          isReconnect: true,
        ),
        throwsA(isA<StateError>()),
      );

      expect(h.log, ['refresh', 'reload']);
    });
  });
}
