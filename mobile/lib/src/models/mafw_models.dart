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

class MafwMessage {
  final String id;
  final String sessionID;
  final String role; // user | assistant | toolResult
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

  factory MafwMessage.fromJson(Map<String, dynamic> info, {required String sessionID}) {
    final rawParts = info['parts'] as List? ?? const [];
    return MafwMessage(
      id: (info['id'] ?? '').toString(),
      sessionID: sessionID,
      role: (info['role'] ?? '').toString(),
      text: _firstText(info),
      parentID: info['parentID'] as String?,
      timeCreated: _time(info),
      parts: rawParts.map((p) => MafwPart.fromJson(p)).toList(),
    );
  }

  static String? _firstText(Map<String, dynamic> info) {
    final t = info['text'];
    if (t is String && t.isNotEmpty) return t;
    final parts = info['parts'] as List?;
    if (parts != null) {
      for (final p in parts) {
        if (p is Map<String, dynamic> && p['type'] == 'text' && p['text'] is String) {
          return p['text'] as String;
        }
      }
    }
    return null;
  }

  static int _time(Map<String, dynamic> info) {
    final t = info['time'];
    if (t is Map<String, dynamic>) {
      final c = t['created'];
      if (c is num) return c.toInt();
    }
    return DateTime.now().millisecondsSinceEpoch;
  }
}

class MafwPart {
  final String id;
  final String type; // text | reasoning | tool | file | step-start | ...
  final String? text;
  final String? tool;
  final Map<String, dynamic>? state;

  MafwPart({required this.id, required this.type, this.text, this.tool, this.state});

  factory MafwPart.fromJson(Map<String, dynamic> j) {
    return MafwPart(
      id: (j['id'] ?? '').toString(),
      type: (j['type'] ?? 'text').toString(),
      text: j['text'] as String?,
      tool: j['tool'] as String?,
      state: j['state'] is Map<String, dynamic> ? j['state'] as Map<String, dynamic> : null,
    );
  }

  bool get isTool => type == 'tool';
  bool get isReasoning => type == 'reasoning';
  String get toolTitle => state?['title'] as String? ?? tool ?? '';
  String get toolOutput => state?['output'] as String? ?? '';
}

/// WS/SSE event (opencode_event wrapper or direct type).
class MafwEvent {
  final String type;
  final Map<String, dynamic> data;
  final Map<String, dynamic>? properties;
  final String? sessionID;

  MafwEvent({required this.type, this.data = const {}, this.properties, this.sessionID});

  /// 内层事件类型：网关帧为 `{type:'opencode_event', data:{type:'message.part.delta', properties, sessionID}}`，
  /// 真正的 subtype（message.part.delta / message.complete / session.idle 等）在 data.type 里。
  String get innerType {
    final inner = data['data'];
    if (inner is Map<String, dynamic>) {
      final t = inner['type'];
      if (t is String && t.isNotEmpty) return t;
    }
    final direct = data['type'];
    if (direct is String && direct != 'opencode_event') return direct;
    return '';
  }

  factory MafwEvent.fromJson(Map<String, dynamic> j) {
    final data = j['data'];
    Map<String, dynamic>? inner;
    if (data is Map<String, dynamic>) inner = data;
    return MafwEvent(
      type: (j['type'] ?? '').toString(),
      data: j,
      properties: inner?['properties'] is Map<String, dynamic>
          ? inner!['properties'] as Map<String, dynamic>
          : (j['properties'] is Map<String, dynamic> ? j['properties'] as Map<String, dynamic> : null),
      sessionID: inner?['sessionID'] as String? ?? j['sessionID'] as String?,
    );
  }
}
