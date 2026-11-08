/// Send-channel routing discipline (Task 12).
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.6 —— 讨论页发送**只走** `POST .../tech-lead/messages {text}`；直接
/// `promptAsync` / `/api/chat/enriched` 会丢 Tech Lead agent 绑定与 revision 的
/// ContextManifest（`gateway/src/core/pod/pod-tech-lead-service.ts` `prompt()`）。
///
/// Mirrors the desktop split (`packages/desktop/src/renderer/mafw/chat/
/// use-send-message.ts:407-416`): a view that is bound to a Goal routes through
/// the Pod collaboration channel, everything else goes through the ordinary
/// enriched chat prompt.
///
/// **Hard contract** ([resolve] is the single decision point):
/// - `goalBound == true` → [SendChannel.techLead], **never** [SendChannel.enriched].
///   A goal-bound target missing `podId`/`goalId` fails closed with
///   [SendRouteException] before any request — it must never "fall back" to the
///   enriched channel and quietly lose the Tech Lead binding.
/// - `goalBound == false` → [SendChannel.enriched].
library;

import '../network/gateway_client.dart';

/// Which transport a chat view must use to send a message.
enum SendChannel {
  /// Pod collaboration channel: `POST .../tech-lead/messages {text}`.
  techLead,

  /// Ordinary enriched chat prompt: `POST /api/chat/enriched`.
  enriched,
}

/// The send identity of one view.
///
/// Discussion (goal-bound) views carry the Pod + Goal they belong to; ordinary
/// chat views only carry their session.
class SendView {
  /// Whether this view is bound to a Pod Goal (Tech Lead discussion).
  final bool goalBound;

  /// Pod id (goal-bound views only).
  final String? podId;

  /// Goal id (goal-bound views only).
  final String? goalId;

  /// Session id (ordinary chat views; discussion views do not target a raw
  /// session — the server resolves the Tech Lead session from the Goal).
  final String? sessionID;

  const SendView({
    required this.goalBound,
    this.podId,
    this.goalId,
    this.sessionID,
  });

  /// A Tech Lead discussion view (always goal-bound).
  ///
  /// The fields stay nullable (the plain [SendView] constructor models
  /// malformed views), so the const asserts keep a `null` id from ever being a
  /// valid const expression here while the runtime still fails closed in
  /// [SendRouter.send].
  const SendView.techLead({required this.podId, required this.goalId})
      : assert(podId != null, 'tech-lead view requires podId'),
        assert(goalId != null, 'tech-lead view requires goalId'),
        goalBound = true,
        sessionID = null;

  /// An ordinary chat view.
  const SendView.chat({this.sessionID})
      : goalBound = false,
        podId = null,
        goalId = null;

  @override
  String toString() =>
      'SendView(goalBound: $goalBound, podId: $podId, goalId: $goalId, '
      'sessionID: $sessionID)';
}

/// Result of a routed send.
class SendOutcome {
  final SendChannel channel;

  /// Session the gateway used for the reply — only meaningful for
  /// [SendChannel.enriched] (a manager dispatch can redirect it). Discussion
  /// sends have no redirect semantics, so it stays `null`.
  final String? sessionID;

  const SendOutcome(this.channel, {this.sessionID});
}

/// A goal-bound view could not be routed safely (missing Pod/Goal ids).
class SendRouteException implements Exception {
  final String message;

  const SendRouteException(this.message);

  @override
  String toString() => message;
}

/// Routes one chat view's send to the right gateway channel.
class SendRouter {
  final GatewayClient client;

  SendRouter(this.client);

  /// The single routing decision. Pure: no I/O, no fallbacks.
  static SendChannel resolve(SendView view) =>
      view.goalBound ? SendChannel.techLead : SendChannel.enriched;

  /// Sends [text] through the channel [resolve] picked.
  ///
  /// The text is forwarded verbatim (the client deliberately does not trim):
  /// the gateway validates emptiness for both transports.
  Future<SendOutcome> send(SendView view, String text) async {
    switch (resolve(view)) {
      case SendChannel.techLead:
        final podId = (view.podId ?? '').trim();
        final goalId = (view.goalId ?? '').trim();
        if (podId.isEmpty || goalId.isEmpty) {
          // Fail closed: no request, and never the enriched channel.
          throw const SendRouteException(
            'goal-bound send requires podId and goalId',
          );
        }
        await client.sendTechLeadMessage(podId, goalId, text);
        return const SendOutcome(SendChannel.techLead);
      case SendChannel.enriched:
        final sessionID = await client.sendEnriched(text, sessionID: view.sessionID);
        return SendOutcome(SendChannel.enriched, sessionID: sessionID);
    }
  }
}
