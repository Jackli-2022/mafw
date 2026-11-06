/// Minimal HTTP client for the MAFW gateway API.
///
/// This is a simplified version of the GatewayClient for testing purposes.
library;

import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/connection_config.dart';
import '../models/mafw_models.dart';
import '../models/plan_models.dart';
import '../models/pod_models.dart';
import '../services/diagnostics.dart';

class GatewayClient {
  final ConnectionConfig config;
  final DiagnosticsSink? diagnostics;
  final http.Client _http;

  GatewayClient(this.config, {http.Client? httpClient, this.diagnostics})
      : _http = httpClient ?? http.Client();

  Uri _uri(String path, [Map<String, String>? query]) {
    var u = Uri.parse('${config.normalizedBaseUrl}$path');
    if (query != null && query.isNotEmpty) {
      u = u.replace(queryParameters: query);
    }
    return u;
  }

  Map<String, String> get _headers => config.headers;

  // ── Diagnostics-wrapped transport ──

  String _displayPath(Uri uri) => uri.hasQuery ? '${uri.path}?${uri.query}' : uri.path;

  Future<http.Response> _get(Uri uri, {Duration? timeout}) {
    return _record('GET', uri, () {
      final future = _http.get(uri, headers: _headers);
      return timeout == null ? future : future.timeout(timeout);
    });
  }

  Future<http.Response> _post(Uri uri, {Object? body}) {
    return _record('POST', uri, () => _http.post(uri, headers: _headers, body: body));
  }

  Future<http.Response> _record(
    String method,
    Uri uri,
    Future<http.Response> Function() run,
  ) async {
    final started = DateTime.now();
    int elapsed() => DateTime.now().difference(started).inMilliseconds;
    final path = _displayPath(uri);
    try {
      final res = await run();
      diagnostics?.recordHttp(
        method: method,
        path: path,
        status: res.statusCode,
        durationMs: elapsed(),
        errorBody: res.statusCode >= 400
            ? utf8.decode(res.bodyBytes, allowMalformed: true)
            : null,
      );
      return res;
    } catch (e) {
      diagnostics?.recordHttp(
        method: method,
        path: path,
        durationMs: elapsed(),
        error: e.toString(),
      );
      rethrow;
    }
  }

  // ── Health ──

