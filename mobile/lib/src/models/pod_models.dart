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
/// - `GET /api/goals/:id/timeline` → `{goal, nodes, artifacts, outcome}`
///   (`gateway/src/routes/goal-timeline.ts`), 404 = 还没有 Goal state。
/// - `GET /api/pods/:podId/goals/:goalId/revisions` → `{items: PodGoalRevisionRow[]}`
///   (`gateway/src/routes/pod-collaboration.ts` → `PodGoalRevisionRow`)。
/// - `GET /api/pods/:podId/goals/:goalId/result` → `PodGoalResult`
///   (`gateway/src/core/pod/pod-result.ts`), 404 = 还没有结果可读。
/// - `POST /api/pods/:podId/goals/:goalId/reject {feedback}` → `PodRejectResult`。
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

// ── Goal 详情：timeline / revisions / result（Task 8）──────────────────────────

/// 终态 `nextAction`（`gateway/src/core/goal/state-v3.ts` TERMINAL_ACTIONS）。
const Set<String> goalTerminalActions = <String>{
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'ARCHIVED',
};

/// 一条 `goal_node_runs` 记录（`GET /api/goals/:id/timeline` → `nodes[]`）。
///
/// [status] 是 run 的机械状态（`running | succeeded | failed | timeout`），
/// [outcome] 是该节点的结论文本（review 为 `PASS/FAIL`，execute 为回执摘要）。
class GoalNodeRun {
  final String runId;
  final int loop;
  final String node; // plan | probe | execute | review
  final int attempt;
  final String status;
  final String? sessionId;
  final String? startedAt;
  final String? finishedAt;
  final int? durationMs;
  final String? outcome;
  final String? error;

  const GoalNodeRun({
    required this.runId,
    required this.loop,
    required this.node,
    required this.attempt,
    required this.status,
    required this.sessionId,
    required this.startedAt,
    required this.finishedAt,
    required this.durationMs,
    required this.outcome,
    required this.error,
  });

  factory GoalNodeRun.fromJson(Map<String, dynamic> j) {
    final duration = j['durationMs'];
    return GoalNodeRun(
      runId: _str(j['runId'] ?? j['id'] ?? j['run_id']),
      loop: _int(j['loop'], fallback: 1),
      node: _str(j['node']),
      attempt: _int(j['attempt'], fallback: 1),
      status: _str(j['status']),
      sessionId: _strOrNull(j['sessionId'] ?? j['session_id']),
      startedAt: _strOrNull(j['startedAt'] ?? j['started_at']),
      finishedAt: _strOrNull(j['finishedAt'] ?? j['finished_at']),
      durationMs: duration is num ? duration.toInt() : null,
      outcome: _strOrNull(j['outcome']),
      error: _strOrNull(j['error']),
    );
  }
}

/// `GET /api/goals/:id/timeline` — goal 节点级执行 trace 聚合。
///
/// [nextAction] 是阶段/终态的权威（`RUNNING_execute`、`AWAIT_PLAN_APPROVAL`、
/// `COMPLETED` …），[terminal] 由它推导；缺失的字段一律保持空/`null`。
class GoalTimeline {
  final String goalId;
  final String title;
  final String? phase;
  final int round;
  final int maxRounds;
  final String? verdict;
  final String? nextNode;
  final String? nextAction;
  final String? lastError;
  final String? updatedAt;
  final List<GoalNodeRun> nodes;
  final String? wavesPath;
  final List<String> receipts;
  final String? reviewsDir;

  const GoalTimeline({
    required this.goalId,
    required this.title,
    required this.phase,
    required this.round,
    required this.maxRounds,
    required this.verdict,
    required this.nextNode,
    required this.nextAction,
    required this.lastError,
    required this.updatedAt,
    required this.nodes,
    required this.wavesPath,
    required this.receipts,
    required this.reviewsDir,
  });

