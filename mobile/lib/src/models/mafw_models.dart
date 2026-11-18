/// MAFW gateway data models (mirror of the gateway HTTP API shapes).
library;

class MafwSession {
  final String id;
  final String? title;
  final String? projectID;
  final String? directory;
  final String? parentID;

  /// Agent name persisted on the session (`memory-curator`, `mafw-tech-lead`, …).
  ///
  /// Only used for visibility (`isHiddenSessionRow`): internal agent sessions are
  /// filtered out of `/api/sessions`, and the incremental `session.created` path
  /// needs the same predicate to reach the same state.
  final String? agent;

  final Map<String, dynamic>? metadata;
  final int? timeCreated;

  /// `time.updated` (ms) — the last-activity timestamp.
  ///
  /// The chat list sorts by this when present and falls back to [timeCreated]
  /// for legacy rows: a session that just received a turn must bubble up even
  /// though it was created long ago.
  final int? timeUpdated;

  MafwSession({
    required this.id,
    this.title,
    this.projectID,
    this.directory,
    this.parentID,
    this.agent,
    this.metadata,
    this.timeCreated,
    this.timeUpdated,
  });

  /// Strings only: a malformed field (`title: 42`) is dropped, not thrown.
  ///
  /// The live `session.created` path parses arbitrary broadcast payloads, and one
  /// bad key must not take the session list down.
  static String? _stringField(dynamic value) => value is String ? value : null;

  factory MafwSession.fromJson(Map<String, dynamic> j) {
    final time = j['time'];
    final created = time is Map<String, dynamic> ? time['created'] : null;
    final updated = time is Map<String, dynamic> ? time['updated'] : null;
    return MafwSession(
      id: (j['id'] ?? '').toString(),
      title: _stringField(j['title']),
      projectID: _stringField(j['projectID']),
      directory: _stringField(j['directory']),
      parentID: _stringField(j['parentID']),
      agent: _stringField(j['agent']),
      metadata: j['metadata'] is Map<String, dynamic> ? j['metadata'] as Map<String, dynamic> : null,
      timeCreated: created is num ? created.toInt() : null,
      timeUpdated: updated is num ? updated.toInt() : null,
    );
  }

  /// Copy with only the supplied fields replaced.
  ///
  /// The id is the row identity and can never change. A `null` argument means
  /// "not in this patch" (the same convention as the live `session.updated`
  /// payload, whose absent fields must not clear the row) — not "clear it".
  /// `parentID` is carried over untouched unless explicitly supplied.
  MafwSession copyWith({
    String? title,
    String? projectID,
    String? directory,
    String? parentID,
    String? agent,
    Map<String, dynamic>? metadata,
    int? timeCreated,
    int? timeUpdated,
  }) {
    return MafwSession(
      id: id,
      title: title ?? this.title,
      projectID: projectID ?? this.projectID,
      directory: directory ?? this.directory,
      parentID: parentID ?? this.parentID,
      agent: agent ?? this.agent,
      metadata: metadata ?? this.metadata,
      timeCreated: timeCreated ?? this.timeCreated,
      timeUpdated: timeUpdated ?? this.timeUpdated,
    );
  }

  /// Lead 会话（`metadata.mafw.role`）。
  ///
  /// 2026-11-03 起 Lead 取代 Manager 成为项目协调身份，新写入一律是 `lead`；
  /// 旧数据里的 `manager` 仍识别为 Lead，让历史行沿用同一枚徽标（兼容层，
  /// 不再产生新的 `manager` 行）。
  bool get isLead {
    final role = metadata?['mafw']?['role'];
    return role == 'lead' || role == 'manager';
  }

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

  /// 展示用全文：拼接**全部非 synthetic** 的 text part（换行连接）。
  ///
  /// 一个 assistant 回合的真实形状是 `text → tool → text`：结论在工具调用
  /// **之后**，而 [text] 只取首个 text part（DTO 便捷字段，契约不变）。气泡 /
  /// 复制 / 朗读 / 缓存必须用这个 getter，否则工具调用后的结论整段消失。
  ///
  /// parts 没有可用文本时回退 [text]（缓存快照、纯文本消息）；空白片段跳过。
  /// 每轮注入的隐藏上下文（`<latest-reminder>` / `<client-channel>` /
  /// `<facts>` 等）在历史文本里可能已拼进正文，展示前剥离。
  String get displayText {
    final pieces = <String>[];
    for (final part in parts) {
      if (part.type != 'text' || part.synthetic) continue;
      final value = part.text;
      if (value == null || value.isEmpty) continue;
      final cleaned = _stripInjectedBlocks(value);
      if (cleaned.trim().isEmpty) continue;
      pieces.add(cleaned);
    }
    if (pieces.isEmpty) return _stripInjectedBlocks(text ?? '').trim();
    return pieces.join('\n');
  }
}