  Future<bool> health() async {
    try {
      final res = await _get(_uri('/health'), timeout: const Duration(seconds: 5));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // ── Sessions ──

  Future<List<MafwSession>> listSessions({String? projectID}) async {
    final res = await _get(
      _uri('/api/sessions', projectID != null ? {'projectID': projectID} : null),
    );
    if (res.statusCode != 200) throw GatewayException('listSessions: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    final list = j['sessions'] as List? ?? [];
    return list.map((e) => MafwSession.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// MAFW flat View DTO history (`GET /api/sessions/:id/messages`).
  ///
  /// The response is always `{ data: MafwMessage[], nextCursor }`; the legacy
  /// `{info,parts}` wire envelope is never parsed and there is no fallback.
  ///
  /// **Detection (not a fallback):** if a non-empty page parses to only invalid
  /// items (no `id` and no `content`), the gateway did not return the MAFW
  /// contract — throw an actionable [GatewayException] instead of rendering
  /// empty bubbles.
  Future<List<MafwMessage>> messages(String sessionID, {int limit = 50}) async {
    final res = await _get(
      _uri('/api/sessions/$sessionID/messages', {'limit': '$limit'}),
    );
    if (res.statusCode != 200) throw GatewayException('messages: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    // Flat envelope: { data: MafwMessage[], nextCursor }
    final raw = j is Map<String, dynamic> ? j['data'] : null;
    final list = raw is List ? raw : <dynamic>[];
    final out = <MafwMessage>[];
    for (final item in list) {
      if (item is! Map<String, dynamic>) continue;
      out.add(MafwMessage.fromJson(item, sessionID: sessionID));
    }
    if (out.isNotEmpty && out.every((m) => m.id.isEmpty && m.parts.isEmpty)) {
      throw GatewayException(
        'gateway did not return the MAFW flat history contract — upgrade gateway',
      );
    }
    return out;
  }

  Future<String> createSession({String? directory}) async {
    final res = await _post(
      _uri('/api/session'),
      body: jsonEncode({'directory': ?directory}),
    );
    if (res.statusCode != 200) throw GatewayException('createSession: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    return (j['id'] ?? j['sessionID'] ?? '').toString();
  }

  // ── Chat (enriched send, memory injection built in) ──

  Future<String> sendEnriched(String message, {String? sessionID}) async {
    final res = await _post(
      _uri('/api/chat/enriched'),
      body: jsonEncode({
        'message': message,
        'sessionID': ?sessionID,
      }),
    );
    if (res.statusCode != 200) throw GatewayException('sendEnriched: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    return (j['sessionID'] ?? '').toString();
  }

  // ── Memory ──

  Future<List<Map<String, dynamic>>> memorySearch(String query, {int topK = 20}) async {
    final res = await _get(
      _uri('/api/memory/search', {'query': query, 'topK': '$topK'}),
    );
    if (res.statusCode != 200) throw GatewayException('memorySearch: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    final list = j['results'] as List? ?? [];
    return list.map((e) => e as Map<String, dynamic>).toList();
  }

  Future<Map<String, dynamic>?> memoryEnergyDistribution() async {
    final res = await _get(_uri('/api/memory/energy-distribution'));
    if (res.statusCode != 200) return null;
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  // ── Projects / Work / Presence / Pod ──

  /// Registered gateway projects (`GET /api/projects` → `{projects:[{id, worktree}]}`).
  ///
  /// A project's `id` is its absolute directory — the `projectId` used in the
  /// `workOverview` / `podLookup` / `podEnsure` paths.
  Future<List<ProjectInfo>> projects() async {
    final res = await _get(_uri('/api/projects'));
    if (res.statusCode != 200) throw GatewayException('projects: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    final raw = j is Map<String, dynamic> ? j['projects'] : null;
    final out = <ProjectInfo>[];
    for (final item in raw is List ? raw : const <dynamic>[]) {
      if (item is! Map<String, dynamic>) continue;
      final info = ProjectInfo.fromJson(item);
      if (info.dir.isEmpty) continue;
      out.add(info);
    }
    return out;
  }

  /// Five-bucket project overview (`GET /api/projects/:projectId/work`).
  ///
  /// [projectDir] is percent-encoded: it is an absolute path and contains `:`
  /// and `\` on Windows.
  ///
  /// A 404 is split into two distinct, actionable failures (Task 4 minor):
  /// [NoPodException] when the gateway route exists and answers its designed
  /// `{"error":"pod not found"}` body, and [GatewayRouteMissingException] when a
  /// 404 carries no route payload — i.e. an **older gateway** that does not serve
  /// the route at all. Both are 404, so the body is the only honest signal.
  Future<WorkOverview> workOverview(String projectDir) async {
    final res = await _get(_uri('/api/projects/${Uri.encodeComponent(projectDir)}/work'));
    if (res.statusCode == 404) throw _notFound(res, operation: 'workOverview');
    if (res.statusCode != 200) throw GatewayException('workOverview: HTTP ${res.statusCode}');
    return WorkOverview.fromJson(jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>);
  }

  /// Classifies a 404 from a project-scoped route.
  ///
  /// The gateway's own routes answer 404 with `{"error":"pod not found"}`; a
  /// gateway without the route answers an empty/plain 404 (verified against a
  /// live gateway: unknown `/api/*` routes return 404 with an empty body).
  GatewayException _notFound(http.Response res, {required String operation}) {
    final body = utf8.decode(res.bodyBytes, allowMalformed: true).trim();
    if (body.toLowerCase().contains('pod')) {
      return NoPodException('$operation: no Pod for this project (HTTP 404)', errorBody: body);
    }
    return GatewayRouteMissingException(
      '$operation: HTTP 404 without a route payload — gateway is too old for this route',
      errorBody: body,
    );
  }

  /// Cross-project presence (`GET /api/presence`).
  Future<PresenceInfo> presence() async {
    final res = await _get(_uri('/api/presence'));
    if (res.statusCode != 200) throw GatewayException('presence: HTTP ${res.statusCode}');
    return PresenceInfo.fromJson(jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>);
  }

  /// Pod Goal rows (`GET /api/pods/:podId/goals` → `{items: PodGoalView[]}`).
  Future<List<PodGoalView>> listPodGoals(String podId) async {
    final res = await _get(_uri('/api/pods/${Uri.encodeComponent(podId)}/goals'));
    if (res.statusCode != 200) throw GatewayException('listPodGoals: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    final raw = j is Map<String, dynamic> ? j['items'] : null;
    final out = <PodGoalView>[];
    for (final item in raw is List ? raw : const <dynamic>[]) {
      if (item is Map<String, dynamic>) out.add(PodGoalView.fromJson(item));
    }
    return out;
  }

  /// Looks up the project Pod (`GET /api/projects/:projectId/pod/lookup`).
  ///
  /// Returns `null` **only** for the designed 404 (project has no Pod yet);
  /// every other failure throws so the caller can tell "no Pod" apart from
  /// "gateway is broken/old".
  Future<PodInfo?> podLookup(String projectDir) async {
    final res = await _get(_uri('/api/projects/${Uri.encodeComponent(projectDir)}/pod/lookup'));
    if (res.statusCode == 404) return null;
    if (res.statusCode != 200) throw GatewayException('podLookup: HTTP ${res.statusCode}');
    return PodInfo.fromJson(jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>);
  }

  /// Creates the project Pod if missing (`POST /api/projects/:projectId/pod`).
  ///
  /// The route answers the full Pod detail envelope (same shape as
  /// [podLookup]), so the caller gets the ids it needs for the next step
  /// (Task 11: the Goal composer needs `podId` without a second round trip).
  ///
  /// A 404 has two distinct meanings, and the body is the only honest signal:
  /// - no route payload (empty/plain body) → [GatewayRouteMissingException]
  ///   (gateway too old to create Pods);
  /// - the route's own `{"error":"project is not registered: ..."}` → a plain
  ///   [GatewayException] keeping the server body for display.
  Future<PodInfo> podEnsure(String projectDir) async {
    final res = await _post(_uri('/api/projects/${Uri.encodeComponent(projectDir)}/pod'));
    if (res.statusCode == 404) throw _ensureNotFound(res);
    if (res.statusCode != 200) throw _failure('podEnsure', res);
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    if (j is! Map<String, dynamic>) {
      throw GatewayException('podEnsure: unexpected payload (not a JSON object)');
    }
    return PodInfo.fromJson(j);
  }

  /// Classifies a 404 from `POST /api/projects/:projectId/pod`.
  ///
  /// Matches [_notFound]'s body heuristic: the real route always names the pod
  /// or the project in its error payload; an unknown `/api/*` route answers an
  /// empty (or non-JSON) 404 on the live gateway.
  GatewayException _ensureNotFound(http.Response res) {
    final body = utf8.decode(res.bodyBytes, allowMalformed: true).trim();
    final lower = body.toLowerCase();
    if (body.isNotEmpty && (lower.contains('pod') || lower.contains('project'))) {
      return GatewayException(
        'podEnsure: HTTP 404',
        statusCode: 404,
        errorBody: body,
      );
    }
    return GatewayRouteMissingException(
      'podEnsure: HTTP 404 without a route payload — gateway is too old to create Pods',
      errorBody: body,
    );
  }

  /// Ensures the project Lead session and returns its session id
  /// (`POST /api/pods/:podId/lead/ensure` → `{podId, projectDir, sessionId}`).
  Future<String> ensureLeadSessionId(String podId) async {
    final res = await _post(_uri('/api/pods/${Uri.encodeComponent(podId)}/lead/ensure'));
    if (res.statusCode != 200) {
      throw GatewayException('ensureLeadSessionId: HTTP ${res.statusCode}');
    }
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    final sessionId = j is Map<String, dynamic> ? (j['sessionId'] ?? '').toString() : '';
    if (sessionId.isEmpty) {
      throw GatewayException('ensureLeadSessionId: gateway returned no sessionId');
    }
    return sessionId;
  }

  // ── Goal detail: timeline / revisions / result / reject（Task 8）──

  /// Node-level execution trace (`GET /api/goals/:goalId/timeline`).
  ///
  /// A 404 is the gateway's designed `{"error":"goal state not found"}` — the
  /// Goal exists but has not started executing yet — surfaced as
  /// [GoalStateMissingException] so the page can show its empty state instead of
  /// a failure banner.
  Future<GoalTimeline> goalTimeline(String goalId) async {
    final res = await _get(_uri('/api/goals/${Uri.encodeComponent(goalId)}/timeline'));
    if (res.statusCode == 404) {
      throw GoalStateMissingException(
        'goalTimeline: no Goal state yet (HTTP 404)',
        errorBody: utf8.decode(res.bodyBytes, allowMalformed: true),
      );
    }
    if (res.statusCode != 200) {
      throw GatewayException(
        'goalTimeline: HTTP ${res.statusCode}',
        statusCode: res.statusCode,
        errorBody: utf8.decode(res.bodyBytes, allowMalformed: true),
      );
    }
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    if (j is! Map<String, dynamic>) {
      throw GatewayException('goalTimeline: unexpected payload (not a JSON object)');
    }
    return GoalTimeline.fromJson(j);
  }

  /// Revision history (`GET /api/pods/:podId/goals/:goalId/revisions`).
  Future<List<RevisionInfo>> goalRevisions(String podId, String goalId) async {
    final res = await _get(
      _uri('/api/pods/${Uri.encodeComponent(podId)}/goals/${Uri.encodeComponent(goalId)}/revisions'),
    );
    if (res.statusCode != 200) {
      throw GatewayException('goalRevisions: HTTP ${res.statusCode}');
    }
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    final raw = j is Map<String, dynamic> ? j['items'] : null;
    final out = <RevisionInfo>[];
    for (final item in raw is List ? raw : const <dynamic>[]) {
      if (item is Map<String, dynamic>) out.add(RevisionInfo.fromJson(item));
    }
    return out;
  }

  /// Goal result (`GET /api/pods/:podId/goals/:goalId/result`).
  ///
  /// Returns `null` for the designed 404 (`goal result not found`) — there is no
  /// state to build a result from. Every other failure throws.
  Future<GoalResultInfo?> goalResult(String podId, String goalId) async {
    final res = await _get(
      _uri('/api/pods/${Uri.encodeComponent(podId)}/goals/${Uri.encodeComponent(goalId)}/result'),
    );
    if (res.statusCode == 404) return null;
    if (res.statusCode != 200) {
      throw GatewayException('goalResult: HTTP ${res.statusCode}');
    }
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    if (j is! Map<String, dynamic>) {
      throw GatewayException('goalResult: unexpected payload (not a JSON object)');
    }
    return GoalResultInfo.fromJson(j);
  }

  /// Rejects the current revision and opens the next one
  /// (`POST /api/pods/:podId/goals/:goalId/reject {feedback}`).
  ///
  /// The gateway requires non-empty feedback (400 otherwise); the server message
  /// is kept in [GatewayException.errorBody] so the page can show it verbatim.
  Future<GoalRejectResult> rejectGoal(String podId, String goalId, String feedback) async {
    final res = await _post(
      _uri('/api/pods/${Uri.encodeComponent(podId)}/goals/${Uri.encodeComponent(goalId)}/reject'),
      body: jsonEncode({'feedback': feedback}),
    );
    if (res.statusCode != 200) {
      throw GatewayException(
        'rejectGoal: HTTP ${res.statusCode}',
        statusCode: res.statusCode,
        errorBody: utf8.decode(res.bodyBytes, allowMalformed: true),
      );
    }
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    if (j is! Map<String, dynamic>) {
      throw GatewayException('rejectGoal: unexpected payload (not a JSON object)');
    }
    return GoalRejectResult.fromJson(j);
  }

  // ── Plan approval（需要你形态一，Task 9）──

  /// Reads the pending PlanPackage (`GET /api/goals/:goalId/plan`).
  ///
  /// The route answers its designed 404 `{"error":"goal state not found"}` when
  /// the Goal has no execution state yet (still discussing/planning) — surfaced
  /// as [GoalStateMissingException] so the detail page hides the card instead of
  /// showing a failure.
  Future<GoalPlanInfo> goalPlan(String goalId) async {
    final res = await _get(_uri('/api/goals/${Uri.encodeComponent(goalId)}/plan'));
    if (res.statusCode == 404) {
      throw GoalStateMissingException(
        'goalPlan: no Goal state yet (HTTP 404)',
        errorBody: utf8.decode(res.bodyBytes, allowMalformed: true),
      );
    }
    if (res.statusCode != 200) {
      throw GatewayException(
        'goalPlan: HTTP ${res.statusCode}',
        statusCode: res.statusCode,
        errorBody: utf8.decode(res.bodyBytes, allowMalformed: true),
      );
    }
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    if (j is! Map<String, dynamic>) {
      throw GatewayException('goalPlan: unexpected payload (not a JSON object)');
    }
    return GoalPlanInfo.fromJson(j);
  }

  /// Approves or rejects the pending plan (`POST /api/goals/:goalId/plan-approval`).
  ///
  /// Body fields mirror `gateway/src/routes/goal-plan.ts`:
  /// `{approve, approvalId?, planHash?, evalHash?, feedback?}`. Empty strings are
  /// **omitted** on purpose:
  /// - `matchesApproval` requires `approvalId === undefined` for legacy approvals
  ///   without an id;
  /// - `assertApprovalFresh` treats `''` as a real expected hash and would report
  ///   a false `stale_plan`.
  ///
  /// Rejections must carry non-empty [planFeedback] (the server answers 400
  /// `reject requires feedback`); the card validates that locally.
  ///
  /// A 409 whose body says `code: "stale_plan"` throws [StalePlanException];
  /// every other 409 (not pending / wrong approvalId) stays a [GatewayException].
  Future<void> planApproval(
    String goalId, {
    required bool approve,
    required String approvalId,
    required String planHash,
    required String evalHash,
    String? planFeedback,
  }) async {
    final body = <String, dynamic>{
      'approve': approve,
      if (approvalId.isNotEmpty) 'approvalId': approvalId,
      if (planHash.isNotEmpty) 'planHash': planHash,
      if (evalHash.isNotEmpty) 'evalHash': evalHash,
      if (!approve && planFeedback != null && planFeedback.trim().isNotEmpty)
        'feedback': planFeedback.trim(),
    };
    final res = await _post(
      _uri('/api/goals/${Uri.encodeComponent(goalId)}/plan-approval'),
      body: jsonEncode(body),
    );
    if (res.statusCode == 200) return;

    final rawBody = utf8.decode(res.bodyBytes, allowMalformed: true);
    if (res.statusCode == 409) {
      final stale = _stalePlanException(rawBody);
      if (stale != null) throw stale;
    }
    throw GatewayException(
      'planApproval: HTTP ${res.statusCode}',
      statusCode: res.statusCode,
      errorBody: rawBody,
    );
  }

  /// Builds a [StalePlanException] only for the designed `code: "stale_plan"` body.
  StalePlanException? _stalePlanException(String body) {
    if (body.isEmpty) return null;
    try {
      final decoded = jsonDecode(body);
      if (decoded is! Map<String, dynamic>) return null;
      if (decoded['code'] != 'stale_plan') return null;
      return StalePlanException(
        (decoded['error'] ?? 'plan content changed').toString(),
        planHash: decoded['planHash']?.toString(),
        evalHash: decoded['evalHash']?.toString(),
        errorBody: body,
      );
    } catch (_) {
      return null;
    }
  }

  // ── Pod 协作面：创建讨论 Goal / Tech Lead / 方向 / 问答 / 事件（Task 10）──

  /// Failure with the server status + body preserved for the caller.
  ///
  /// New pod-collaboration endpoints keep the error body so the UI can show the
  /// server's own words (e.g. `objective or charter is required`,
  /// `revision 2 is terminal (completed)`) instead of a generic banner.
  GatewayException _failure(String operation, http.Response res) {
    return GatewayException(
      '$operation: HTTP ${res.statusCode}',
      statusCode: res.statusCode,
      errorBody: utf8.decode(res.bodyBytes, allowMalformed: true),
    );
  }

  String _podPath(String podId) => Uri.encodeComponent(podId);

  String _goalPath(String goalId) => Uri.encodeComponent(goalId);

  /// Creates a direct-discussion Goal (`POST /api/pods/:podId/goals`).
  ///
  /// Contract (`gateway/src/routes/pods.ts`):
  /// - `source` is a **required** whitelisted entry point; mobile always sends
  ///   `'mobile'` (an unknown value answers 400, and omitting it falls into the
  ///   legacy intake path).
  /// - The server requires `title` **and** `objective` (or `charter`); empty
  ///   values are omitted here so the server's 400 stays the single validator.
  /// - `status` is the **revision** status (`discussing`), not the Goal row status.
  /// - `sessionID: null` + `sessionError` means the Goal was created but its
  ///   Tech Lead session did not start — not a creation failure.
  Future<CreateGoalResult> createGoal(
    String podId, {
    required String title,
    String? objective,
    List<String>? acceptance,
  }) async {
    final objectiveText = (objective ?? '').trim();
    final acceptanceItems = <String>[
      for (final item in acceptance ?? const <String>[])
        if (item.trim().isNotEmpty) item.trim(),
    ];
    final body = <String, dynamic>{
      'title': title.trim(),
      if (objectiveText.isNotEmpty) 'objective': objectiveText,
      if (acceptanceItems.isNotEmpty) 'acceptance': acceptanceItems,
      'source': 'mobile',
    };
    final res = await _post(
      _uri('/api/pods/${_podPath(podId)}/goals'),
      body: jsonEncode(body),
    );
    if (res.statusCode != 200) throw _failure('createGoal', res);
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    if (j is! Map<String, dynamic>) {
      throw GatewayException('createGoal: unexpected payload (not a JSON object)');
    }
    return CreateGoalResult.fromJson(j);
  }

  /// Reads the hidden Tech Lead discussion (`GET .../goals/:goalId/tech-lead`).
  ///
  /// A **409** is the server's designed answer for a terminal revision
  /// (`pod-tech-lead-service.requireActiveRevision`), and a 200 with
  /// `sessionID: null` means no live lease. Both mean「讨论已归档」and are
  /// returned as [TechLeadHistory.archived] instead of throwing — the page then
  /// shows the read-only transcript. Every other failure throws.
  Future<TechLeadHistory> openTechLead(
    String podId,
    String goalId, {
    int limit = 50,
  }) async {
    final res = await _get(
      _uri(
        '/api/pods/${_podPath(podId)}/goals/${_goalPath(goalId)}/tech-lead',
        {'limit': '$limit'},
      ),
    );
    if (res.statusCode == 409) {
      return TechLeadHistory(
        goalId: goalId,
        revision: null,
        sessionID: null,
        messages: const <MafwMessage>[],
        sessionError: null,
      );
    }
    if (res.statusCode != 200) throw _failure('openTechLead', res);
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    if (j is! Map<String, dynamic>) {
      throw GatewayException('openTechLead: unexpected payload (not a JSON object)');
    }
    return TechLeadHistory.fromJson(j);
  }

  /// Sends one message to the Tech Lead discussion (`POST .../tech-lead/messages`).
  ///
  /// The server prepends the revision's ContextManifest and answers 400 for
  /// empty text; the message is sent verbatim (no local trimming) so the
  /// server stays the single validator.
  Future<void> sendTechLeadMessage(String podId, String goalId, String text) async {
    final res = await _post(
      _uri('/api/pods/${_podPath(podId)}/goals/${_goalPath(goalId)}/tech-lead/messages'),
      body: jsonEncode({'text': text}),
    );
    if (res.statusCode != 200) throw _failure('sendTechLeadMessage', res);
  }

  /// Writes the user's direction decision (`POST .../direction-decision`).
  ///
  /// Body mirrors `gateway/src/routes/pod-collaboration.ts`:
  /// `{mode: decided|clear|needs_user, optionId?, userWords?, reason?, revision?}`.
  /// Empty strings are omitted (`''` would still count as a present field);
  /// [userWords] is otherwise preserved verbatim — the gateway stores the user's
  /// own words and never rewrites them.
  Future<DirectionDecisionResult> directionDecision(
    String podId,
    String goalId, {
    required String mode,
    String? optionId,
    String? userWords,
    String? reason,
    int? revision,
  }) async {
    final option = (optionId ?? '').trim();
    final words = userWords ?? '';
    final why = (reason ?? '').trim();
    final body = <String, dynamic>{
      'mode': mode,
      if (option.isNotEmpty) 'optionId': option,
      if (words.trim().isNotEmpty) 'userWords': words,
      if (why.isNotEmpty) 'reason': why,
      'revision': ?revision,
    };
    final res = await _post(
      _uri('/api/pods/${_podPath(podId)}/goals/${_goalPath(goalId)}/direction-decision'),
      body: jsonEncode(body),
    );
    if (res.statusCode != 200) throw _failure('directionDecision', res);
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    if (j is! Map<String, dynamic>) {
      throw GatewayException('directionDecision: unexpected payload (not a JSON object)');
    }
    return DirectionDecisionResult.fromJson(j);
  }

  /// Answers or cancels a pending Goal question
  /// (`POST /api/goals/:goalId/questions/:questionId/respond`).
  ///
  /// Body mirrors `gateway/src/index.ts`: `{answer}` or `{type: 'cancel'}`.
  /// The route answers 404 for an unknown question and 409 when it is no longer
  /// pending (`{status, currentState}`) — both surface verbatim.
  Future<void> answerQuestion(
    String goalId,
    String questionId, {
    String? answer,
    bool cancel = false,
  }) async {
    final body = cancel
        ? <String, dynamic>{'type': 'cancel'}
        : <String, dynamic>{'answer': answer ?? ''};
    final res = await _post(
      _uri(
        '/api/goals/${_goalPath(goalId)}/questions/${Uri.encodeComponent(questionId)}/respond',
      ),
      body: jsonEncode(body),
    );
    if (res.statusCode != 200) throw _failure('answerQuestion', res);
  }

  /// Human-facing Pod events (`GET /api/pods/:podId/events?state=`).
  ///
  /// [state] is passed through verbatim: `'unread'` filters, anything else
  /// (e.g. `'all'`) means no filter on the gateway. An empty [state] omits the
  /// query parameter. Returns the `items` array; the aggregate `unread` counter
  /// is available from [presence] (`unreadResults`).
  Future<List<PodEventItem>> podEvents(String podId, {String state = 'unread'}) async {
    final res = await _get(
      _uri(
        '/api/pods/${_podPath(podId)}/events',
        state.isEmpty ? null : {'state': state},
      ),
    );
    if (res.statusCode != 200) throw _failure('podEvents', res);
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    final raw = j is Map<String, dynamic> ? j['items'] : null;
    final out = <PodEventItem>[];
    for (final item in raw is List ? raw : const <dynamic>[]) {
      if (item is Map<String, dynamic>) out.add(PodEventItem.fromJson(item));
    }
    return out;
  }

  /// Marks one Pod event as seen (`POST /api/pods/:podId/events/:id/seen`).
  Future<void> markPodEventSeen(String podId, String eventId) async {
    final res = await _post(
      _uri('/api/pods/${_podPath(podId)}/events/${Uri.encodeComponent(eventId)}/seen'),
    );
    if (res.statusCode != 200) throw _failure('markPodEventSeen', res);
  }

  /// Reads an archived session snapshot (`GET /api/pods/:podId/sessions/:sessionId/transcript`).
  ///
  /// The snapshot file shape is `{sessionID, messages}` (written by
  /// `PodService.snapshotSession`); the route answers `{transcript: null}` when
  /// no snapshot exists — that is「没有快照」and returns an empty list, never an
  /// error (the page says so honestly).
  Future<List<MafwMessage>> podTranscript(String podId, String sessionId) async {
    final res = await _get(
      _uri(
        '/api/pods/${_podPath(podId)}/sessions/${Uri.encodeComponent(sessionId)}/transcript',
      ),
    );
    if (res.statusCode != 200) throw _failure('podTranscript', res);
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    final snapshot = j is Map<String, dynamic> ? j['transcript'] : null;
    if (snapshot is! Map<String, dynamic>) return const <MafwMessage>[];
    final rawSession = snapshot['sessionID'];
    final fallbackSession =
        rawSession is String && rawSession.isNotEmpty ? rawSession : sessionId;
    final out = <MafwMessage>[];
    final raw = snapshot['messages'];
    for (final item in raw is List ? raw : const <dynamic>[]) {
      if (item is Map<String, dynamic>) {
        out.add(MafwMessage.fromJson(item, sessionID: fallbackSession));
      }
    }
    return out;
  }

  // ── Triage ──

  Future<List<Map<String, dynamic>>> listTriageItems() async {
    final res = await _get(_uri('/api/triage'));
    if (res.statusCode != 200) throw GatewayException('listTriageItems: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    final list = j['items'] as List? ?? [];
    return list.map((e) => e as Map<String, dynamic>).toList();
  }

  Future<Map<String, dynamic>> proposeTriageDecision(String triageId, {required bool accept}) async {
    final endpoint = accept ? 'confirm' : 'reject';
    final res = await _post(_uri('/api/triage/$triageId/$endpoint'));
    if (res.statusCode != 200) throw GatewayException('proposeTriageDecision: HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  // ── Media (mobile proxy) ──

  /// Upload a media file (image/video/audio) to the gateway and create an A2A task.
  /// Returns { id, contextId, state, artifactId }.
  Future<Map<String, dynamic>> uploadMediaTask(String filePath, {String? filename}) async {
    final file = await http.MultipartFile.fromPath('media', filePath, filename: filename);
    final uploadHeaders = Map<String, String>.from(_headers)..remove('Content-Type');
    final request = http.MultipartRequest('POST', _uri('/api/mobile/media/tasks'))
      ..headers.addAll(uploadHeaders)
      ..files.add(file);

    final started = DateTime.now();
    final path = _displayPath(request.url);
    http.Response body;
    try {
      final streamed = await request.send();
      body = await http.Response.fromStream(streamed);
    } catch (e) {
      diagnostics?.recordHttp(
        method: 'POST',
        path: path,
        durationMs: DateTime.now().difference(started).inMilliseconds,
        error: e.toString(),
      );
      rethrow;
    }

    diagnostics?.recordHttp(
      method: 'POST',
      path: path,
      status: body.statusCode,
      durationMs: DateTime.now().difference(started).inMilliseconds,
      errorBody: body.statusCode >= 400 ? body.body : null,
    );
    if (body.statusCode != 200) throw GatewayException('uploadMediaTask: HTTP ${body.statusCode}');
    return jsonDecode(body.body) as Map<String, dynamic>;
  }

  /// Send a follow-up question to an existing media task.
  /// Returns { answer, taskId }.
  Future<Map<String, dynamic>> askMediaTask(String taskId, String question) async {
    final res = await _post(
      _uri('/api/mobile/media/tasks/$taskId/ask'),
      body: jsonEncode({'question': question}),
    );
    if (res.statusCode != 200) throw GatewayException('askMediaTask: HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  // ── TTS ──

  Future<Map<String, dynamic>> ttsVoices() async {
    final res = await _get(_uri('/api/tts/voices'));
    if (res.statusCode != 200) throw GatewayException('ttsVoices: HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  /// Synthesize speech, returns { artifactId, voice, mime, url }.
  Future<Map<String, dynamic>> ttsSpeak(String text, {String? voice, String? style}) async {
    final res = await _post(
      _uri('/api/tts'),
      body: jsonEncode({
        'text': text,
        'voice': ?voice,
        'style': ?style,
      }),
    );
    if (res.statusCode != 200) throw GatewayException('ttsSpeak: HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  void dispose() => _http.close();
}

class GatewayException implements Exception {
  final String message;

  /// HTTP status when the failure came from a response (null for transport errors).
  final int? statusCode;

  /// Decoded (best-effort) error body, kept so callers can tell designed 404s
  /// apart from a missing route.
  final String? errorBody;

  GatewayException(this.message, {this.statusCode, this.errorBody});
  @override
  String toString() => message;
}

/// The project has no Pod yet — the gateway `/work` route exists and answered
/// its designed `404 {"error":"pod not found"}`.
///
/// Distinct from [GatewayRouteMissingException] so the UI can say「这个项目还没有
/// 鲸群」instead of「网关版本过旧」.
class NoPodException extends GatewayException {
  NoPodException(super.message, {super.statusCode = 404, super.errorBody});
}

/// A 404 that carries no gateway route payload: the gateway is too old to serve
/// the route (e.g. `/api/projects/:id/work` did not exist before v5).
class GatewayRouteMissingException extends GatewayException {
  GatewayRouteMissingException(super.message, {super.statusCode = 404, super.errorBody});
}

/// The Goal exists but has no execution state yet (`GET /api/goals/:id/timeline`
/// answered its designed 404 `{"error":"goal state not found"}`).
///
/// Distinct from [GatewayException] so the detail page shows「还没有执行记录」
/// (still discussing / planning) instead of a failure banner.
class GoalStateMissingException extends GatewayException {
  GoalStateMissingException(super.message, {super.statusCode = 404, super.errorBody});
}

/// The plan changed after the user opened it (`409 {"code":"stale_plan"}`).
///
/// The server refreshes the pending approval hashes in the same response, so the
/// UI must re-pull `GET /api/goals/:id/plan` and let the user approve the new
/// content — never silently retry with the old hashes.
class StalePlanException extends GatewayException {
  /// Current waves hash (server-side, after refresh).
  final String? planHash;

  /// Current Goal Eval hash (server-side, after refresh); null when no eval.
  final String? evalHash;

  StalePlanException(
    super.message, {
    this.planHash,
    this.evalHash,
    super.statusCode = 409,
    super.errorBody,
  });
}
