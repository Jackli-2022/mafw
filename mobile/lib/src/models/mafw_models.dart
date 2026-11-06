/// MAFW gateway data models (mirror of the gateway HTTP API shapes).
library;

class MafwSession {
  final String id;
  final String? title;
  final String? projectID;
  final String? directory;
  final String? parentID;
  final Map<String, dynamic>? metadata;
  final int? timeCreated;

  MafwSession({
    required this.id,
    this.title,
    this.projectID,
    this.directory,
    this.parentID,
    this.metadata,
    this.timeCreated,
  });

  factory MafwSession.fromJson(Map<String, dynamic> j) {
    final time = j['time'];
    return MafwSession(
      id: (j['id'] ?? '').toString(),
      title: j['title'] as String?,
      projectID: j['projectID'] as String?,
      directory: j['directory'] as String?,
      parentID: j['parentID'] as String?,
      metadata: j['metadata'] is Map<String, dynamic> ? j['metadata'] as Map<String, dynamic> : null,
      timeCreated: time is Map<String, dynamic> ? (time['created'] as num?)?.toInt() : null,
    );
  }

  bool get isManager => metadata?['mafw']?['role'] == 'manager';

  String get displayTitle {
    if (title != null && title!.isNotEmpty) return title!;
    return id.length > 12 ? id.substring(0, 12) : id;
  }
}

/// Flat MAFW View DTO message (canonical v3).
///
/// Shape: `{id, sessionID, role, parentID, content: MafwPart[], time:{created,...}}`.
/// Served by `GET /api/sessions/:id/messages`; the legacy
/// `{info, parts}` wire envelope is **not** accepted (no fallback).
/// Contract source: `packages/gateway-sdk/src/view-dto.ts`.
class MafwMessage {
  final String id;
  final String sessionID;
  final String role; // user | assistant
  final String? text;
  final String? parentID;
  final int timeCreated;
  final List<MafwPart> parts;

  MafwMessage({
    required this.id,
    required this.sessionID,
    required this.role,
    this.text,
    this.parentID,
    required this.timeCreated,
    this.parts = const [],
  });

  factory MafwMessage.fromJson(Map<String, dynamic> j, {required String sessionID}) {
    final rawParts = j['content'] is List ? j['content'] as List : const [];
    final parts = <MafwPart>[];
    for (final p in rawParts) {
      if (p is Map<String, dynamic>) parts.add(MafwPart.fromJson(p));
    }
    return MafwMessage(
      id: (j['id'] ?? '').toString(),
      sessionID: (j['sessionID'] as String?) ?? sessionID,
      role: (j['role'] ?? '').toString(),
      text: _firstText(j),
      parentID: j['parentID'] as String?,
      timeCreated: _time(j),
      parts: parts,
    );
  }

  static String? _firstText(Map<String, dynamic> j) {
    final t = j['text'];
    if (t is String && t.isNotEmpty) return t;
    final content = j['content'];
    if (content is List) {
      for (final p in content) {
        if (p is Map<String, dynamic> && p['type'] == 'text' && p['text'] is String) {
          return p['text'] as String;
        }
      }
    }
    return null;
  }

  static int _time(Map<String, dynamic> j) {
    final t = j['time'];
    if (t is Map<String, dynamic>) {
      final c = t['created'];
      if (c is num) return c.toInt();
    }
    return DateTime.now().millisecondsSinceEpoch;
  }
}

/// Flat MAFW View DTO part.
///
/// Tool parts carry neutral identity: `toolClass` (readonly/search/file-edit/
/// shell/subagent/web/plan/other) + `canonicalTool` (runtime-neutral name) +
/// `state {status, input, output, title, error}`.
class MafwPart {
  final String id;
  final String type; // text | reasoning | tool | file | step-start | ...
  final String? text;
  final String? tool; // runtime-native tool name
  final String? toolClass;
  final String? canonicalTool;
  final Map<String, dynamic>? state;

  MafwPart({
    required this.id,
    required this.type,
    this.text,
    this.tool,
    this.toolClass,
    this.canonicalTool,
    this.state,
  });

