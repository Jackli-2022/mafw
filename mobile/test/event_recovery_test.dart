/// E5b-2 cursor store + `EventRecoveryService` (replay → dedupe → fallback).
///
/// Consumer contract (spec §3.3/§4.3): apply events in seq order, drop
/// `seq <= cursor`, advance the cursor only for applied events, and fall back to
/// a full reload on reset/truncated/unsupported/error without silently skipping
/// a gap. A failed request keeps the previous cursor so the next reconnect
/// retries the same range.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/services/event_recovery.dart';

MafwEvent _event(int? seq) => MafwEvent(
      type: 'mafw_event',
      innerType: 'message.updated',
      seq: seq,
    );

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

class _Clock {
  DateTime now = DateTime(2026, 11, 12, 12);

  void advance(int ms) => now = now.add(Duration(milliseconds: ms));
}

class _Harness {
  _Harness({
    int? cursor,
    String? instanceId,
    required Future<EventReplayPage?> Function(int since, int limit) fetch,
    this.clock,
  }) : store = MemoryEventCursorStore(seq: cursor, instanceId: instanceId) {
    service = EventRecoveryService(
      fetch: fetch,
      cursorStore: store,
      emit: emitted.add,
      onFallback: fallbacks.add,
      now: clock == null ? null : () => clock!.now,
    );
  }

  final MemoryEventCursorStore store;
  final _Clock? clock;
  final List<MafwEvent> emitted = [];
  final List<RecoveryFallback> fallbacks = [];
  late final EventRecoveryService service;
}

