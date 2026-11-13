/// Live session-list patches (E6-4).
///
/// Spec: `docs/superpowers/specs/2026-11-13-gateway-e6-interaction-model-design.md` §6.1
///
/// The gateway already broadcasts `session.created/updated/deleted`; before this
/// module the 聊天 tab only refreshed on explicit actions, so a rename or a new
/// topic from another client stayed invisible until the tab was re-entered.
///
/// The patch is deliberately conservative:
/// - only canonical lifecycle frames are consumed ([MafwEvent.innerType] — flat
///   / legacy frames keep their own `type` and carry no session contract);
/// - `session.updated` merges only the fields present in `properties.info` and
///   never clears the row; a new `time.updated` re-sorts it by activity (other
///   field patches keep the order);
/// - `session.created` requires both an id and a non-empty title; anything less
///   returns the input unchanged so the page falls back to one debounced full
///   fetch (an id-only ghost row is worse than a short delay);
/// - `session.created` for a session that `/api/sessions` would hide (child
///   sessions, legacy worker titles, internal agents, Lead roles) is a complete
///   decision, not a fallback: [isHiddenSessionRow] mirrors the gateway
///   predicate and the row is dropped without any refresh;
/// - every other event returns the same list instance (no rebuild churn).
library;

import 'mafw_models.dart';

/// 会话生命周期事件的 canonical 内层名。
const String kSessionCreatedEvent = 'session.created';
const String kSessionUpdatedEvent = 'session.updated';
const String kSessionDeletedEvent = 'session.deleted';

/// Chat list order: Lead rows first, then newest activity-first.
///
/// Single source of truth for both the full fetch (`SessionsPage`) and the
/// incremental `session.created` / `session.updated` paths. The sort key is
/// `timeUpdated ?? timeCreated`: a session that just received a turn bubbles up
/// even when it was created long ago; rows from older gateways (no
/// `time.updated`) keep the previous creation-time order.
int compareSessionRows(MafwSession a, MafwSession b) {
  if (a.isLead != b.isLead) return a.isLead ? -1 : 1;
  final aKey = a.timeUpdated ?? a.timeCreated ?? 0;
  final bKey = b.timeUpdated ?? b.timeCreated ?? 0;
  return bKey.compareTo(aKey);
}

/// Internal session agents (`gateway/src/core/session-visibility.ts`).
///
/// Persisted on the session itself, so they survive the internal-session kv TTL
/// pruning that used to resurrect old worker sessions.
const List<String> kInternalSessionAgents = [
  'memory-curator',
  'mafw-tech-lead',
  'mafw-execute',
  'mafw-review',
];

/// Internal roles declared in `metadata.mafw.role`.
///
/// `manager` is deliberately absent: it is the pre-2026-11 coordination role and
/// those sessions are still the user's own history (the gateway keeps them
/// visible too).
const List<String> kInternalSessionMetadataRoles = [
  'lead',
  'tech-lead',
  'tech_lead',
];

/// Legacy worker session titles (the title is the first line of the pipeline prompt).
const List<String> kInternalSessionTitlePrefixes = [
  '# Memory Index',
  '{',
  '```',
  '标题：',
];

/// Would `/api/sessions` hide this session? (E6-4 review M1.)
///
/// Mirror of the gateway's `isHiddenSession`, minus its `roleFor` kv lookup: the
/// internal-session registry only exists server-side, and an incremental frame
/// can only judge the row itself. Every row-local signal (parentID, title
/// prefix, agent, metadata role) is identical to the server predicate, so the
/// incremental list converges to `/api/sessions` without a refresh.
///
/// Without this, a live `session.created` for an internal session (a reflect
/// worker, a Pod Lead session) shows up in the 聊天 list until the next full
/// fetch silently drops it.
bool isHiddenSessionRow(MafwSession session) {
  if ((session.parentID ?? '').isNotEmpty) return true;

  final title = session.title ?? '';
  for (final prefix in kInternalSessionTitlePrefixes) {
    if (title.startsWith(prefix)) return true;
  }

  final agent = session.agent;
  if (agent != null && agent.isNotEmpty && kInternalSessionAgents.contains(agent)) {
    return true;
  }

  final role = session.metadata?['mafw']?['role'];
  if (role is String && kInternalSessionMetadataRoles.contains(role)) return true;

  return false;
}

/// `properties.info` of a canonical session lifecycle frame, when present.
Map<String, dynamic>? sessionInfoOf(MafwEvent event) {
  final raw = event.properties?['info'];
  return raw is Map<String, dynamic> ? raw : null;
}

