import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;

import '../cache/session_cache.dart';
import '../models/mafw_models.dart';
import '../network/gateway_client.dart';
import '../network/ws_client.dart';

/// Chat view for one session: message list (live via WS events) + composer.
class ChatPage extends StatefulWidget {
  final MafwSession session;
  final GatewayClient client;
  final WsClient ws;
  final SessionCache? cache;
  final Future<void> Function() onSpeak; // P3: voice input hook

  const ChatPage({
    super.key,
    required this.session,
    required this.client,
    required this.ws,
    this.cache,
    required this.onSpeak,
  });

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final _inputCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  final _picker = ImagePicker();
  final _audioPlayer = AudioPlayer();
  List<MafwMessage> _messages = [];
  bool _loading = true;
  bool _sending = false;
  bool _sticky = true;
  StreamSubscription<MafwEvent>? _sub;
  Timer? _refreshDebounce;

  @override
  void initState() {
    super.initState();
    _loadHistory();
    _sub = widget.ws.events.listen(_onEvent);
    _scrollCtrl.addListener(() {
      if (_scrollCtrl.hasClients) {
        final atBottom = _scrollCtrl.position.pixels >=
            _scrollCtrl.position.maxScrollExtent - 60;
        if (atBottom != _sticky) setState(() => _sticky = atBottom);
      }
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _refreshDebounce?.cancel();
    _audioPlayer.dispose();
    _inputCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadHistory() async {
    setState(() => _loading = true);
    try {
      // Check cache first
      final cached = widget.cache?.getBySession(widget.session.id);
      if (cached != null && cached.isNotEmpty) {
        final msgs = cached
            .map((m) => MafwMessage(
                  id: m.id,
                  sessionID: m.sessionID,
                  role: m.role,
                  text: m.text,
                  timeCreated: m.timeCreated,
                ))
            .toList();
        if (!mounted) return;
        setState(() {
          _messages = msgs;
          _loading = false;
        });
        _jumpToBottom();
        // Still refresh from gateway in background to get any new messages
        _refreshFromGateway();
        return;
      }

      // No cache — fetch from gateway
      final msgs = await widget.client.messages(widget.session.id, limit: 50);
      if (!mounted) return;
      setState(() {
        _messages = msgs;
        _loading = false;
      });
      _jumpToBottom();
      // Populate cache
      _updateCache(msgs);
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      _snack('加载历史失败: $e');
    }
  }

  Future<void> _refreshFromGateway() async {
    try {
      final msgs = await widget.client.messages(widget.session.id, limit: 50);
      if (!mounted) return;
      setState(() => _messages = msgs);
      _jumpToBottom();
      _updateCache(msgs);
    } catch (_) {
      // Offline — keep cached data
    }
  }

  void _updateCache(List<MafwMessage> msgs) {
    final cache = widget.cache;
    if (cache == null) return;
    for (final m in msgs) {
      cache.put(CachedMessage(
        id: m.id,
        sessionID: m.sessionID,
        role: m.role,
        text: m.text,
        timeCreated: m.timeCreated,
      ));
    }
  }

  void _onEvent(MafwEvent ev) {
    // Refresh this session's messages when its activity events arrive.
    final isSessionEvent = ev.sessionID == null || ev.sessionID == widget.session.id;
    final interesting = ev.type == 'opencode_event' &&
        (ev.properties?['type'] == 'message.updated' ||
            ev.properties?['type'] == 'message.part.updated' ||
            ev.properties?['type'] == 'message.complete' ||
            ev.properties?['type'] == 'message.error' ||
            ev.properties?['type'] == 'session.idle');
    if (isSessionEvent && (interesting || ev.type == 'send_ack')) {
      _refreshDebounce?.cancel();
      _refreshDebounce = Timer(const Duration(milliseconds: 250), _loadHistory);
    }
  }

  Future<void> _send() async {
    final text = _inputCtrl.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    _inputCtrl.clear();
    // Optimistic append of the user message.
    setState(() {
      _messages.add(MafwMessage(
        id: 'user-${DateTime.now().millisecondsSinceEpoch}',
        sessionID: widget.session.id,
        role: 'user',
        text: text,
        timeCreated: DateTime.now().millisecondsSinceEpoch,
      ));
    });
    _jumpToBottom();
    try {
      final sid = await widget.client.sendEnriched(text, sessionID: widget.session.id);
      if (!mounted) return;
      if (sid.isNotEmpty && sid != widget.session.id) {
        _snack('已在新会话回复: $sid');
      }
    } catch (e) {
      if (!mounted) return;
      _snack('发送失败: $e');
    }
    setState(() => _sending = false);
  }

  Future<void> _pickAndUploadMedia() async {
    try {
      final xFile = await _picker.pickMedia();
      if (xFile == null) return;
      setState(() => _sending = true);
      _snack('正在上传媒体…');

      // Compress images > 1280px before upload
      String uploadPath = xFile.path;
      if (xFile.path.toLowerCase().endsWith('.jpg') ||
          xFile.path.toLowerCase().endsWith('.jpeg') ||
          xFile.path.toLowerCase().endsWith('.png')) {
        uploadPath = await _compressImage(xFile.path);
      }

      final result = await widget.client.uploadMediaTask(uploadPath);
      if (!mounted) return;
      final taskId = result['id']?.toString() ?? '';
      final state = result['state']?.toString() ?? '';
      if (taskId.isEmpty) {
        _snack('媒体任务创建失败');
        return;
      }
      // Insert pointer message into the chat
      final pointer = '[媒体附件 taskID: $taskId]';
      setState(() {
        _messages.add(MafwMessage(
          id: 'media-${DateTime.now().millisecondsSinceEpoch}',
          sessionID: widget.session.id,
          role: 'user',
          text: '$pointer\n媒体已上传，状态: $state',
          timeCreated: DateTime.now().millisecondsSinceEpoch,
        ));
      });
      _jumpToBottom();
      _snack('媒体上传完成 (task: ${taskId.substring(0, 8)}…)');
    } catch (e) {
      if (!mounted) return;
      _snack('媒体上传失败: $e');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// Compress an image to max 1280px width/height, JPEG quality 85.
  Future<String> _compressImage(String imagePath) async {
    try {
      final dir = await getTemporaryDirectory();
      final targetPath = p.join(dir.path, 'compressed_${p.basename(imagePath)}');
      final result = await FlutterImageCompress.compressAndGetFile(
        imagePath,
        targetPath,
        minWidth: 1280,
        minHeight: 1280,
        quality: 85,
        format: CompressFormat.jpeg,
      );
      if (result != null) {
        return result.path;
      }
    } catch (_) {
      // Compression failed — upload original
    }
    return imagePath;
  }

  Future<void> _speakText(String text) async {
    if (text.isEmpty) return;
    try {
      _snack('正在合成语音…');
      final result = await widget.client.ttsSpeak(text);
      if (!mounted) return;
      var artifactId = result['artifactId']?.toString() ?? '';
      if (artifactId.isEmpty) {
        final url = result['url']?.toString() ?? '';
        final m = RegExp(r'/a2a/artifacts/([^/?#]+)').firstMatch(url);
        artifactId = m?.group(1) ?? '';
      }
      if (artifactId.isEmpty) {
        _snack('语音合成失败: 未返回音频');
        return;
      }
      final config = widget.client.config;
      final playUrl =
          '${config.normalizedBaseUrl}/api/mobile/tts/artifacts/$artifactId';
      final headers = <String, String>{
        if (config.apiToken.isNotEmpty)
          'Authorization': 'Bearer ${config.apiToken}',
      };
      _snack('正在播放语音…');
      await _audioPlayer.setAudioSource(
        AudioSource.uri(Uri.parse(playUrl), headers: headers),
      );
      await _audioPlayer.play();
    } catch (e) {
      if (!mounted) return;
      _snack('语音合成失败: $e');
    }
  }

  void _jumpToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients && _sticky) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 150),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(msg), duration: const Duration(seconds: 2)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.session.displayTitle, style: const TextStyle(fontSize: 16)),
            if (widget.session.isManager)
              const Text('Manager', style: TextStyle(fontSize: 11, color: Colors.amber)),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _messages.isEmpty
                    ? const Center(child: Text('暂无消息'))
                    : ListView.builder(
                        controller: _scrollCtrl,
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        itemCount: _messages.length,
                        itemBuilder: (ctx, i) => GestureDetector(
                          onLongPress: () => _showMessageActions(_messages[i]),
                          child: _MessageBubble(msg: _messages[i]),
                        ),
                      ),
          ),
          _composer(),
        ],
      ),
    );
  }

  void _showMessageActions(MafwMessage msg) {
    final text = msg.text ?? '';
    if (text.isEmpty) return;
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.volume_up),
              title: const Text('朗读'),
              onTap: () {
                Navigator.pop(ctx);
                _speakText(text);
              },
            ),
            ListTile(
              leading: const Icon(Icons.copy),
              title: const Text('复制'),
              onTap: () {
                Navigator.pop(ctx);
                // Copy handled by SelectableText's built-in selection
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _composer() {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            IconButton(
              icon: const Icon(Icons.attach_file),
              tooltip: '附件',
              onPressed: _sending ? null : _pickAndUploadMedia,
            ),
            IconButton(
              icon: const Icon(Icons.mic),
              tooltip: '语音输入',
              onPressed: _sending ? null : widget.onSpeak,
            ),
            Expanded(
              child: TextField(
                controller: _inputCtrl,
                minLines: 1,
                maxLines: 6,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
                decoration: const InputDecoration(
                  hintText: '输入消息…',
                  isDense: true,
                  border: OutlineInputBorder(),
                ),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.send),
              onPressed: _sending ? null : _send,
            ),
          ],
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final MafwMessage msg;
  const _MessageBubble({required this.msg});

  @override
  Widget build(BuildContext context) {
    final isUser = msg.role == 'user';
    final text = msg.text ?? '';
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.82),
        decoration: BoxDecoration(
          color: isUser ? Colors.blue.shade600 : Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
        ),
        child: SelectableText(
          text,
          style: TextStyle(
            color: isUser ? Colors.white : Theme.of(context).colorScheme.onSurface,
            fontSize: 14,
          ),
        ),
      ),
    );
  }
}
