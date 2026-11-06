/// Minimal HTTP client for the MAFW gateway API.
///
/// This is a simplified version of the GatewayClient for testing purposes.
library;

import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/connection_config.dart';
import '../models/mafw_models.dart';
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

  // ── Goals ──

  Future<List<Map<String, dynamic>>> listGoals() async {
    final res = await _get(_uri('/api/goals'));
    if (res.statusCode != 200) throw GatewayException('listGoals: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    final list = j['goals'] as List? ?? [];
    return list.map((e) => e as Map<String, dynamic>).toList();
  }

  Future<Map<String, dynamic>?> getGoal(String goalId) async {
    final res = await _get(_uri('/api/goals/$goalId'));
    if (res.statusCode != 200) return null;
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
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
  GatewayException(this.message);
  @override
  String toString() => message;
}
