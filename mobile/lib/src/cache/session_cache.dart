/// In-memory + persistent session message cache with TTL and size limit.
///
/// Uses hive_ce for fast key-value storage. Messages older than [ttl]
/// are evicted on access. Per-session limit is [limitPerSession].
library;

import 'package:hive_ce/hive.dart';

class CachedMessage {
  final String id;
  final String sessionID;
  final String role;
  final String? text;
  final int timeCreated;
  final int cachedAt;

  CachedMessage({
    required this.id,
    required this.sessionID,
    required this.role,
    this.text,
    required this.timeCreated,
    int? cachedAt,
  }) : cachedAt = cachedAt ?? DateTime.now().millisecondsSinceEpoch;

  Map<String, dynamic> toMap() => {
        'id': id,
        'sessionID': sessionID,
        'role': role,
        'text': text,
        'timeCreated': timeCreated,
        'cachedAt': cachedAt,
      };

  factory CachedMessage.fromMap(Map<String, dynamic> m) => CachedMessage(
        id: m['id'] as String,
        sessionID: m['sessionID'] as String,
        role: m['role'] as String,
        text: m['text'] as String?,
        timeCreated: m['timeCreated'] as int,
        cachedAt: m['cachedAt'] as int?,
      );
}

class SessionCache {
  static const String _boxName = 'session_messages';
  static const int defaultLimitPerSession = 50;

  final Duration ttl;
  final int limitPerSession;
  Box<dynamic>? _box;
  bool _initialized = false;

  SessionCache({
    this.ttl = const Duration(hours: 24),
    this.limitPerSession = defaultLimitPerSession,
  });

  Future<void> init() async {
    if (_initialized) return;
    _box = await Hive.openBox<dynamic>(_boxName);
    _initialized = true;
  }

  Box<dynamic> get _ensureBox {
    if (_box == null) throw StateError('SessionCache not initialized. Call init() first.');
    return _box!;
  }

  /// Store a message. Evicts oldest if per-session limit exceeded.
  Future<void> put(CachedMessage message) async {
    final box = _ensureBox;
    box.put(message.id, message.toMap());

    // Enforce per-session limit
    final sessionMsgs = _getBySessionRaw(message.sessionID);
    if (sessionMsgs.length > limitPerSession) {
      // Sort by timeCreated ascending, remove oldest
      sessionMsgs.sort((a, b) => (a['timeCreated'] as int).compareTo(b['timeCreated'] as int));
      final toRemove = sessionMsgs.length - limitPerSession;
      for (var i = 0; i < toRemove; i++) {
        box.delete(sessionMsgs[i]['id']);
      }
    }
  }

  /// Get a message by ID. Returns null if expired or missing.
  CachedMessage? get(String id) {
    final raw = _ensureBox.get(id);
    if (raw == null) return null;
    final msg = CachedMessage.fromMap(raw);
    if (_isExpired(msg)) {
      _ensureBox.delete(id);
      return null;
    }
    return msg;
  }

  /// Get all messages for a session, sorted by timeCreated ascending.
  List<CachedMessage> getBySession(String sessionID) {
    final raw = _getBySessionRaw(sessionID);
    final now = DateTime.now().millisecondsSinceEpoch;
    final ttlMs = ttl.inMilliseconds;

    return raw
        .where((m) => now - (m['cachedAt'] as int) < ttlMs)
        .map((m) => CachedMessage.fromMap(m))
        .toList()
      ..sort((a, b) => a.timeCreated.compareTo(b.timeCreated));
  }

  void remove(String id) {
    _ensureBox.delete(id);
  }

  void clearSession(String sessionID) {
    final box = _ensureBox;
    final keys = box.keys.where((k) {
      final raw = box.get(k);
      return raw != null && raw['sessionID'] == sessionID;
    }).toList();
    box.deleteAll(keys);
  }

  void clear() {
    _ensureBox.clear();
  }

  int get size => _ensureBox.length;

  Future<void> dispose() async {
    await _box?.close();
    _box = null;
    _initialized = false;
  }

  // ── Private ──

  List<Map<String, dynamic>> _getBySessionRaw(String sessionID) {
    final box = _ensureBox;
    // snapshot values to avoid concurrent-delete mutation during eviction
    final snapshot = box.values.toList();
    return snapshot
        .where((m) => (m as Map)['sessionID'] == sessionID)
        .map((m) => Map<String, dynamic>.from(m as Map))
        .toList();
  }

  bool _isExpired(CachedMessage msg) {
    return DateTime.now().millisecondsSinceEpoch - msg.cachedAt >= ttl.inMilliseconds;
  }
}
