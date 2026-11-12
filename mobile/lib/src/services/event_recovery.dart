/// E5b-2 event cursor + replay-based recovery.
///
/// Spec: `docs/superpowers/specs/2026-11-12-gateway-e5b-event-recovery-design.md`
/// §4.3. The service is transport-free: [EventRecoveryService] callers inject the
/// page fetch (`GatewayClient.replayEvents`), the cursor store, and the sink
/// that re-emits recovered events into the same stream as live frames.
///
/// Consumer rules:
/// - events are applied in seq order; `seq <= cursor` is dropped (idempotent);
/// - the cursor only advances for events actually emitted;
/// - `reset` / `truncated` / unsupported replay / request errors fall back to a
///   full reload, and only `reset` / `truncated` pin the cursor to `headSeq`
///   (a transient failure keeps the old cursor so the next reconnect retries);
/// - seq-less frames (`message.part.delta`) never move the cursor.
library;

import 'dart:async';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/mafw_models.dart';

/// Why replay could not bridge the offline gap.
enum RecoveryFallback {
  /// The gateway has no replay endpoint (old build / HTML / 503).
  unsupported,

  /// `since > headSeq`: the event log was reset (new epoch) — full reload.
  reset,

  /// The gap starts before the retained window — full reload.
  truncated,

  /// The replay request itself failed — keep the cursor and retry later.
  error,

  /// The 100-page bound was reached while `hasMore` was still true. The cursor
  /// is at the last applied seq, but the gap is not fully bridged: the caller
  /// must finish with a full reload instead of treating this as success.
  pageCap,
}

/// Which branch [EventRecoveryService.recover] took.
enum RecoveryOutcomeKind { noCursor, recovered, fellBack, busy }

class RecoveryOutcome {
  final RecoveryOutcomeKind kind;
  final RecoveryFallback? reason;
  final int applied;

  const RecoveryOutcome._(this.kind, {this.reason, this.applied = 0});

  /// First connect: no persisted cursor, the caller loads state in full and
  /// baselines with [EventRecoveryService.observeHeadSeq].
  const RecoveryOutcome.noCursor() : this._(RecoveryOutcomeKind.noCursor);

  /// Every page was applied (possibly zero events).
  const RecoveryOutcome.recovered(int applied)
      : this._(RecoveryOutcomeKind.recovered, applied: applied);

  /// Replay could not bridge the gap; the caller must reload in full.
  const RecoveryOutcome.fellBack(RecoveryFallback reason, {int applied = 0})
      : this._(RecoveryOutcomeKind.fellBack, reason: reason, applied: applied);

  /// A recover is already in flight; this call did nothing.
  const RecoveryOutcome.busy() : this._(RecoveryOutcomeKind.busy);

  bool get isNoCursor => kind == RecoveryOutcomeKind.noCursor;

  bool get didRecover => kind == RecoveryOutcomeKind.recovered;

  bool get fellBack => kind == RecoveryOutcomeKind.fellBack;

  bool get isBusy => kind == RecoveryOutcomeKind.busy;
}

/// Persisted replay cursor (`lastSeq`) plus the gateway instance that produced
/// it. The instance lets a cold start notice a different gateway/event-log
/// epoch and discard a cursor that would otherwise reset-loop.
abstract class EventCursorStore {
  Future<({int? seq, String? instanceId})> load();

  Future<void> save(int? seq, String? instanceId);

  Future<void> clear();
}

/// SharedPreferences-backed cursor. Two scalar keys only (no write amplification).
class SharedPrefsEventCursorStore implements EventCursorStore {
  static const kSeqKey = 'mafw_event_seq';
  static const kInstanceKey = 'mafw_event_instance';

  final SharedPreferences? _injected;

  /// [prefs] is injectable for tests; production resolves the singleton lazily.
  SharedPrefsEventCursorStore({SharedPreferences? prefs}) : _injected = prefs;

  Future<SharedPreferences> _prefs() async =>
      _injected ?? await SharedPreferences.getInstance();