  factory MafwPart.fromJson(Map<String, dynamic> j) {
    return MafwPart(
      id: (j['id'] ?? '').toString(),
      type: (j['type'] ?? 'text').toString(),
      text: j['text'] as String?,
      tool: j['tool'] as String?,
      toolClass: j['toolClass'] as String?,
      canonicalTool: j['canonicalTool'] as String?,
      state: j['state'] is Map<String, dynamic> ? j['state'] as Map<String, dynamic> : null,
    );
  }

  bool get isTool => type == 'tool';
  bool get isReasoning => type == 'reasoning';

  /// Runtime-neutral tool name (`canonicalTool` preferred, native name fallback).
  String get displayTool => canonicalTool ?? tool ?? '';

  String get toolStatus => state?['status'] as String? ?? '';
  String get toolTitle => state?['title'] as String? ?? displayTool;
  String get toolOutput => state?['output'] as String? ?? '';
}

/// Canonical event envelope name (gateway `mafw_event`).
const String kMafwEventEnvelope = 'mafw_event';

/// Canonical inner event names owned by MAFW.
///
/// Golden mirror of `packages/gateway-sdk/src/events.ts` `RUNTIME_EVENT_TYPES`
/// (the single source of truth). **Set and order are pinned** by
/// `test/vocabulary_parity_test.dart`, which parses that file — do not reorder
/// or hand-add entries without updating the contract.
///
/// Legacy names (`opencode_event`, `message.part.*`, `session.idle`,
/// `message.complete`, `message.error`) are intentionally absent — they are not
/// translated. `plugin:<name>:<event>` namespaced events are valid per the
/// contract (see [canonicalEventTypeOf]) but carry no mobile consumer.
const Set<String> kMafwCanonicalEventTypes = {
  // 会话生命周期
  'session.created',
  'session.updated',
  'session.deleted',
  // 回合生命周期
  'turn.started',
  'turn.completed',
  'turn.failed',
  'turn.aborted',
  // 压缩
  'session.compacting',
  'session.compacted',
  // 消息 / part 流
  'message.updated',
  'part.updated',
  'part.delta',
  'part.complete',
  // 问答 / 审批
  'question.asked',
  'question.replied',
  'question.rejected',
  'permission.asked',
  'permission.replied',
  // 数据面
  'plan.updated',
  'usage.updated',
  'queue.updated',
  'task.updated',
  'background.job.updated',
  'pod.updated',
  'pod.event',
  'session.config',
  'session.checkpoint',
  'run.updated',
  'session.commands',
  'trajectory.event',
  'trajectory.turn',
  'permission_mode',
  'session.diff',
};

/// Resolve an envelope inner `data.type` to a canonical name, or `''`.
///
/// Valid inputs mirror the gateway contract union
/// (`RuntimeEventType | plugin:${string}`). Anything else — including legacy
/// `message.part.*` / `session.idle` names — resolves to `''` (ignored).
String canonicalEventTypeOf(String rawType) {
  if (rawType.isEmpty) return '';
  if (kMafwCanonicalEventTypes.contains(rawType)) return rawType;
  if (rawType.startsWith('plugin:')) return rawType;
  return '';
}

/// Top-level flat broadcast names (`packages/gateway-sdk/src/events.ts`
/// `FLAT_EVENT_TYPES`; gateway-side emitters live in
/// `gateway/src/runtime/flat-emit-registry.ts`).
///
/// Flat frames are **not** `mafw_event` envelopes: they keep their own `type`,
/// `innerType` stays empty, and the payload fields sit at the top level of the
/// frame. **Set and order are pinned** by `test/vocabulary_parity_test.dart`,
/// which parses the TS contract — do not reorder or hand-add entries there.
const Set<String> kMafwFlatEventTypes = {
  'user_question',
  'user_feedback',
  'goal_created',
  'state_change',
  'phase_transition',
  'memory_written',
  'memory_energy_changed',
  'memory_distillation_complete',
  'automation_triggered',
  'automation_completed',
  'project_registered',
  'runtime_switched',
  'mafw_commands_changed',
  'goal_node',
  'plugins.changed',
  'connected',
};

/// WS/SSE event frame.
///
/// Canonical frames are envelopes:
/// `{type:'mafw_event', data:{type, properties?, sessionID?, directory?}}`.
/// Flat top-level broadcasts (e.g. `goal_created`) keep their own `type` and are
/// **not** canonical envelopes (`innerType == ''`); their payload fields are
/// readable through [goalId] / [loop] / [node] / [revision] / [transition] /
/// [phase] / [verdict] / [error] / [attempt]. Legacy `opencode_event` frames are
/// likewise not unpacked.
class MafwEvent {
  /// Frame type as received (`mafw_event` for canonical envelopes, the
  /// broadcast name for flat frames).
  final String type;

