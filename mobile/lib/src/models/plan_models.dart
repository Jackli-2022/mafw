/// Orcalore Plan 批准读模型（mobile）。
///
/// 形状实读 gateway 路由与纯类型层，不猜：
/// - `GET /api/goals/:id/plan` → `{planReview, planApproval{id?,status,round,revision?,
///   planHash?,evalHash?}, planFeedback, round, revision, waves, wavesPath,
///   goalEval, goalEvalPath, goalEvalError, planHash, evalHash, stale}`
///   （`gateway/src/routes/goal-plan.ts`）；
/// - `waves` 是 waves.json 原文：`{status, taskType?, strategy?, waves:[{id, title?,
///   riskNote?, tasks:[string | {taskId?, title, acceptance?[]}]}]}`
///   （`gateway/src/core/goal/node-prompts.ts` 的计划 schema 与
///   `gateway/src/core/goal/wave-plan-edit.ts` 的稳定 id 规则）；
/// - `goalEval` 是 `GoalEval`：`{outcome, conditions:[{id, statement, required,
///   evidence, method}], failureConditions[], constraints[], nonGoals[], mapping}`
///   （`gateway/src/core/goal/goal-eval.ts`）。
///
/// 解析一律容错：缺失的列表 = 空列表，缺失的文本 = `''`/`null`；但**不臆造**
/// 计划内容（waves 缺失就是空，卡片会显示诚实的空态）。taskId 缺省时用 gateway
/// 同款位置 id `${wave.id}-t${index+1}`，保证与任务板/回执的 id 对得上。
library;

String _str(Object? value) => value == null ? '' : value.toString();

String? _strOrNull(Object? value) {
  if (value == null) return null;
  final text = value.toString();
  return text.isEmpty ? null : text;
}