  factory GoalTimeline.fromJson(Map<String, dynamic> j) {
    final goal = _map(j['goal']);
    final artifacts = _map(j['artifacts']);
    final nodes = <GoalNodeRun>[];
    for (final item in _list(j['nodes'])) {
      if (item is Map<String, dynamic>) nodes.add(GoalNodeRun.fromJson(item));
    }
    final receipts = <String>[];
    for (final item in _list(artifacts['receipts'])) {
      final text = _str(item);
      if (text.isNotEmpty) receipts.add(text);
    }
    return GoalTimeline(
      goalId: _str(goal['goalId'] ?? j['goalId']),
      title: _str(goal['title']),
      phase: _strOrNull(goal['phase']),
      round: _int(goal['round'], fallback: 1),
      maxRounds: _int(goal['maxRounds']),
      verdict: _strOrNull(goal['verdict']),
      nextNode: _strOrNull(goal['nextNode']),
      nextAction: _strOrNull(goal['nextAction']),
      lastError: _strOrNull(goal['lastError']),
      updatedAt: _strOrNull(goal['updatedAt']),
      nodes: nodes,
      wavesPath: _strOrNull(artifacts['wavesPath']),
      receipts: receipts,
      reviewsDir: _strOrNull(artifacts['reviewsDir']),
    );
  }

  /// 归档态（`COMPLETED/FAILED/CANCELLED/ARCHIVED`）。
  bool get terminal =>
      nextAction != null && goalTerminalActions.contains(nextAction);
}

/// 一条 revision 历史（`PodGoalRevisionRow`，append-only）。
class RevisionInfo {
  final int revision;

  /// `discussing | direction_review | planning | plan_review | queued |
  /// implementing | reviewing | completed | aborted | discarded`。
  final String status;
  final String? verdict;

  /// 打回反馈（`rejectResult` 写入下一 revision）。
  final String? feedback;
  final String? startedAt;
  final String? endedAt;

  const RevisionInfo({
    required this.revision,
    required this.status,
    required this.verdict,
    required this.feedback,
    required this.startedAt,
    required this.endedAt,
  });

  factory RevisionInfo.fromJson(Map<String, dynamic> j) {
    return RevisionInfo(
      revision: _int(j['revision'], fallback: 1),
      status: _str(j['status']),
      verdict: _strOrNull(j['verdict']),
      feedback: _strOrNull(j['feedback']),
      startedAt: _strOrNull(j['startedAt'] ?? j['started_at']),
      endedAt: _strOrNull(j['endedAt'] ?? j['ended_at']),
    );
  }
}

/// Goal Eval 条件 + Reviewer 判定（[result]/[evidence] 来自 `goalResults`）。
class GoalConditionResult {
  final String id;
  final String statement;
  final bool required;

  /// `pass | fail | skipped`；评审未跑时保持 `null`（不臆造证据）。
  final String? result;
  final String? evidence;

  const GoalConditionResult({
    required this.id,
    required this.statement,
    required this.required,
    required this.result,
    required this.evidence,
  });

  factory GoalConditionResult.fromJson(
    Map<String, dynamic> condition, {
    Map<String, dynamic>? judgement,
  }) {
    return GoalConditionResult(
      id: _str(condition['id']),
      statement: _str(condition['statement']),
      required: condition['required'] == true,
      result: _strOrNull(judgement?['result']),
      evidence: _strOrNull(judgement?['evidence']),
    );
  }
}

/// Reviewer 的逐任务判定（`PodGoalResult.tasks`）。
class GoalTaskResult {
  final String taskId;

  /// `pass | fail | skipped`。
  final String result;
  final String evidence;

  const GoalTaskResult({
    required this.taskId,
    required this.result,
    required this.evidence,
  });

  factory GoalTaskResult.fromJson(Map<String, dynamic> j) {
    return GoalTaskResult(
      taskId: _str(j['taskId']),
      result: _str(j['result']),
      evidence: _str(j['evidence']),
    );
  }
}