  @override
  Future<({int? seq, String? instanceId})> load() async {
    final prefs = await _prefs();
    return (seq: prefs.getInt(kSeqKey), instanceId: prefs.getString(kInstanceKey));
  }

  @override
  Future<void> save(int? seq, String? instanceId) async {
    final prefs = await _prefs();
    if (seq == null) {
      await prefs.remove(kSeqKey);
    } else {
      await prefs.setInt(kSeqKey, seq);
    }
    if (instanceId == null) {
      await prefs.remove(kInstanceKey);
    } else {
      await prefs.setString(kInstanceKey, instanceId);
    }
  }

  @override
  Future<void> clear() async {
    final prefs = await _prefs();
    await prefs.remove(kSeqKey);
    await prefs.remove(kInstanceKey);
  }
}

/// In-memory cursor for tests (and for callers that do not want persistence).
class MemoryEventCursorStore implements EventCursorStore {
  int? seq;
  String? instanceId;
  int saves = 0;
  int clears = 0;

  MemoryEventCursorStore({this.seq, this.instanceId});

  @override
  Future<({int? seq, String? instanceId})> load() async =>
      (seq: seq, instanceId: instanceId);

  @override
  Future<void> save(int? seq, String? instanceId) async {
    this.seq = seq;
    this.instanceId = instanceId;
    saves++;
  }

  @override
  Future<void> clear() async {
    seq = null;
    instanceId = null;
    clears++;
  }
}

/// Replays event_log pages from the persisted cursor into [emit].
class EventRecoveryService {
  /// Replay page size (gateway default and max-safe).
  static const int pageSize = 500;

  /// Hard loop bound: replay never chases more than 100 pages in one reconnect.
  static const int maxPages = 100;

  /// Persist after this many unpersisted event advances…
  static const int _persistEvery = 50;

  /// …or after this long since the last persist, whichever comes first.
  static const Duration _persistInterval = Duration(milliseconds: 250);

  final Future<EventReplayPage?> Function(int since, int limit) _fetch;
  final EventCursorStore _cursorStore;
  final void Function(MafwEvent event) _emit;
  final void Function(RecoveryFallback reason) _onFallback;
  final DateTime Function() _now;

  int? _cursor;
  String? _instanceId;
  int _unpersisted = 0;
  DateTime? _lastPersist;
  bool _recovering = false;

