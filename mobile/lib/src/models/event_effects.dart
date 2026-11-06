/// Canonical-event → UI effect mapping (pure, Flutter-free).
///
/// Consumers (`ChatPage`, `PushService`) must not re-implement event-name
/// literals: they ask this table what an event means. Table-tested in
/// `test/event_effects_test.dart` (exhaustive over the canonical vocabulary).
library;

import 'mafw_models.dart';

/// Effects a canonical event can have on the chat view.
class ChatEventEffects {
  /// A part stream is progressing (Perplexity-style "writing" phase).
  final bool writing;

  /// The turn reached a terminal state (completed / failed / aborted).
  final bool turnEnd;

  /// This session's history changed and should be re-fetched (debounced).
  final bool refresh;

  const ChatEventEffects({
    this.writing = false,
    this.turnEnd = false,
    this.refresh = false,
  });

  static const ChatEventEffects none = ChatEventEffects();

  bool get any => writing || turnEnd || refresh;

  @override
  String toString() =>
      'ChatEventEffects(writing: $writing, turnEnd: $turnEnd, refresh: $refresh)';
}

const ChatEventEffects _writing = ChatEventEffects(writing: true, refresh: true);
const ChatEventEffects _turnEnd = ChatEventEffects(turnEnd: true, refresh: true);
const ChatEventEffects _refreshOnly = ChatEventEffects(refresh: true);

/// Canonical inner event name → chat effects.
///
/// Types absent from this table have no chat effect (`ChatEventEffects.none`).
const Map<String, ChatEventEffects> kChatEventEffectTable = {
  // part stream
  'part.updated': _writing,
  'part.delta': _writing,
  'part.complete': _refreshOnly,
  // messages
  'message.updated': _refreshOnly,
  // turn lifecycle
  'turn.started': _refreshOnly,
  'turn.completed': _turnEnd,
  'turn.failed': _turnEnd,
  'turn.aborted': _turnEnd,
};

/// Effects of a canonical inner event name on the chat view.
ChatEventEffects chatEventEffects(String innerType) =>
    kChatEventEffectTable[innerType] ?? ChatEventEffects.none;

/// Canonical inner events that mean the session list changed.
const Set<String> kSessionRefreshEventTypes = {
  'session.created',
  'session.updated',
  'session.deleted',
  'message.updated',
  'turn.completed',
};

/// Whether a canonical inner event should trigger a session-list refresh.
bool shouldRefreshSessions(String innerType) =>
    kSessionRefreshEventTypes.contains(innerType);

/// Canonical events that change the project work overview (work tab buckets).
///
/// Separate from [kChatEventEffectTable] on purpose: `pod.event` must refresh
/// the work surface without touching the chat bubbles, and `run.updated` /
/// `pod.updated` carry no chat meaning at all.
const Set<String> kWorkRefreshCanonicalEventTypes = {
  'pod.updated',
  'pod.event',
  'run.updated',
};

/// Flat top-level broadcasts that change the project work overview.
///
/// Flat frames are not canonical envelopes (they keep their own `type` and have
/// `innerType == ''`), so they can never live in [kChatEventEffectTable] —
/// [shouldRefreshWork] is their single consumer table.
const Set<String> kWorkRefreshFlatEventTypes = {
  'goal_node',
  'phase_transition',
  'state_change',
  'user_question',
};

/// Whether [event] should trigger a debounced work-overview refetch.
///
/// Canonical frames are matched on their inner type, flat broadcasts on their
/// frame type; legacy/unknown frames never match.
bool shouldRefreshWork(MafwEvent event) {
  if (event.isCanonical) {
    return kWorkRefreshCanonicalEventTypes.contains(event.innerType);
  }
  return kWorkRefreshFlatEventTypes.contains(event.type);
}
