import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'src/config/connection_config.dart';
import 'src/models/mafw_models.dart';
import 'src/network/gateway_client.dart';
import 'src/network/ws_client.dart';
import 'src/pages/chat_page.dart';
import 'src/pages/connection_settings_page.dart';
import 'src/pages/pairing_page.dart';
import 'src/pages/sessions_page.dart';
import 'src/services/connectivity_watcher.dart';
import 'src/services/push_service.dart';
import 'src/services/secure_config_store.dart';

/// Top-level handler for WorkManager background callbacks.
/// Must be a top-level function (not a closure) for Android background execution.
@pragma('vm:entry-point')
void _backgroundCallback() {
  // Handled by PushService._backgroundCallback — this is the Workmanager entry point.
  // Workmanager calls are registered in PushService.init().
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  runApp(const MafwMobileApp());
}

class MafwMobileApp extends StatefulWidget {
  const MafwMobileApp({super.key});

  @override
  State<MafwMobileApp> createState() => _MafwMobileAppState();
}

class _MafwMobileAppState extends State<MafwMobileApp> {
  ConnectionConfig? _config;
  GatewayClient? _client;
  WsClient? _ws;
  PushService? _pushService;
  ConnectivityWatcher? _connectivityWatcher;
  List<MafwSession> _sessions = [];
  bool _connecting = true;
  bool _wsConnected = false;
  StreamSubscription? _wsStatusSub;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _connectivityWatcher?.dispose();
    _wsStatusSub?.cancel();
    _pushService?.dispose();
    _ws?.dispose();
    _client?.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    final cfg = await ConnectionConfig.load();
    if (!mounted) return;
    await _applyConfig(cfg);
  }

  Future<void> _applyConfig(ConnectionConfig cfg) async {
    _connectivityWatcher?.dispose();
    _ws?.dispose();
    _wsStatusSub?.cancel();
    _pushService?.dispose();
    final client = GatewayClient(cfg);
    final ws = WsClient(cfg);
    _wsStatusSub = ws.connectionStatus.listen((ok) {
      if (mounted) setState(() => _wsConnected = ok);
    });
    setState(() {
      _config = cfg;
      _client = client;
      _ws = ws;
      _connecting = true;
    });
    // Start connectivity watcher for auto-reconnect
    _connectivityWatcher = ConnectivityWatcher(onChanged: () => ws.reconnect());
    _connectivityWatcher!.start();
    await ws.connect();
    await _refreshSessions();

    // Initialize push service with WsClient event wiring and navigation callback
    final pushService = PushService(
      config: cfg,
      ws: ws,
      onRefreshSessions: _refreshSessions,
      onNavigateToSession: _navigateToSession,
    );
    await pushService.init();
    _pushService = pushService;

    if (mounted) setState(() => _connecting = false);
  }

  void _refreshSessionsDebounced() {
    _sessionsDebounce?.cancel();
    _sessionsDebounce = Timer(const Duration(milliseconds: 500), _refreshSessions);
  }

  Timer? _sessionsDebounce;

  Future<void> _refreshSessions() async {
    final c = _client;
    if (c == null) return;
    try {
      final list = await c.listSessions();
      if (!mounted) return;
      // Sort: managers first, then by recency.
      list.sort((a, b) {
        if (a.isManager != b.isManager) return a.isManager ? -1 : 1;
        return (b.timeCreated ?? 0).compareTo(a.timeCreated ?? 0);
      });
      setState(() => _sessions = list);
    } catch (_) {
      // offline — keep previous list
    }
  }

  /// Navigate to a specific session by ID (for click-through from notifications).
  void _navigateToSession(String sessionID) {
    final c = _client;
    final ws = _ws;
    if (c == null || ws == null) return;

    // Find the session in the current list
    final session = _sessions.where((s) => s.id == sessionID).firstOrNull;
    if (session != null) {
      _openChat(session);
      return;
    }

    // Session not in list — refresh then try again
    _refreshSessions().then((_) {
      if (!mounted) return;
      final s = _sessions.where((x) => x.id == sessionID).firstOrNull;
      if (s != null) {
        _openChat(s);
      } else {
        _snack('会话 $sessionID 未找到');
      }
    });
  }

  Future<void> _createSession() async {
    final c = _client;
    if (c == null) return;
    try {
      final id = await c.createSession();
      await _refreshSessions();
      final s = _sessions.where((x) => x.id == id).firstOrNull;
      if (s != null) _openChat(s);
    } catch (e) {
      _snack('新建会话失败: $e');
    }
  }

  void _openChat(MafwSession s) {
    final c = _client;
    final ws = _ws;
    if (c == null || ws == null) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => ChatPage(
        session: s,
        client: c,
        ws: ws,
        onSpeak: () async {
          _snack('语音输入将在下一版本启用');
        },
      ),
    ));
  }

  void _openSettings() {
    final cfg = _config;
    if (cfg == null) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => ConnectionSettingsPage(initial: cfg, onSaved: _applyConfig),
    ));
  }

  Future<void> _openScan() async {
    final result = await Navigator.of(context).push<ConnectionConfig>(
      MaterialPageRoute(builder: (_) => const PairingPage()),
    );
    if (result != null && mounted) {
      await _applyConfig(result);
    }
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(msg), duration: const Duration(seconds: 2)));
  }

  @override
  Widget build(BuildContext context) {
    final connected = _client != null && _wsConnected;
    return MaterialApp(
      title: 'MAFW Mobile',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo, brightness: Brightness.dark),
        useMaterial3: true,
      ),
      themeMode: ThemeMode.system,
      home: _connecting
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : SessionsPage(
              sessions: _sessions,
              onOpen: _openChat,
              onCreate: _createSession,
              onSettings: _openSettings,
              onScan: _openScan,
            ),
      // Connection banner via an overlay in the sessions page would be nicer;
      // for MVP show a thin strip above the sessions list.
      builder: (context, child) {
        return Column(
          children: [
            if (!connected)
              Material(
                color: Colors.red.shade700,
                child: SafeArea(
                  bottom: false,
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    child: Text(
                      "Gateway 未连接（${_config?.baseUrl ?? ''}）— 点右上角设置",
                      style: const TextStyle(color: Colors.white, fontSize: 12),
                    ),
                  ),
                ),
              ),
            Expanded(child: child ?? const SizedBox()),
          ],
        );
      },
    );
  }
}