  /// Canonical inner event name; empty when this frame is not a canonical envelope.
  final String innerType;

  /// Wire payload: the envelope's `data` for canonical frames, the whole frame
  /// for flat broadcasts (empty for canonical envelopes and unknown frames).
  final Map<String, dynamic> data;

  /// Envelope `data.properties`.
  final Map<String, dynamic>? properties;

  /// `data.sessionID`, falling back to the canonical `properties.message.sessionID`.
  final String? sessionID;

  MafwEvent({
    required this.type,
    this.innerType = '',
    this.data = const {},
    this.properties,
    this.sessionID,
  });

  bool get isCanonical => innerType.isNotEmpty;

  /// Whether this frame is a registered top-level flat broadcast
  /// ([kMafwFlatEventTypes]) rather than a canonical envelope.
  bool get isFlatBroadcast => kMafwFlatEventTypes.contains(type);

  String? get directory {
    final value = data['directory'];
    return value is String ? value : null;
  }

  /// Canonical `message.updated` payload: `properties.message` (flat MafwMessage).
  Map<String, dynamic>? get message {
    final m = properties?['message'];
    return m is Map<String, dynamic> ? m : null;
  }

  String? get messageID => message?['id'] as String?;

  // --- Flat broadcast payload ------------------------------------------------
  //
  // Flat fields are only read from registered flat frames: canonical envelopes
  // keep their own accessors (`message`, `sessionID`, …) and must not pick up
  // unrelated top-level keys.

  String? _flatString(String key) {
    if (!isFlatBroadcast) return null;
    final value = data[key];
    if (value is! String || value.isEmpty) return null;
    return value;
  }

  int? _flatInt(String key) {
    if (!isFlatBroadcast) return null;
    final value = data[key];
    return value is num ? value.toInt() : null;
  }

  /// Owning goal id (`goal_node` / `phase_transition` / `state_change` /
  /// `user_question`).
  String? get goalId => _flatString('goalId');

  /// Goal loop index (`goal_node` / `phase_transition`).
  int? get loop => _flatInt('loop');

  /// Goal revision the node belongs to (a rejected result re-enters as rev 2+).
  int? get revision => _flatInt('revision');

  /// Goal node name (`plan` / `execute` / `review` / `probe`).
  String? get node => _flatString('node');

  /// Node transition (`started` / `completed` / `failed`) from `goal_node`.
  String? get transition => _flatString('transition');

  /// Goal phase name from `phase_transition` (e.g. `EXECUTING`).
  String? get phase => _flatString('phase');

  /// Verdict on a terminal `goal_node` (e.g. `PASS` / `FAIL`).
  String? get verdict => _flatString('verdict');

  /// Failure message on a `goal_node.failed` frame.
  String? get error => _flatString('error');

  /// 1-based attempt number (watchdog retries increment it).
  int? get attempt => _flatInt('attempt');

  factory MafwEvent.fromJson(Map<String, dynamic> j) {
    final type = (j['type'] ?? '').toString();
    final rawData = j['data'];
    final data = rawData is Map<String, dynamic> ? rawData : const <String, dynamic>{};
    if (type != kMafwEventEnvelope) {
      // Flat broadcast: keep the frame itself so its top-level payload fields
      // stay readable; `innerType` remains empty (not a canonical envelope).
      return MafwEvent(
        type: type,
        data: kMafwFlatEventTypes.contains(type) ? j : const <String, dynamic>{},
      );
    }

    final rawInner = (data['type'] ?? '').toString();
    final inner = canonicalEventTypeOf(rawInner);
    final rawProps = data['properties'];
    final properties = rawProps is Map<String, dynamic> ? rawProps : null;
    final message = properties?['message'];

    return MafwEvent(
      type: type,
      innerType: inner,
      data: data,
      properties: properties,
      sessionID: (data['sessionID'] as String?) ??
          (message is Map<String, dynamic> ? message['sessionID'] as String? : null),
    );
  }
}