/// `GET /api/pods/:podId/goals/:goalId/result`（`PodGoalResult`）。
///
/// [acceptance] 是申请时的验收原文；[conditions] 把 Goal Eval 条件与 Reviewer
/// 判定合并成一行一条；[tasks] 是逐任务证据；[failure] 非空表示「结果不可信」
/// （评审缺失/非法）——UI 必须照实展示，不得宣称验收通过。
class GoalResultInfo {
  final String goalId;
  final int revision;
  final String? verdict;
  final bool resultReady;

  /// `reviewed | unreviewed | null`（没有独立评审）。
  final String? assessment;
  final List<String> acceptance;
  final List<GoalConditionResult> conditions;
  final List<GoalTaskResult> tasks;
  final String feedback;
  final List<String> artifacts;
  final String? failure;

  const GoalResultInfo({
    required this.goalId,
    required this.revision,
    required this.verdict,
    required this.resultReady,
    required this.assessment,
    required this.acceptance,
    required this.conditions,
    required this.tasks,
    required this.feedback,
    required this.artifacts,
    required this.failure,
  });

  factory GoalResultInfo.fromJson(Map<String, dynamic> j) {
    final judgements = <String, Map<String, dynamic>>{};
    for (final item in _list(j['goalResults'])) {
      if (item is! Map<String, dynamic>) continue;
      final id = _str(item['conditionId']);
      if (id.isNotEmpty) judgements[id] = item;
    }

    final conditions = <GoalConditionResult>[];
    final seenConditions = <String>{};
    for (final item in _list(j['goalConditions'])) {
      if (item is! Map<String, dynamic>) continue;
      final id = _str(item['id']);
      conditions.add(GoalConditionResult.fromJson(item, judgement: judgements[id]));
      if (id.isNotEmpty) seenConditions.add(id);
    }
    // 评审给了判定、但 eval 不完整（goal_eval_invalid）时也要披露证据。
    for (final entry in judgements.entries) {
      if (seenConditions.contains(entry.key)) continue;
      conditions.add(GoalConditionResult.fromJson(
        <String, dynamic>{'id': entry.key},
        judgement: entry.value,
      ));
    }

    final acceptance = <String>[];
    for (final item in _list(j['goalAcceptance'])) {
      final text = _str(item).trim();
      if (text.isNotEmpty) acceptance.add(text);
    }

    final tasks = <GoalTaskResult>[];
    for (final item in _list(j['tasks'])) {
      if (item is Map<String, dynamic>) tasks.add(GoalTaskResult.fromJson(item));
    }

    final artifacts = <String>[];
    for (final item in _list(j['artifacts'])) {
      final text = _str(item);
      if (text.isNotEmpty) artifacts.add(text);
    }

    return GoalResultInfo(
      goalId: _str(j['goalId']),
      revision: _int(j['revision'], fallback: 1),
      verdict: _strOrNull(j['verdict']),
      resultReady: _bool(j['resultReady']),
      assessment: _strOrNull(j['assessment']),
      acceptance: acceptance,
      conditions: conditions,
      tasks: tasks,
      feedback: _str(j['reviewFeedback']),
      artifacts: artifacts,
      failure: _strOrNull(j['failure']),
    );
  }
}

/// `POST /api/pods/:podId/goals/:goalId/reject`（`PodRejectResult`）里页面需要的字段。
class GoalRejectResult {
  /// 新 revision 号（= 旧 revision + 1）。
  final int revision;
  final String status;
  final String? sessionId;

  const GoalRejectResult({
    required this.revision,
    required this.status,
    required this.sessionId,
  });

  factory GoalRejectResult.fromJson(Map<String, dynamic> j) {
    return GoalRejectResult(
      revision: _int(j['revision']),
      status: _str(j['status']),
      sessionId: _strOrNull(j['sessionID'] ?? j['sessionId']),
    );
  }
}