  EventRecoveryService({
    required this._fetch,
    required this._cursorStore,
    required this._emit,
    required this._onFallback,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;
  /// Last applied/persisted seq (null before init or after an epoch change).
  int? get cursor => _cursor;

  String? get instanceId => _instanceId;

  /// Load the persisted cursor. Call once before observing/recovering.
  Future<void> init() async {
    final loaded = await _cursorStore.load();
    _cursor = loaded.seq;
    _instanceId = loaded.instanceId;
  }

  /// Record a live frame's seq (max) and persist with write coalescing.
  void observe(MafwEvent event) {
    final seq = event.seq;
    if (seq == null) return; // transient frames never advance the cursor
    final current = _cursor;
    if (current != null && seq <= current) return;
    _cursor = seq;
    _unpersisted++;
    final last = _lastPersist;
    final elapsed = last == null ? null : _now().difference(last);
    if (_unpersisted >= _persistEvery ||
        elapsed == null ||
        elapsed >= _persistInterval) {
      _persistNow();
    }
  }

  /// First-connect baseline from the `connected` greeting's `headSeq`.
  ///
  /// - no cursor yet → adopt the head as the baseline (no replay needed);
  /// - same gateway instance → keep the cursor untouched;
  /// - different instance → the event log epoch changed: clear the cursor and
  ///   let the caller do a full reload (then baseline again).
  ///
  /// Persists before returning so a caller that awaits this can treat the
  /// baseline as durable (E5b-3 reconnect wiring does exactly that).
  Future<void> observeHeadSeq(int? head, String? instanceId) async {
    if (head == null) return;

    if (_cursor != null &&
        _instanceId != null &&
        instanceId != null &&
        instanceId != _instanceId) {
      _cursor = null;
      _instanceId = null;
      _lastPersist = _now();
      _unpersisted = 0;
      await _cursorStore.clear();
      return;
    }

    if (_cursor == null) {
      _cursor = head;
      _instanceId = instanceId;
      await _persistCursor();
      return;
    }

    // Cursor exists but we never learned the instance (legacy store): adopt it.
    if (_instanceId == null && instanceId != null) {
      _instanceId = instanceId;
      await _persistCursor();
    }
  }

  /// Persist the current cursor immediately, bypassing the observe throttle.
  ///
  /// Task 3 calls this on disconnect / app background so the last few live
  /// seqs are not lost when the process dies inside the 250ms window.
  Future<void> flush() => _persistCursor();

  /// Page `since=cursor` forward, emitting each new event exactly once.
  ///
  /// Only one recover loop may run at a time; a concurrent call returns
  /// [RecoveryOutcome.busy] and touches nothing.
  Future<RecoveryOutcome> recover() async {
    if (_recovering) return const RecoveryOutcome.busy();
    _recovering = true;
    try {
      return await _recoverOnce();
    } finally {
      _recovering = false;
    }
  }

  Future<RecoveryOutcome> _recoverOnce() async {
    final start = _cursor;
    if (start == null) return const RecoveryOutcome.noCursor();

    var cursor = start; // local pagination cursor (`since` for the next fetch)
    var applied = 0;
    var reachedPageCap = false;
    try {
      for (var pageIndex = 0; pageIndex < maxPages; pageIndex++) {
        final since = cursor;
        final page = await _fetch(since, pageSize);

        if (page == null) {
          // Old gateway / proxy / event store down: keep the cursor, full reload.
          _onFallback(RecoveryFallback.unsupported);
          return RecoveryOutcome.fellBack(RecoveryFallback.unsupported,
              applied: applied);
        }

        if (page.reset || page.truncated) {
          final reason =
              page.reset ? RecoveryFallback.reset : RecoveryFallback.truncated;
          // Gap cannot be bridged. Pin the cursor to headSeq (never persist
          // nextSince — that could reset-loop against the same epoch), but
          // never roll back a newer live observe.
          if (_cursor == null || page.headSeq > _cursor!) {
            _cursor = page.headSeq;
          }
          await _persistCursor();
          _onFallback(reason);
          return RecoveryOutcome.fellBack(reason, applied: applied);
        }

        for (final event in page.events) {
          final seq = event.seq;
          if (seq == null || seq <= cursor) continue; // idempotent consume
          cursor = seq;
          // A live frame may have moved ahead while this page was in flight;
          // the persisted cursor only ever moves forward.
          if (_cursor == null || seq > _cursor!) _cursor = seq;
          applied++;
          _emit(event);
        }

        if (!page.hasMore) break;
        // Contract guard: a page that does not move nextSince would loop.
        if (page.nextSince <= since) break;
        if (pageIndex == maxPages - 1) reachedPageCap = true;
      }
    } catch (_) {
      // Keep the live advance; otherwise keep the pre-call cursor so the next
      // reconnect retries the same range.
      _cursor = (_cursor != null && _cursor! > start) ? _cursor : start;
      _onFallback(RecoveryFallback.error);
      return RecoveryOutcome.fellBack(RecoveryFallback.error, applied: applied);
    }

    await _persistCursor();
    if (reachedPageCap) {
      // The 100-page bound stopped short of head: never report this as success.
      _onFallback(RecoveryFallback.pageCap);
      return RecoveryOutcome.fellBack(RecoveryFallback.pageCap,
          applied: applied);
    }
    return RecoveryOutcome.recovered(applied);
  }

  void _persistNow() {
    _lastPersist = _now();
    _unpersisted = 0;
    unawaited(_cursorStore.save(_cursor, _instanceId));
  }

  Future<void> _persistCursor() async {
    _lastPersist = _now();
    _unpersisted = 0;
    await _cursorStore.save(_cursor, _instanceId);
  }
}
