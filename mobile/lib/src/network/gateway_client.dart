/// HTTP client for the MAFW gateway API.
library;

import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/connection_config.dart';
import '../models/mafw_models.dart';

class GatewayClient {
  final ConnectionConfig config;
  final http.Client _http = http.Client();

  GatewayClient(this.config);

  Uri _uri(String path, [Map<String, String>? query]) {
    var u = Uri.parse('${config.normalizedBaseUrl}$path');
    if (query != null && query.isNotEmpty) {
      u = u.replace(queryParameters: query);
    }
    return u;
  }

  Map<String, String> get _headers => config.headers;

  // ── Health ──

  Future<bool> health() async {
    try {
      final res = await _http.get(_uri('/health'), headers: _headers).timeout(const Duration(seconds: 5));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // ── Sessions ──

  Future<List<MafwSession>> listSessions({String? projectID}) async {
    final res = await _http.get(
      _uri('/api/sessions', projectID != null ? {'projectID': projectID} : null),
      headers: _headers,
    );
    if (res.statusCode != 200) throw GatewayException('listSessions: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    final list = j['sessions'] as List? ?? [];
    return list.map((e) => MafwSession.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<List<MafwMessage>> messages(String sessionID, {int limit = 50}) async {
    final res = await _http.get(
      _uri('/api/sessions/$sessionID/messages', {'limit': '$limit'}),
      headers: _headers,
    );
    if (res.statusCode != 200) throw GatewayException('messages: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes));
    final raw = j is Map<String, dynamic> ? (j['data'] ?? j['messages']) : j;
    final list = raw is List ? raw : <dynamic>[];
    final out = <MafwMessage>[];
    for (final item in list) {
      if (item is! Map<String, dynamic>) continue;
      final info = item['info'] is Map<String, dynamic> ? item['info'] as Map<String, dynamic> : item;
      out.add(MafwMessage.fromJson(info, sessionID: sessionID));
    }
    return out;
  }

  Future<String> createSession({String? directory}) async {
    final res = await _http.post(
      _uri('/api/session'),
      headers: _headers,
      body: jsonEncode({if (directory != null) 'directory': directory}),
    );
    if (res.statusCode != 200) throw GatewayException('createSession: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    return (j['id'] ?? j['sessionID'] ?? '').toString();
  }

  // ── Chat (enriched send, memory injection built in) ──

  Future<String> sendEnriched(String message, {String? sessionID}) async {
    final res = await _http.post(
      _uri('/api/chat/enriched'),
      headers: _headers,
      body: jsonEncode({
        'message': message,
        if (sessionID != null) 'sessionID': sessionID,
      }),
    );
    if (res.statusCode != 200) throw GatewayException('sendEnriched: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    return (j['sessionID'] ?? '').toString();
  }

  // ── Memory ──

  Future<List<Map<String, dynamic>>> memorySearch(String query, {int topK = 20}) async {
    final res = await _http.get(
      _uri('/api/memory/search', {'query': query, 'topK': '$topK'}),
      headers: _headers,
    );
    if (res.statusCode != 200) throw GatewayException('memorySearch: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    final list = j['results'] as List? ?? [];
    return list.map((e) => e as Map<String, dynamic>).toList();
  }

  Future<Map<String, dynamic>?> memoryEnergyDistribution() async {
    final res = await _http.get(_uri('/api/memory/energy-distribution'), headers: _headers);
    if (res.statusCode != 200) return null;
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  // ── Goals ──

  Future<List<Map<String, dynamic>>> listGoals() async {
    final res = await _http.get(_uri('/api/goals'), headers: _headers);
    if (res.statusCode != 200) throw GatewayException('listGoals: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    final list = j['goals'] as List? ?? [];
    return list.map((e) => e as Map<String, dynamic>).toList();
  }

  Future<Map<String, dynamic>?> getGoal(String goalId) async {
    final res = await _http.get(_uri('/api/goals/$goalId'), headers: _headers);
    if (res.statusCode != 200) return null;
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  // ── Triage ──

  Future<List<Map<String, dynamic>>> listTriageItems() async {
    final res = await _http.get(_uri('/api/triage'), headers: _headers);
    if (res.statusCode != 200) throw GatewayException('listTriageItems: HTTP ${res.statusCode}');
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    final list = j['items'] as List? ?? [];
    return list.map((e) => e as Map<String, dynamic>).toList();
  }

  Future<Map<String, dynamic>> proposeTriageDecision(String triageId, {required bool accept}) async {
    final endpoint = accept ? 'confirm' : 'reject';
    final res = await _http.post(
      _uri('/api/triage/$triageId/$endpoint'),
      headers: _headers,
    );
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
    final streamed = await request.send();
    final body = await http.Response.fromStream(streamed);
    if (body.statusCode != 200) throw GatewayException('uploadMediaTask: HTTP ${body.statusCode}');
    return jsonDecode(body.body) as Map<String, dynamic>;
  }

  /// Send a follow-up question to an existing media task.
  /// Returns { answer, taskId }.
  Future<Map<String, dynamic>> askMediaTask(String taskId, String question) async {
    final res = await _http.post(
      _uri('/api/mobile/media/tasks/$taskId/ask'),
      headers: _headers,
      body: jsonEncode({'question': question}),
    );
    if (res.statusCode != 200) throw GatewayException('askMediaTask: HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  // ── TTS ──

  Future<Map<String, dynamic>> ttsVoices() async {
    final res = await _http.get(_uri('/api/tts/voices'), headers: _headers);
    if (res.statusCode != 200) throw GatewayException('ttsVoices: HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  /// Synthesize speech, returns { artifactId, voice, mime, url }.
  Future<Map<String, dynamic>> ttsSpeak(String text, {String? voice, String? style}) async {
    final res = await _http.post(
      _uri('/api/tts'),
      headers: _headers,
      body: jsonEncode({
        'text': text,
        if (voice != null) 'voice': voice,
        if (style != null) 'style': style,
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
