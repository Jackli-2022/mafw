/// E5b-3 gateway-ready → recovery → refresh orchestration.
///
/// Spec: `docs/superpowers/specs/2026-11-12-gateway-e5b-event-recovery-design.md`
/// §4.4. `WsClientV2.onGatewayReady` hands every `connected` greeting here; this
/// class owns the decision tree so `main.dart` stays wiring-only and the order
/// ("replay completes before the UI refetches") is unit-testable.
///
/// Rules:
/// - first connect (no persisted cursor): baseline `headSeq` / `instanceId`, no
///   replay, no refresh — the normal initial load path still runs;
/// - persisted cursor: drain replay first, then refresh the live surfaces;
/// - reset / truncated / unsupported / request error / non-advancing replay page
///   (protocol) / gateway-instance change: refresh **and** full reload, because
///   the gap cannot be bridged;
/// - a reconnect always refreshes (seq-less delta frames are never replayed);
/// - a greeting that lands while another replay is still running is held (at
///   most one) and rerun — replay, then refresh — when that run finishes (E8-4);
///   a second waiter is redundant and is dropped. Intentional disconnects are
///   filtered upstream by `WsClientV2` (never reach this class).
library;

import '../models/mafw_models.dart';
import 'event_recovery.dart';

/// What one greeting handling did (observability + tests).
class GatewayReadyResult {
  /// The cursor was adopted from the greeting (first connect, no cursor).
  final bool baselined;

  /// The greeting reported a different gateway instance: the stale cursor was
  /// discarded and the caller reloaded in full.
  final bool epochChanged;

  /// Recovered events applied to the live stream.
  final int applied;

  /// Why replay could not bridge the gap (null = bridged or nothing to do).
  final RecoveryFallback? fallback;

  /// The surface-refresh callbacks ran.
  final bool refreshed;

  /// The caller was asked for a full reload (fallback / epoch change).
  final bool fullReload;

  /// Another replay was already in flight, so the greeting could not recover
  /// immediately: it either waited and reran (see [queued]) or was dropped
  /// because one greeting was already waiting.
  final bool busy;

  /// The greeting was held while the in-flight replay finished and then rerun
  /// (replay + refresh); the rest of this result describes that rerun.
  final bool queued;

  const GatewayReadyResult({
    this.baselined = false,
    this.epochChanged = false,
    this.applied = 0,
    this.fallback,
    this.refreshed = false,
    this.fullReload = false,
    this.busy = false,
    this.queued = false,
  });
}

class RecoveryCoordinator {
  final EventRecoveryService recovery;

  /// Work-tab bus + open-page reconnect signal (must run after replay).
  final Future<void> Function() onRefresh;

  /// Full REST reload (`_refreshSessions`) for gaps replay cannot bridge.
  final Future<void> Function() onFullReload;

  RecoveryCoordinator({
    required this.recovery,
    required this.onRefresh,
    required this.onFullReload,
  });

  /// The single greeting held while another replay runs (E8-4).
  ({MafwEvent greeting, bool isReconnect})? _pending;

  /// Handle one `connected` greeting.
  ///
  /// Never throws for recovery failures ([EventRecoveryService.recover] reports
  /// them through its outcome); callback errors propagate to the caller, which
  /// is the socket's fire-and-forget hook and swallows them.
  ///
  /// A greeting that arrives while a replay is already running is queued (max
  /// one) and rerun as soon as that replay settles, so its own replay+refresh
  /// still happens instead of being silently skipped (E8-4). A second waiter is
  /// redundant: the queued rerun covers the same gap, so it returns
  /// `busy: true, queued: false` and touches nothing.
  Future<GatewayReadyResult> handle(
    MafwEvent greeting, {
    required bool isReconnect,
  }) async {
    // An epoch change is never queued: the in-flight replay belongs to the dead
    // seq space, so `observeHeadSeq` re-baselines immediately and the caller
    // reloads in full instead of waiting out a replay against the old epoch.
    final epochChange = recovery.cursor != null &&
        recovery.instanceId != null &&
        greeting.instanceId != null &&
        greeting.instanceId != recovery.instanceId;
    if (recovery.isRecovering && !epochChange) {
      if (_pending != null) return const GatewayReadyResult(busy: true);
      _pending = (greeting: greeting, isReconnect: isReconnect);
      await recovery.settled;
      final next = _pending;
      _pending = null;
      if (next == null) return const GatewayReadyResult(busy: true);
      final rerun =
          await _handleOnce(next.greeting, isReconnect: next.isReconnect);
      return GatewayReadyResult(
        baselined: rerun.baselined,
        epochChanged: rerun.epochChanged,
        applied: rerun.applied,
        fallback: rerun.fallback,
        refreshed: rerun.refreshed,
        fullReload: rerun.fullReload,
        busy: true,
        queued: true,
      );
    }
    return _handleOnce(greeting, isReconnect: isReconnect);
  }

  Future<GatewayReadyResult> _handleOnce(
    MafwEvent greeting, {
    required bool isReconnect,
  }) async {
    final hadCursor = recovery.cursor != null;
    final hadInstance = recovery.instanceId;
    RecoveryOutcome? outcome;
    var epochChanged = false;

    var refreshed = false;
    var fullReload = false;
    var busy = false;

    try {
      await recovery.observeHeadSeq(greeting.headSeq, greeting.instanceId);
      // observeHeadSeq re-baselines onto the new head when the greeting reports
      // another gateway instance: the old seq space is gone (same branch as a
      // reset — full reload, but the cursor is already usable).
      epochChanged = hadCursor &&
          hadInstance != null &&
          greeting.instanceId != null &&
          greeting.instanceId != hadInstance;
      if (hadCursor && !epochChanged) {
        // Bounded inside the service (100 pages / 10s request timeout).
        outcome = await recovery.recover();
      }
      // Narrow race only (E8-4): `handle` checks `isRecovering` before this
      // runs, so a busy outcome here means a replay started in between. Do not
      // refresh on top of it; the queued path owns orderly reruns.
      busy = outcome?.isBusy ?? false;
    } finally {
      // Replay first, refresh second: a surface that sees the refresh must
      // already have the recovered frames.
      final applied = outcome?.applied ?? 0;
      final fallback = outcome?.reason;
      final needsReload = epochChanged || fallback != null;
      final shouldRefresh = !busy &&
          (isReconnect || hadCursor || applied > 0 || needsReload);
      if (shouldRefresh) {
        refreshed = true;
        try {
          await onRefresh();
        } finally {
          if (needsReload) {
            fullReload = true;
            await onFullReload();
          }
        }
      }
    }

    return GatewayReadyResult(
      baselined: !hadCursor && recovery.cursor != null,
      epochChanged: epochChanged,
      applied: outcome?.applied ?? 0,
      fallback: outcome?.reason,
      refreshed: refreshed,
      fullReload: fullReload,
      busy: busy,
    );
  }
}