int? _intOrNull(Object? value) {
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

Map<String, dynamic> _map(Object? value) =>
    value is Map<String, dynamic> ? value : const <String, dynamic>{};

List<dynamic> _list(Object? value) => value is List ? value : const <dynamic>[];

String _trimmed(Object? value) => _str(value).trim();

/// 一条计划任务（字符串任务会被升级成这个形状）。
class PlanTaskInfo {
  /// 稳定任务 id（`w1-t2`）；与 gateway `taskIdAt` 的缺省规则一致。
  final String taskId;
  final String title;

  /// 任务级验收标准（可机械验证的结果）。
  final List<String> acceptance;

  const PlanTaskInfo({
    required this.taskId,
    required this.title,
    required this.acceptance,
  });
}

/// 一个 wave（计划里的一批任务 + 风险提示）。
class WaveInfo {
  final String id;
  final String title;

  /// Tech Lead 写的「这个 wave 最可能的失败」。
  final String riskNote;
  final List<PlanTaskInfo> tasks;

  const WaveInfo({
    required this.id,
    required this.title,
    required this.riskNote,
    required this.tasks,
  });

  String get label => title.isEmpty ? 'Wave $id' : 'Wave $id · $title';
}

/// 一条 Goal Eval 验收条件。
class GoalEvalConditionInfo {
  final String id;
  final String statement;

  /// 必需条件（Reviewer rubric 的覆盖下限）。
  final bool required;

  /// 要什么证据 / 怎么验。
  final String evidence;
  final String method;

  const GoalEvalConditionInfo({
    required this.id,
    required this.statement,
    required this.required,
    required this.evidence,
    required this.method,
  });
}

/// `GoalEval`（独立于实现的产品级验收契约）。
class GoalEvalInfo {
  final String outcome;
  final List<GoalEvalConditionInfo> conditions;
  final List<String> failureConditions;
  final List<String> constraints;
  final List<String> nonGoals;

  const GoalEvalInfo({
    required this.outcome,
    required this.conditions,
    required this.failureConditions,
    required this.constraints,
    required this.nonGoals,
  });
}

/// `GET /api/goals/:id/plan` 的读模型。
class GoalPlanInfo {
  /// `planApproval.id`（服务端一次性随机 id）；legacy 批准缺省为 `''`。
  final String approvalId;

  /// `planApproval.status`：`pending | approved | rejected`；缺省 `''`。
  final String approvalStatus;

  /// 当前 waves 内容的规范化哈希（批准时回传，服务端据此判 stale）。
  final String planHash;

  /// 当前 Goal Eval 的规范化哈希；没有 eval 的计划为空串。
  final String evalHash;

  /// 计划文档里的 wave 列表（waves 缺失/损坏 = 空）。
  final List<WaveInfo> waves;

  /// Goal Eval；缺失或不可解析 = `null`（卡片显示"没有可解析的 Goal Eval"）。
  final GoalEvalInfo? goalEval;

  /// 服务端读取 Goal Eval 失败的说明（`goalEvalError`），仅用于诊断展示。
  final String? goalEvalError;

  /// `planReview`（`manual | auto`）。
  final String planReview;

  /// 上一轮驳回反馈（`state.planFeedback`）。
  final String? planFeedback;

  final int? revision;
  final int round;

  /// 服务端判定"旧批准绑的内容已被改写"。
  final bool stale;

  const GoalPlanInfo({
    required this.approvalId,
    required this.approvalStatus,
    required this.planHash,
    required this.evalHash,
    required this.waves,
    required this.goalEval,
    required this.goalEvalError,
    required this.planReview,
    required this.planFeedback,
    required this.revision,
    required this.round,
    required this.stale,
  });

  factory GoalPlanInfo.fromJson(Map<String, dynamic> j) {
    final approval = _map(j['planApproval']);
    final topPlanHash = _trimmed(j['planHash']);
    final topEvalHash = _trimmed(j['evalHash']);
    final waves = _parseWaves(j['waves']);
    return GoalPlanInfo(
      approvalId: _trimmed(approval['id']),
      approvalStatus: _trimmed(approval['status']),
      // 顶层哈希是当前内容的权威；planApproval 里的是"批准时"的旧值，只在顶层缺失时兜底。
      planHash: topPlanHash.isNotEmpty ? topPlanHash : _trimmed(approval['planHash']),
      evalHash: topEvalHash.isNotEmpty ? topEvalHash : _trimmed(approval['evalHash']),
      waves: waves,
      goalEval: _parseGoalEval(j['goalEval']),
      goalEvalError: _strOrNull(j['goalEvalError']),
      planReview: _trimmed(j['planReview']),
      planFeedback: _strOrNull(j['planFeedback']),
      revision: _intOrNull(j['revision']),
      round: _intOrNull(j['round']) ?? 1,
      stale: j['stale'] == true,
    );
  }

  /// 批准门是否还等着人（`approved/rejected` 时卡片不该继续催）。
  bool get pending => approvalStatus.isEmpty || approvalStatus == 'pending';

  /// 计划是否至少有一条可审阅内容。
  bool get hasContent => waves.isNotEmpty || goalEval != null;

  int get taskCount {
    var total = 0;
    for (final wave in waves) {
      total += wave.tasks.length;
    }
    return total;
  }
}

List<WaveInfo> _parseWaves(Object? raw) {
  // 服务端给的是 waves.json 整份文档（`{waves:[...]}`）；也容忍直接给数组。
  final List<dynamic> rawWaves =
      raw is List ? raw : _list(raw is Map<String, dynamic> ? raw['waves'] : null);
  final out = <WaveInfo>[];
  for (final item in rawWaves) {
    if (item is! Map<String, dynamic>) continue;
    final id = _trimmed(item['id']);
    final rawTasks = _list(item['tasks']);
    final tasks = <PlanTaskInfo>[];
    for (var index = 0; index < rawTasks.length; index++) {
      final rawTask = rawTasks[index];
      final fallbackId = id.isEmpty ? '' : '$id-t${index + 1}';
      if (rawTask is String) {
        final title = rawTask.trim();
        if (title.isEmpty) continue;
        tasks.add(PlanTaskInfo(
          taskId: fallbackId,
          title: title,
          acceptance: const <String>[],
        ));
        continue;
      }
      if (rawTask is! Map<String, dynamic>) continue;
      final title = _trimmed(rawTask['title']);
      if (title.isEmpty) continue;
      final explicitId = _trimmed(rawTask['taskId']);
      final acceptance = <String>[];
      for (final entry in _list(rawTask['acceptance'])) {
        if (entry is! String) continue;
        final text = entry.trim();
        if (text.isEmpty || acceptance.contains(text)) continue;
        acceptance.add(text);
      }
      tasks.add(PlanTaskInfo(
        taskId: explicitId.isNotEmpty ? explicitId : fallbackId,
        title: title,
        acceptance: acceptance,
      ));
    }
    if (id.isEmpty && tasks.isEmpty) continue;
    out.add(WaveInfo(
      id: id,
      title: _trimmed(item['title']),
      riskNote: _trimmed(item['riskNote']),
      tasks: tasks,
    ));
  }
  return out;
}

GoalEvalInfo? _parseGoalEval(Object? raw) {
  if (raw is! Map<String, dynamic>) return null;
  final outcome = _trimmed(raw['outcome']);
  final conditions = <GoalEvalConditionInfo>[];
  for (final item in _list(raw['conditions'])) {
    if (item is! Map<String, dynamic>) continue;
    final id = _trimmed(item['id']);
    final statement = _trimmed(item['statement']);
    if (id.isEmpty || statement.isEmpty) continue;
    conditions.add(GoalEvalConditionInfo(
      id: id,
      statement: statement,
      required: item['required'] == true,
      evidence: _trimmed(item['evidence']),
      method: _trimmed(item['method']),
    ));
  }
  // 与桌面 plan-render 同规：outcome 或条件缺失视为"没有可解析的 Goal Eval"。
  if (outcome.isEmpty || conditions.isEmpty) return null;
  List<String> strings(Object? value) {
    final out = <String>[];
    for (final entry in _list(value)) {
      if (entry is! String) continue;
      final text = entry.trim();
      if (text.isEmpty || out.contains(text)) continue;
      out.add(text);
    }
    return out;
  }

  return GoalEvalInfo(
    outcome: outcome,
    conditions: conditions,
    failureConditions: strings(raw['failureConditions']),
    constraints: strings(raw['constraints']),
    nonGoals: strings(raw['nonGoals']),
  );
}