/// Let fire-and-forget cursor persistence settle.
Future<void> _settle() => Future<void>.delayed(Duration.zero);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SharedPrefsEventCursorStore', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('loads null when nothing was persisted', () async {
      final store = SharedPrefsEventCursorStore(
        prefs: await SharedPreferences.getInstance(),
      );

      final loaded = await store.load();

      expect(loaded.seq, isNull);
      expect(loaded.instanceId, isNull);
    });

    test('round-trips seq + instanceId under the documented keys', () async {
      final prefs = await SharedPreferences.getInstance();
      final store = SharedPrefsEventCursorStore(prefs: prefs);

      await store.save(42, 'inst-a');

      expect(prefs.getInt('mafw_event_seq'), 42);
      expect(prefs.getString('mafw_event_instance'), 'inst-a');
      final loaded = await store.load();
      expect(loaded.seq, 42);
      expect(loaded.instanceId, 'inst-a');
    });

    test('clear removes both keys', () async {
      final prefs = await SharedPreferences.getInstance();
      final store = SharedPrefsEventCursorStore(prefs: prefs);
      await store.save(42, 'inst-a');

      await store.clear();

      expect(prefs.getInt('mafw_event_seq'), isNull);
      expect(prefs.getString('mafw_event_instance'), isNull);
    });
  });

  group('EventRecoveryService init / observe', () {
    test('init loads the persisted cursor and instance', () async {
      final h = _Harness(
        cursor: 12,
        instanceId: 'inst-a',
        fetch: (_, _) async => fail('must not fetch during init'),
      );

      await h.service.init();

      expect(h.service.cursor, 12);
      expect(h.service.instanceId, 'inst-a');
    });

    test('observe advances to the max seq and ignores seq-less frames', () async {
      final clock = _Clock();
      final h = _Harness(fetch: (_, _) async => null, clock: clock);
      await h.service.init();

      h.service.observe(_event(null));
      h.service.observe(_event(3));
      await _settle();
      clock.advance(250);
      h.service.observe(_event(2));
      h.service.observe(_event(5));
      h.service.observe(_event(4));
      await _settle();

      expect(h.service.cursor, 5);
      expect(h.store.seq, 5);
    });

    test('observe persists on the first advance, then throttles to 50 events',
        () async {
      final h = _Harness(fetch: (_, _) async => null);
      await h.service.init();

      h.service.observe(_event(1));
      await _settle();
      expect(h.store.saves, 1);
      expect(h.store.seq, 1);

      for (var seq = 2; seq <= 50; seq++) {
        h.service.observe(_event(seq));
      }
      await _settle();
      expect(h.store.saves, 1, reason: '49 events is below the batch threshold');

      h.service.observe(_event(51));
      await _settle();
      expect(h.store.saves, 2);
      expect(h.store.seq, 51);
    });

    test('observe also persists after 250ms even below the batch threshold',
        () async {
      final clock = _Clock();
      final h = _Harness(fetch: (_, _) async => null, clock: clock);
      await h.service.init();

      h.service.observe(_event(1));
      await _settle();
      expect(h.store.saves, 1);

      clock.advance(249);
      h.service.observe(_event(2));
      await _settle();
      expect(h.store.saves, 1);

      clock.advance(1);
      h.service.observe(_event(3));
      await _settle();
      expect(h.store.saves, 2);
      expect(h.store.seq, 3);
    });

    test('observeHeadSeq baselines a first connect without replay', () async {
      final h = _Harness(fetch: (_, _) async => fail('must not fetch'));

      h.service.observeHeadSeq(50, 'inst-a');
      await _settle();

      expect(h.service.cursor, 50);
      expect(h.service.instanceId, 'inst-a');
      expect(h.store.seq, 50);
      expect(h.store.instanceId, 'inst-a');
    });

    test('observeHeadSeq keeps the cursor for the same gateway instance',
        () async {
      final h = _Harness(cursor: 9, instanceId: 'inst-a', fetch: (_, _) async => null);
      await h.service.init();

      h.service.observeHeadSeq(99, 'inst-a');
      await _settle();

      expect(h.service.cursor, 9);
      expect(h.store.seq, 9);
    });

    test('observeHeadSeq clears the cursor when the instance changed', () async {
      final h = _Harness(cursor: 9, instanceId: 'inst-a', fetch: (_, _) async => null);
      await h.service.init();

      h.service.observeHeadSeq(3, 'inst-b');
      await _settle();

      expect(h.service.cursor, isNull);
      expect(h.service.instanceId, isNull);
      expect(h.store.seq, isNull);
      expect(h.store.clears, 1);
    });

    test('observeHeadSeq ignores a null head', () async {
      final h = _Harness(cursor: 9, instanceId: 'inst-a', fetch: (_, _) async => null);
      await h.service.init();

      h.service.observeHeadSeq(null, 'inst-b');
      await _settle();

      expect(h.service.cursor, 9);
      expect(h.service.instanceId, 'inst-a');
    });
  });

  group('EventRecoveryService.recover', () {
    test('returns noCursor when nothing was persisted', () async {
      var fetches = 0;
      final h = _Harness(fetch: (_, _) async {
        fetches++;
        return _page();
      });
      await h.service.init();

      final outcome = await h.service.recover();

      expect(outcome.kind, RecoveryOutcomeKind.noCursor);
      expect(fetches, 0);
      expect(h.emitted, isEmpty);
    });

    test('pages until hasMore is false, emitting in seq order', () async {
      final sinceCalls = <int>[];
      final h = _Harness(cursor: 5, instanceId: 'inst-a', fetch: (since, limit) async {
        sinceCalls.add(since);
        expect(limit, 500);
        if (since == 5) {
          return _page(
            events: [_event(6), _event(7)],
            headSeq: 9,
            hasMore: true,
            nextSince: 7,
          );
        }
        if (since == 7) {
          return _page(
            events: [_event(8), _event(9)],
            headSeq: 9,
            hasMore: false,
            nextSince: 9,
          );
        }
        fail('unexpected since $since');
      });
      await h.service.init();

      final outcome = await h.service.recover();

      expect(outcome.kind, RecoveryOutcomeKind.recovered);
      expect(outcome.applied, 4);
      expect(sinceCalls, [5, 7]);
      expect(h.emitted.map((e) => e.seq), [6, 7, 8, 9]);
      expect(h.service.cursor, 9);
      expect(h.store.seq, 9);
      expect(h.fallbacks, isEmpty);
    });

    test('drops duplicate frames (seq <= cursor)', () async {
      final h = _Harness(cursor: 5, fetch: (since, _) async {
        expect(since, 5);
        return _page(
          events: [_event(4), _event(5), _event(6)],
          headSeq: 6,
          nextSince: 6,
        );
      });
      await h.service.init();

      final outcome = await h.service.recover();

      expect(outcome.applied, 1);
      expect(h.emitted.map((e) => e.seq), [6]);
      expect(h.store.seq, 6);
    });

    test('drops seq-less events from a page', () async {
      final h = _Harness(cursor: 5, fetch: (_, _) async {
        return _page(events: [_event(null), _event(6)], headSeq: 6, nextSince: 6);
      });
      await h.service.init();

      final outcome = await h.service.recover();

      expect(outcome.applied, 1);
      expect(h.emitted.map((e) => e.seq), [6]);
    });

    test('reset falls back to headSeq without persisting nextSince', () async {
      final h = _Harness(cursor: 5, instanceId: 'inst-a', fetch: (_, _) async {
        return _page(
          headSeq: 42,
          nextSince: 42,
          reset: true,
        );
      });
      await h.service.init();

      final outcome = await h.service.recover();

      expect(outcome.kind, RecoveryOutcomeKind.fellBack);
      expect(outcome.reason, RecoveryFallback.reset);
      expect(h.emitted, isEmpty);
      expect(h.service.cursor, 42);
      expect(h.store.seq, 42);
      expect(h.store.instanceId, 'inst-a');
      expect(h.fallbacks, [RecoveryFallback.reset]);
    });

    test('truncated falls back to headSeq', () async {
      final h = _Harness(cursor: 5, fetch: (_, _) async {
        return _page(
          events: [_event(6)],
          headSeq: 12,
          nextSince: 6,
          truncated: true,
        );
      });
      await h.service.init();

      final outcome = await h.service.recover();

      expect(outcome.kind, RecoveryOutcomeKind.fellBack);
      expect(outcome.reason, RecoveryFallback.truncated);
      expect(h.service.cursor, 12);
      expect(h.store.seq, 12);
      expect(h.fallbacks, [RecoveryFallback.truncated]);
    });

    test('unsupported replay keeps the cursor and asks for a full reload',
        () async {
      final h = _Harness(cursor: 5, fetch: (_, _) async => null);
      await h.service.init();

      final outcome = await h.service.recover();

      expect(outcome.kind, RecoveryOutcomeKind.fellBack);
      expect(outcome.reason, RecoveryFallback.unsupported);
      expect(h.service.cursor, 5);
      expect(h.store.seq, 5);
      expect(h.fallbacks, [RecoveryFallback.unsupported]);
    });

    test('request errors keep the previous cursor for the next retry', () async {
      final h = _Harness(cursor: 5, fetch: (_, _) async => throw StateError('offline'));
      await h.service.init();

      final outcome = await h.service.recover();

      expect(outcome.kind, RecoveryOutcomeKind.fellBack);
      expect(outcome.reason, RecoveryFallback.error);
      expect(outcome.applied, 0);
      expect(h.service.cursor, 5);
      expect(h.store.seq, 5);
      expect(h.fallbacks, [RecoveryFallback.error]);
    });

    test('an empty page is a successful no-op', () async {
      var fetches = 0;
      final h = _Harness(cursor: 5, fetch: (_, _) async {
        fetches++;
        return _page(headSeq: 5, nextSince: 5);
      });
      await h.service.init();

      final outcome = await h.service.recover();

      expect(outcome.kind, RecoveryOutcomeKind.recovered);
      expect(outcome.applied, 0);
      expect(fetches, 1);
      expect(h.service.cursor, 5);
      expect(h.store.seq, 5);
      expect(h.fallbacks, isEmpty);
    });

    test('a non-advancing nextSince cannot loop forever', () async {
      var fetches = 0;
      final h = _Harness(cursor: 5, fetch: (_, _) async {
        fetches++;
        return _page(headSeq: 10, hasMore: true, nextSince: 5);
      });
      await h.service.init();

      final outcome = await h.service.recover();

      expect(outcome.kind, RecoveryOutcomeKind.recovered);
      expect(fetches, 1);
      expect(h.service.cursor, 5);
    });

    test('stops after 100 pages even if the gateway keeps claiming hasMore',
        () async {
      var seq = 5;
      var fetches = 0;
      final h = _Harness(cursor: 5, fetch: (_, _) async {
        fetches++;
        seq++;
        return _page(
          events: [_event(seq)],
          headSeq: 1000,
          hasMore: true,
          nextSince: seq,
        );
      });
      await h.service.init();

      final outcome = await h.service.recover();

      expect(fetches, 100);
      expect(outcome.applied, 100);
      expect(h.service.cursor, 105);
    });
  });
}
