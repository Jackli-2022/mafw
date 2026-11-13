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
///   never reorders or clears the row (matching the desktop entity patch);
/// - `session.created` requires both an id and a non-empty title; anything less
///   returns the input unchanged so the page falls back to one debounced full
///   fetch (an id-only ghost row is worse than a short delay);
/// - every other event returns the same list instance (no rebuild churn).
library;

import 'mafw_models.dart';

/// 会话生命周期事件的 canonical 内层名。
const String kSessionCreatedEvent = 'session.created';
const String kSessionUpdatedEvent = 'session.updated';
const String kSessionDeletedEvent = 'session.deleted';

/// Chat list order: Lead rows first, then newest-first.
///
/// Single source of truth for both the full fetch (`SessionsPage`) and the
/// incremental `session.created` insert.
int compareSessionRows(MafwSession a, MafwSession b) {
  if (a.isLead != b.isLead) return a.isLead ? -1 : 1;
  return (b.timeCreated ?? 0).compareTo(a.timeCreated ?? 0);
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

/// A row usable as-is: created frames must be complete.
///
/// The title is not optional here (unlike `session.updated`): the gateway sends
/// `session.created` before a title exists for some runtimes, and the full list
/// fetch is the only authority on that row. The envelope `sessionID` is not
/// used as an id fallback — `properties.info.id` is the contract
/// (`event-field-contract.ts`), and a frame without it means "refetch".
MafwSession? _completeRowOf(Map<String, dynamic>? info) {
  if (info == null) return null;
  final rawId = info['id'];
  if (rawId is! String || rawId.isEmpty) return null;
  final rawTitle = info['title'];
  if (rawTitle is! String || rawTitle.isEmpty) return null;
  return MafwSession.fromJson(info);
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

  final title = info['title'] as String?;
  final projectID = info['projectID'] as String?;
  final directory = info['directory'] as String?;
  final metadata =
      info['metadata'] is Map<String, dynamic> ? info['metadata'] as Map<String, dynamic> : null;
  final time = info['time'];
  final created = time is Map<String, dynamic> && time['created'] is num
      ? (time['created'] as num).toInt()
      : null;

  final unchanged = (title == null || title == row.title) &&
      (projectID == null || projectID == row.projectID) &&
      (directory == null || directory == row.directory) &&
      (metadata == null || identical(metadata, row.metadata)) &&
      (created == null || created == row.timeCreated);
  if (unchanged) return null;

  return row.copyWith(
    title: title,
    projectID: projectID,
    directory: directory,
    metadata: metadata,
    timeCreated: created,
  );
}
