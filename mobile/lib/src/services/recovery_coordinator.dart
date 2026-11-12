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
/// - reset / truncated / unsupported / request error / gateway-instance change:
///   refresh **and** full reload, because the gap cannot be bridged;
/// - a reconnect always refreshes (seq-less delta frames are never replayed).
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

  const GatewayReadyResult({
    this.baselined = false,
    this.epochChanged = false,
    this.applied = 0,
    this.fallback,
    this.refreshed = false,
    this.fullReload = false,
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

  /// Handle one `connected` greeting.
  ///
  /// Never throws for recovery failures ([EventRecoveryService.recover] reports
  /// them through its outcome); callback errors propagate to the caller, which
  /// is the socket's fire-and-forget hook and swallows them.
  Future<GatewayReadyResult> handle(
    MafwEvent greeting, {
    required bool isReconnect,
  }) async {
    final hadCursor = recovery.cursor != null;
    RecoveryOutcome? outcome;
    var epochChanged = false;

    var refreshed = false;
    var fullReload = false;

    try {
      await recovery.observeHeadSeq(greeting.headSeq, greeting.instanceId);
      // observeHeadSeq drops the cursor when the greeting reports another
      // gateway instance: same branch as a reset (the old seq space is gone).
      epochChanged = hadCursor && recovery.cursor == null;
      if (hadCursor && !epochChanged) {
        // Bounded inside the service (100 pages / 10s request timeout).
        outcome = await recovery.recover();
      }
    } finally {
      // Replay first, refresh second: a surface that sees the refresh must
      // already have the recovered frames.
      final applied = outcome?.applied ?? 0;
      final fallback = outcome?.reason;
      final needsReload = epochChanged || fallback != null;
      final shouldRefresh =
          isReconnect || hadCursor || applied > 0 || needsReload;
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
    );
  }
}
