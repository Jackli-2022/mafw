/// MAFW Work / Presence / Pod read models (mobile).
///
/// Shapes are taken from the gateway route files, never guessed:
/// - `GET /api/projects` → `{projects:[{id, worktree}]}` (`gateway/src/index.ts:6813`)
///   where `id` is the project directory — the `projectId` used in URLs.
/// - `GET /api/projects/:projectId/work` → `{projectDir, podId, groups{bucket→[]},
///   counts{bucket→n}, total}` (`gateway/src/routes/pod-work.ts`).
/// - `GET /api/presence` → `{running[], attention{count,items},
///   unreadResults{count,latest}}` (`gateway/src/core/pod/pod-presence.ts`).
/// - `GET /api/pods/:podId/goals` → `{items: PodGoalView[]}` (`gateway/src/routes/pods.ts`).
/// - `GET /api/projects/:projectId/pod/lookup` → Pod detail view, 404 = no Pod.
/// - `POST /api/pods/:podId/lead/ensure` → `{podId, projectDir, sessionId}`.
///
/// Every parser is tolerant of absent/absent-ish fields: a missing bucket is an
/// empty list and a missing verdict stays `null` — the UI must never be forced
/// to invent data the gateway did not send.
library;

/// The five `work.overview` buckets, in display order.
const List<String> workBuckets = <String>[
  'needs_you',
  'queued',
  'in_progress',
  'result_ready',
  'ended',
];

String _str(Object? value) => value == null ? '' : value.toString();

String? _strOrNull(Object? value) {
  if (value == null) return null;
  final text = value.toString();
  return text.isEmpty ? null : text;
}

int _int(Object? value, {int fallback = 0}) {
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value) ?? fallback;
  return fallback;
}

bool _bool(Object? value) => value == true || value == 'true';

Map<String, dynamic> _map(Object? value) =>
    value is Map<String, dynamic> ? value : const <String, dynamic>{};

List<dynamic> _list(Object? value) => value is List ? value : const <dynamic>[];

/// A registered gateway project.
///
/// [dir] is the absolute project directory and doubles as the `projectId` path
/// segment for `work.overview` / `podLookup` / `podEnsure`.
class ProjectInfo {
  final String dir;

  const ProjectInfo({required this.dir});

  factory ProjectInfo.fromJson(Map<String, dynamic> j) {
    final id = _str(j['id']);
    return ProjectInfo(dir: id.isNotEmpty ? id : _str(j['worktree']));
  }
}

/// One Goal row of `work.overview` / `/api/pods/:id/goals` (`PodGoalView`).
///
/// [status] is `queued|active|done|aborted`, [bucket] is one of [workBuckets];
/// both are `''` when the gateway omitted them. [verdict] is `PASS|FAIL|
/// MAX_RETRIES|ERROR|CANCELLED|UNREVIEWED` or `null` while the Goal is running.
class PodGoalView {
  final String goalId;
  final String title;
  final String status;
  final String bucket;
  final int revision;
  final String? verdict;
  final bool resultReady;

  /// Tech Lead execution choice: `quick` | `collaborative`.
  final String? strategy;

  /// Who is on the hook now: `person` | `team` | `system`.
  final String? stageOwner;

  /// What they are doing: `working` | `waiting` | `plan_approval` |
  /// `direction_review` | `question` | `blocked` | ...
  final String? stageKind;

  const PodGoalView({
    required this.goalId,
    required this.title,
    required this.status,
    required this.bucket,
    required this.revision,
    required this.verdict,
    required this.resultReady,
    required this.strategy,
    required this.stageOwner,
    required this.stageKind,
  });

  factory PodGoalView.fromJson(Map<String, dynamic> j) {
    final stage = _map(j['stage']);
    final revision = _int(j['revision'] ?? j['activeRevision'], fallback: 1);
    return PodGoalView(
      goalId: _str(j['goalId']),
      title: _str(j['title']),
      status: _str(j['status']),
      bucket: _str(j['bucket']),
      revision: revision > 0 ? revision : 1,
      verdict: _strOrNull(j['verdict']),
      resultReady: _bool(j['resultReady']),
      strategy: _strOrNull(j['strategy']),
      stageOwner: _strOrNull(stage['owner']),
      stageKind: _strOrNull(stage['kind']),
    );
  }
}

/// `GET /api/projects/:projectId/work` — the five-bucket project overview.
///
/// [groups] always contains all [workBuckets] (absent bucket → empty list) and
/// [counts] always contains all of them (absent count → that list's length).
class WorkOverview {
  final String projectDir;
  final String podId;
  final Map<String, List<PodGoalView>> groups;
  final Map<String, int> counts;
  final int total;

  const WorkOverview({
    required this.projectDir,
    required this.podId,
    required this.groups,
    required this.counts,
    required this.total,
  });