final RegExp _injectedBlockPattern = RegExp(
  r'<(latest-reminder|client-channel|facts|deltas|patterns|history)>[\s\S]*?</\1>\s*',
  caseSensitive: false,
);

String _stripInjectedBlocks(String value) =>
    value.replaceAll(_injectedBlockPattern, '');

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

  /// 非用户输入产生的文本（注入 / 系统提示回显）；展示时跳过。
  final bool synthetic;

  MafwPart({
    required this.id,
    required this.type,
    this.text,
    this.tool,
    this.toolClass,
    this.canonicalTool,
    this.state,
    this.synthetic = false,
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
      synthetic: j['synthetic'] == true,
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
///
/// E9-1: [kMafwDualShapeEventTypes] is appended after the contract entries —
/// those three names are emitted as top-level flat frames by the gateway even
/// though the TS contract lists them as canonical (`RUNTIME_EVENT_TYPES`).
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
  ...kMafwDualShapeEventTypes,
};

/// Event names that travel in **both** shapes (E9-1).
///
/// `pod.updated` / `pod.event` / `run.updated` are canonical names
/// (`RUNTIME_EVENT_TYPES`) that the gateway also broadcasts as flat frames
/// (`broadcast({type, properties})` in `gateway/src/kernel.ts` and
/// `pod-service.ts`) because the desktop / mobile shells read them top-level.
/// Both shapes must parse: flat frames keep their payload for [MafwEvent.goalId]
/// and work-tab refreshes, canonical envelopes still resolve their inner type.
///
/// Every member must also be in [kMafwCanonicalEventTypes]; the parity test in
/// `test/vocabulary_parity_test.dart` pins that.
const Set<String> kMafwDualShapeEventTypes = {
  'pod.updated',
  'pod.event',
  'run.updated',
};

/// WS greeting frame type (always flat, carries `headSeq` / `instanceId`).
const String kMafwGreetingType = 'connected';

/// WS/SSE event frame.
///
/// Canonical frames are envelopes:
/// `{type:'mafw_event', data:{type, properties?, sessionID?, directory?}}`.
/// Flat top-level broadcasts (e.g. `goal_created`) keep their own `type` and are
/// **not** canonical envelopes (`innerType == ''`); their payload fields are
/// readable through [goalId] / [loop] / [node] / [revision] / [transition] /
/// [phase] / [verdict] / [error] / [attempt]. [goalId] / [podId] also read the
/// frame's nested `properties` map, so the dual-shape pod/run broadcasts
/// (E9-1, `{type, properties:{goalId, podId}}`) resolve. Legacy
/// `opencode_event` frames are likewise not unpacked.
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

  /// Monotonic gateway event seq (SSE `id:` / WS top-level `seq` / canonical
  /// `data.seq` / replay column `seq`). Null for transient frames such as
  /// `message.part.delta`, which are never persisted and must not advance a
  /// replay cursor.
  final int? seq;

  /// True when this frame was replayed from the event log rather than received
  /// live. Recovered frames may refresh content, but must not drive a live
  /// turn's phase / sending state (E5b review F2).
  final bool recovered;

  MafwEvent({
    required this.type,
    this.innerType = '',
    this.data = const {},
    this.properties,
    this.sessionID,
    this.seq,
    this.recovered = false,
  });

  /// Mark this frame as replay-recovered without changing its wire identity.
  MafwEvent asRecovered() => MafwEvent(
        type: type,
        innerType: innerType,
        data: data,
        properties: properties,
        sessionID: sessionID,
        seq: seq,
        recovered: true,
      );

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

  /// The payload map of this frame, whatever its shape.
  ///
  /// Canonical envelopes carry it as `data.properties`; flat broadcasts nest the
  /// same map under the frame's own `properties` key (they have no `data`).
  Map<String, dynamic>? get _payload {
    final nested = data['properties'];
    if (nested is Map<String, dynamic>) return nested;
    return properties;
  }

  /// First non-empty string for [key] in the payload map, then at the top level.
  ///
  /// Flat goal frames put `goalId` at the top level (`goal_node`); the E9-1
  /// pod/run broadcasts put it in `properties`. Reading both keeps a single
  /// accessor valid for canonical and flat frames alike.
  String? _payloadString(String key) {
    final value = _payload?[key];
    if (value is String && value.isNotEmpty) return value;
    final top = data[key];
    if (top is String && top.isNotEmpty) return top;
    return null;
  }

  /// Owning goal id.
  ///
  /// `properties.goalId` (canonical envelopes and flat `pod.updated` /
  /// `pod.event` / `run.updated` frames) falls back to the flat top-level
  /// `goalId` (`goal_node` / `phase_transition` / `state_change` /
  /// `user_question`).
  String? get goalId => _payloadString('goalId');

  /// Owning Pod id (flat `pod.updated` / `pod.event` carry `properties.podId`).
  String? get podId => _payloadString('podId');

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

  /// Gateway event seq as carried by the `connected` greeting (`data.headSeq`).
  ///
  /// Only the greeting carries it: canonical envelopes keep their own `data`
  /// map and must not surface unrelated top-level keys.
  int? get headSeq {
    if (type != kMafwGreetingType) return null;
    final value = data['headSeq'];
    return value is num ? value.toInt() : null;
  }

  /// Gateway instance id (event-log epoch) from the `connected` greeting.
  ///
  /// Persisted next to the replay cursor: a different instance means a new event
  /// log, so a stale cursor is discarded instead of reset-looping.
  String? get instanceId {
    if (type != kMafwGreetingType) return null;
    final value = data['instanceId'];
    return value is String && value.isNotEmpty ? value : null;
  }

  /// Top-level `seq` wins; canonical envelopes may instead carry it in
  /// `data.seq`. Flat broadcasts keep the frame as [data], so both paths are
  /// the same map for them.
  static int? _seqOf(Map<String, dynamic> frame, Map<String, dynamic> data) {
    final top = frame['seq'];
    if (top is num) return top.toInt();
    final inner = data['seq'];
    if (inner is num) return inner.toInt();
    return null;
  }

  factory MafwEvent.fromJson(Map<String, dynamic> j) {
    final type = (j['type'] ?? '').toString();
    final rawData = j['data'];
    final data = rawData is Map<String, dynamic> ? rawData : const <String, dynamic>{};
    final seq = _seqOf(j, data);
    if (type != kMafwEventEnvelope) {
      // Flat broadcast: keep the frame itself so its top-level payload fields
      // stay readable; `innerType` remains empty (not a canonical envelope).
      return MafwEvent(
        type: type,
        data: kMafwFlatEventTypes.contains(type) ? j : const <String, dynamic>{},
        seq: seq,
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
      seq: seq,
    );
  }
}

/// One `GET /api/events/replay` page (E5b).
///
/// Wire shape: `gateway/src/routes/events-replay.ts` —
/// `{events:[{seq, ts, type, sessionId, envelope}], headSeq, oldestSeq, hasMore,
/// nextSince, reset, truncated}`. `reset` / `truncated` mean the client must
/// fall back to a full reload; `nextSince` is the loop cursor for `hasMore`.
class EventReplayPage {
  final List<MafwEvent> events;
  final int headSeq;
  final int oldestSeq;
  final bool hasMore;
  final int nextSince;
  final bool reset;
  final bool truncated;

  const EventReplayPage({
    required this.events,
    required this.headSeq,
    this.oldestSeq = 0,
    required this.hasMore,
    required this.nextSince,
    this.reset = false,
    this.truncated = false,
  });

  factory EventReplayPage.fromJson(Map<String, dynamic> j) {
    final rawEvents = j['events'];
    final events = <MafwEvent>[];
    if (rawEvents is List) {
      for (final raw in rawEvents) {
        if (raw is! Map<String, dynamic>) continue;
        final rawEnvelope = raw['envelope'];
        final frame = <String, dynamic>{
          if (rawEnvelope is Map<String, dynamic>) ...rawEnvelope,
        };
        // Column projections win: replay items always carry their cursor even
        // when the stored envelope predates `seq` (flat broadcasts).
        final seq = raw['seq'];
        if (seq is num) frame['seq'] = seq.toInt();
        final ts = raw['ts'];
        if (ts is String) frame['timestamp'] = ts;
        if (!frame.containsKey('type') && raw['type'] is String) {
          frame['type'] = raw['type'];
        }
        events.add(MafwEvent.fromJson(frame));
      }
    }
    return EventReplayPage(
      events: events,
      headSeq: _intOf(j['headSeq']),
      oldestSeq: _intOf(j['oldestSeq']),
      hasMore: j['hasMore'] == true,
      nextSince: _intOf(j['nextSince']),
      reset: j['reset'] == true,
      truncated: j['truncated'] == true,
    );
  }

  static int _intOf(Object? value) => value is num ? value.toInt() : 0;
}