/// Apply one live event to an already-loaded session list.
///
/// Returns the same [current] instance when the event does not change the list.
List<MafwSession> applySessionListEvent(
  List<MafwSession> current,
  MafwEvent event,
) {
  switch (event.innerType) {
    case kSessionUpdatedEvent:
      return _applyUpdated(current, event);
    case kSessionDeletedEvent:
      return _applyDeleted(current, event);
    case kSessionCreatedEvent:
      return _applyCreated(current, event);
    default:
      return current;
  }
}

List<MafwSession> _applyUpdated(List<MafwSession> current, MafwEvent event) {
  final id = _sessionIdOf(event);
  if (id == null) return current;
  final index = current.indexWhere((row) => row.id == id);
  if (index < 0) return current;

  final merged = _mergeInfo(current[index], sessionInfoOf(event));
  if (merged == null) return current;

  final next = List<MafwSession>.of(current);
  next[index] = merged;
  // A new activity timestamp changes the row's place in the list: re-sort so
  // the session that just received a turn bubbles to the top. A field patch
  // without `time.updated` (rename, directory) keeps the order untouched.
  if (merged.timeUpdated != current[index].timeUpdated) {
    next.sort(compareSessionRows);
  }
  return next;
}

List<MafwSession> _applyDeleted(List<MafwSession> current, MafwEvent event) {
  final id = _sessionIdOf(event);
  if (id == null) return current;
  final next = current.where((row) => row.id != id).toList();
  // Nothing was removed → keep the exact list (no pointless setState).
  return next.length == current.length ? current : next;
}

List<MafwSession> _applyCreated(List<MafwSession> current, MafwEvent event) {
  final info = sessionInfoOf(event);
  final row = _completeRowOf(info);
  if (row == null) return current;

  final next = List<MafwSession>.of(current)
    ..removeWhere((existing) => existing.id == row.id)
    ..add(row);
  next.sort(compareSessionRows);
  return next;
}

/// A row usable as-is: created frames must be complete **and visible**.
///
/// The title is not optional here (unlike `session.updated`): the gateway sends
/// `session.created` before a title exists for some runtimes, and the full list
/// fetch is the only authority on that row. The envelope `sessionID` is not
/// used as an id fallback — `properties.info.id` is the contract
/// (`event-field-contract.ts`), and a frame without it means "refetch".
///
/// Hidden rows (internal workers / child sessions / Lead) never enter the list:
/// `/api/sessions` filters them, and the incremental path must not disagree with
/// the next full fetch.
MafwSession? _completeRowOf(Map<String, dynamic>? info) {
  if (info == null) return null;
  final rawId = info['id'];
  if (rawId is! String || rawId.isEmpty) return null;
  final rawTitle = info['title'];
  if (rawTitle is! String || rawTitle.isEmpty) return null;
  final row = MafwSession.fromJson(info);
  return isHiddenSessionRow(row) ? null : row;
}

/// Session id of a lifecycle frame: `properties.info.id`, else the envelope
/// `sessionID` (delete frames may omit info).
String? _sessionIdOf(MafwEvent event) {
  final raw = sessionInfoOf(event)?['id'];
  if (raw is String && raw.isNotEmpty) return raw;
  final sid = event.sessionID;
  return sid == null || sid.isEmpty ? null : sid;
}

/// Merge the present fields of [info] into [row]; null when nothing changes.
///
/// Absent keys leave the existing value alone — the broadcast patch is
/// partial, and clearing on absence would blank titles on `agent_start`
/// updates (the gateway maps those to a title-less `session.updated`).
MafwSession? _mergeInfo(MafwSession row, Map<String, dynamic>? info) {
  if (info == null) return null;

  // `is String` (not `as String?`): a broadcast payload is untrusted, and one
  // wrong type must not throw inside the event handler.
  final rawTitle = info['title'];
  final title = rawTitle is String ? rawTitle : null;
  final rawProjectID = info['projectID'];
  final projectID = rawProjectID is String ? rawProjectID : null;
  final rawDirectory = info['directory'];
  final directory = rawDirectory is String ? rawDirectory : null;
  final metadata =
      info['metadata'] is Map<String, dynamic> ? info['metadata'] as Map<String, dynamic> : null;
  final time = info['time'];
  final created = time is Map<String, dynamic> && time['created'] is num
      ? (time['created'] as num).toInt()
      : null;
  final updated = time is Map<String, dynamic> && time['updated'] is num
      ? (time['updated'] as num).toInt()
      : null;

  final unchanged = (title == null || title == row.title) &&
      (projectID == null || projectID == row.projectID) &&
      (directory == null || directory == row.directory) &&
      (metadata == null || identical(metadata, row.metadata)) &&
      (created == null || created == row.timeCreated) &&
      (updated == null || updated == row.timeUpdated);
  if (unchanged) return null;

  return row.copyWith(
    title: title,
    projectID: projectID,
    directory: directory,
    metadata: metadata,
    timeCreated: created,
    timeUpdated: updated,
  );
}