  factory WorkOverview.fromJson(Map<String, dynamic> j) {
    final rawGroups = _map(j['groups']);
    final rawCounts = _map(j['counts']);
    final groups = <String, List<PodGoalView>>{};
    final counts = <String, int>{};

    void readBucket(String bucket) {
      final parsed = <PodGoalView>[];
      for (final item in _list(rawGroups[bucket])) {
        if (item is Map<String, dynamic>) parsed.add(PodGoalView.fromJson(item));
      }
      groups[bucket] = parsed;
      counts[bucket] = _int(rawCounts[bucket], fallback: parsed.length);
    }

    for (final bucket in workBuckets) {
      readBucket(bucket);
    }
    // Forward-compatible: a future gateway bucket is surfaced instead of dropped.
    for (final bucket in rawGroups.keys) {
      if (!groups.containsKey(bucket)) readBucket(bucket);
    }
    for (final bucket in rawCounts.keys) {
      if (!counts.containsKey(bucket)) {
        counts[bucket] = _int(rawCounts[bucket]);
      }
    }

    final sum = counts.values.fold<int>(0, (acc, value) => acc + value);
    return WorkOverview(
      projectDir: _str(j['projectDir']),
      podId: _str(j['podId']),
      groups: groups,
      counts: counts,
      total: _int(j['total'], fallback: sum),
    );
  }

  /// Goals in [bucket] — always a list, never null.
  List<PodGoalView> bucket(String bucket) => groups[bucket] ?? const <PodGoalView>[];
}

/// One human attention item (`PodAttentionItem`, revision-scoped id).
///
/// The gateway presence projection does not attach [projectId]/[podId] to these
/// items yet, so both stay `null` instead of being guessed from elsewhere.
class AttentionItem {
  final String id;
  final String goalId;
  final String? projectId;
  final String? podId;

  /// `plan_approval` | `direction_review` | `question` | `blocked`.
  final String kind;
  final String title;

  const AttentionItem({
    required this.id,
    required this.goalId,
    required this.projectId,
    required this.podId,
    required this.kind,
    required this.title,
  });

  factory AttentionItem.fromJson(Map<String, dynamic> j) {
    return AttentionItem(
      id: _str(j['id']),
      goalId: _str(j['goalId']),
      projectId: _strOrNull(j['projectId']),
      podId: _strOrNull(j['podId']),
      kind: _str(j['kind']),
      title: _str(j['title']),
    );
  }
}

/// Cross-project presence (`GET /api/presence`).
///
/// [running] holds the running Goal titles (`running[].title`, falling back to
/// its `goalId`) so a mobile badge line can render them directly.
class PresenceInfo {
  final List<String> running;
  final List<AttentionItem> attention;
  final int unreadResultsCount;

  const PresenceInfo({
    required this.running,
    required this.attention,
    required this.unreadResultsCount,
  });

  factory PresenceInfo.fromJson(Map<String, dynamic> j) {
    final running = <String>[];
    for (final item in _list(j['running'])) {
      if (item is String) {
        if (item.isNotEmpty) running.add(item);
        continue;
      }
      if (item is! Map<String, dynamic>) continue;
      final title = _str(item['title']);
      running.add(title.isNotEmpty ? title : _str(item['goalId']));
    }

    final rawAttention = j['attention'];
    final attentionItems = rawAttention is Map<String, dynamic>
        ? _list(rawAttention['items'])
        : _list(rawAttention);
    final attention = <AttentionItem>[];
    for (final item in attentionItems) {
      if (item is Map<String, dynamic>) attention.add(AttentionItem.fromJson(item));
    }

    final rawUnread = j['unreadResults'];
    final unreadCount = rawUnread is Map<String, dynamic>
        ? _int(rawUnread['count'])
        : _int(rawUnread);

    return PresenceInfo(
      running: running,
      attention: attention,
      unreadResultsCount: unreadCount,
    );
  }
}

/// A project Pod (`GET /api/projects/:projectId/pod/lookup`).
///
/// The detail envelope nests the pod row under `pod`; `goals` and `attention`
/// are sibling arrays of the same response.
class PodInfo {
  final String id;
  final String projectDir;
  final String name;
  final String status; // active | idle | paused | archived
  final String? activeGoalId;
  final List<PodGoalView> goals;
  final List<AttentionItem> attention;

  const PodInfo({
    required this.id,
    required this.projectDir,
    required this.name,
    required this.status,
    required this.activeGoalId,
    required this.goals,
    required this.attention,
  });

  factory PodInfo.fromJson(Map<String, dynamic> j) {
    final pod = _map(j['pod']);
    final goals = <PodGoalView>[];
    for (final item in _list(j['goals'])) {
      if (item is Map<String, dynamic>) goals.add(PodGoalView.fromJson(item));
    }
    final attention = <AttentionItem>[];
    for (final item in _list(j['attention'])) {
      if (item is Map<String, dynamic>) attention.add(AttentionItem.fromJson(item));
    }
    return PodInfo(
      id: _str(pod['id'] ?? j['podId']),
      projectDir: _str(pod['projectDir']),
      name: _str(pod['name']),
      status: _str(pod['status']),
      activeGoalId: _strOrNull(pod['activeGoalId']),
      goals: goals,
      attention: attention,
    );
  }
}
