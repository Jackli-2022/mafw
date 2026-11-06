import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:hive_ce/hive.dart';
import 'package:path_provider/path_provider.dart';

import 'src/cache/session_cache.dart';
import 'src/config/connection_config.dart';
import 'src/models/mafw_models.dart';
import 'src/network/gateway_client.dart';
import 'src/network/ws_client_v2.dart';
import 'src/pages/chat_page.dart';
import 'src/pages/connection_settings_page.dart';
import 'src/pages/goal_detail_page.dart';
import 'src/pages/pairing_page.dart';
import 'src/pages/sessions_page.dart';
import 'src/pages/triage_page.dart';
import 'src/services/active_project.dart';
import 'src/services/connectivity_watcher.dart';
import 'src/services/diagnostics.dart';
import 'src/services/lifecycle_ws.dart';
import 'src/services/push_service.dart';
import 'src/services/work_refresh_bus.dart';
import 'src/theme.dart';

/// Top-level handler for WorkManager background callbacks.
/// Must be a top-level function (not a closure) for Android background execution.
@pragma('vm:entry-point')
void _backgroundCallback() {
  // Handled by PushService._backgroundCallback — this is the Workmanager entry point.
  // Workmanager calls are registered in PushService.init().
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Load config immediately so UI can render; Firebase is optional (placeholder
  // google-services.json must not block first frame — see systematic debugging fix).
  final cfg = await ConnectionConfig.load();
  try {
    await Firebase.initializeApp();
  } catch (e) {
    // Placeholder FCM config: FCM unavailable, WS/local cache still works.
    debugPrint('[MAFW] Firebase init failed (offlineable): $e');
  }
  // Hive must be initialized once before any box opens (SessionCache uses hive_ce).
  try {
    final dir = await getApplicationDocumentsDirectory();
    Hive.init(dir.path);
  } catch (e) {
    debugPrint('[MAFW] Hive init failed (offlineable): $e');
  }

  runApp(MafwMobileApp(initialConfig: cfg));
}

class MafwMobileApp extends StatefulWidget {
  final ConnectionConfig? initialConfig;
  const MafwMobileApp({super.key, this.initialConfig});

  @override
  State<MafwMobileApp> createState() => _MafwMobileAppState();
}

class _MafwMobileAppState extends State<MafwMobileApp> {
  // Navigator must be reached via key — the State's own context sits ABOVE
  // MaterialApp's Navigator, so Navigator.of(context) throws here.
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>();
  ConnectionConfig? _config;
  GatewayClient? _client;
  WsClientV2? _ws;
  PushService? _pushService;
  ConnectivityWatcher? _connectivityWatcher;
  LifecycleWsManager? _lifecycleManager;
  final SessionCache _sessionCache = SessionCache();

  /// Dev-only diagnostics collection. Release builds (unless built with
  /// `--dart-define=ORCALORE_DEBUG_PANEL=true`) keep this null: no buffers,
  /// no second JSON parse per WS frame, no retained chat text.
  final DiagnosticsSink? _diagnostics =
      debugPanelEnabled ? DiagnosticsSink() : null;

  List<MafwSession> _sessions = [];
  bool _connecting = true;
  bool _wsConnected = false;
  StreamSubscription? _wsStatusSub;

  /// 工作 tab 的当前项目选择 + 刷新总线（Task 7）。两者都跨 tab 复用，
  /// 由外壳注入而不是每个页面各自持有。
  final ActiveProjectStore _activeProject = ActiveProjectStore();
  final WorkRefreshBus _workRefresh = WorkRefreshBus();

  /// WS 事件 → 工作面刷新（`shouldRefreshWork` 过滤在总线内部）。
  StreamSubscription<MafwEvent>? _wsEventsSub;

  @override
  void initState() {
    super.initState();
    // Restore the remembered project before the work tab's first fetch resolves.
    _activeProject.load().catchError((Object e) {
      debugPrint('[MAFW] ActiveProjectStore load failed (offlineable): $e');
    });
    // Prefer initial config from main(); avoid blocking first frame on Hive.
    if (widget.initialConfig != null) {
      _applyConfig(widget.initialConfig!);
    }
    // Hive cache is best-effort; don't block UI on it.
    _sessionCache.init().catchError((Object e) { debugPrint('[MAFW] SessionCache init failed: $e'); });
    if (widget.initialConfig == null) {
      _init();
    } else {
      // Also mark connecting done early — SessionsPage renders with banner immediately.
      Future.microtask(() { if (mounted) setState(() => _connecting = false); });
    }
  }

  @override
  void dispose() {
    _sessionCache.dispose();
    _lifecycleManager?.dispose();
    _connectivityWatcher?.dispose();
    _wsStatusSub?.cancel();
    _wsEventsSub?.cancel();
    _pushService?.dispose();
    _ws?.dispose();
    _client?.dispose();
    _activeProject.dispose();
    _workRefresh.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    final cfg = await ConnectionConfig.load();
    if (!mounted) return;
    await _applyConfig(cfg);
  }

  Future<void> _applyConfig(ConnectionConfig cfg) async {
    _connectivityWatcher?.dispose();
    _connectivityWatcher = null;
    _lifecycleManager?.dispose();
    _lifecycleManager = null;
    _ws?.dispose();
    _wsStatusSub?.cancel();
    _wsEventsSub?.cancel();
    _wsEventsSub = null;
    _pushService?.dispose();

    _diagnostics?.updateConnection(baseUrl: cfg.baseUrl, apiToken: cfg.apiToken);

    // Unconfigured state (spec §6 "缺省清理"): the app shows the "未配置" banner
    // and waits for settings/pairing instead of reconnecting to a phantom
    // loopback gateway.
    if (cfg.normalizedBaseUrl.isEmpty) {
      setState(() {
        _config = cfg;
        _client = null;
        _ws = null;
        _connecting = false;
        _wsConnected = false;
        _sessions = [];
      });
      _pushService = null;
      return;
    }

    final client = GatewayClient(cfg, diagnostics: _diagnostics);
    final ws = WsClientV2(
      cfg,
      onRawFrame: _diagnostics?.recordWsFrame,
      // Reconnect hook (Task 5): events missed while offline are not replayed,
      // so the work surface refetches once per re-handshake.
      onReconnected: _workRefresh.onReconnected,
    );
    // Restore the persisted reconnect budget before the first attempt so a
    // retry budget exhausted before an app kill is honoured after relaunch.
    try {
      await ws.init();
    } catch (e) {
      debugPrint('[MAFW] WsClientV2 init failed (offlineable): $e');
    }
    if (!mounted) {
      ws.dispose();
      client.dispose();
      return;
    }

    _wsStatusSub = ws.connectionStatus.listen((ok) {
      if (mounted) setState(() => _wsConnected = ok);
    });
    // 工作 tab 的数据刷新入口：只有会改变工作面的帧才触发（总线内过滤）。
    _wsEventsSub = ws.events.listen(_workRefresh.onEvent);

    setState(() {
      _config = cfg;
      _client = client;
      _ws = ws;
      _connecting = false;
    });

    // Lifecycle manager: close WS on background, reconnect on foreground.
    _lifecycleManager = LifecycleWsManager(
      onConnect: () async {
        if (ws.isConnected) return;
        await ws.reconnect();
      },
      onDisconnect: () async {
        // Close socket but keep the client alive (dispose would kill streams)
        ws.disconnect();
      },
    );

    // Start connectivity watcher for auto-reconnect (500ms debounce + health probe)
    _connectivityWatcher = ConnectivityWatcher(
      onChanged: () async => ws.reconnect(),
      client: client,
    );
    _connectivityWatcher!.start();

    // Connect WS lazily — don't block first frame
    Future.delayed(const Duration(milliseconds: 100), () async {
      if (!mounted) return;
      await ws.connect();
      await _refreshSessions();
    });

    // Initialize push service with WS event wiring and navigation callback
    final pushService = PushService(
      config: cfg,
      ws: ws,
      onRefreshSessions: _refreshSessions,
      onNavigateToSession: _navigateToSession,
    );
    await pushService.init();
    _pushService = pushService;
  }

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

  /// 工作 tab 的 Goal 入口（Task 8 会重写详情页）。
  ///
  /// Task 7 只保证导航链通：`projectId`（跨项目 attention 先切好的项目）留给
  /// Task 8 的 `GoalDetailPage(podId, goalId)` 使用，当前打开既有页面。
  void _openGoal(String projectId, String goalId) {
    _navigatorKey.currentState?.push(MaterialPageRoute(
      builder: (_) => GoalDetailPage(
        client: _client,
        goalId: goalId,
        goalTitle: '',
        goalStatus: '',
      ),
    ));
  }

  /// 「＋ 新建讨论」占位：Task 11 接 Goal composer。
  void _createDiscussion() {
    _snack('新建讨论将在下一版本启用');
  }

  void _openChat(MafwSession s) {
    final c = _client;
    final ws = _ws;
    if (c == null || ws == null) return;
    // Track current session for FCM foreground dedup (spec §6.2: onMessage
    // skips notification when viewing the same session).
    _pushService?.currentSessionID = s.id;
    _navigatorKey.currentState
        ?.push(MaterialPageRoute(
          builder: (_) => ChatPage(
            session: s,
            client: c,
            ws: ws,
            cache: _sessionCache,
            onSpeak: () async {
              _snack('语音输入将在下一版本启用');
            },
          ),
        ))
        .then((_) {
      // Clear dedup when leaving ChatPage — subsequent pushes should notify.
      if (_pushService?.currentSessionID == s.id) {
        _pushService?.currentSessionID = null;
      }
    });
  }

  Future<void> _openSettings() async {
    var cfg = _config;
    if (cfg == null) {
      try {
        cfg = await ConnectionConfig.load();
      } catch (_) {}
    }
    if (cfg == null || !mounted) return;
    _navigatorKey.currentState?.push(MaterialPageRoute(
      builder: (_) => ConnectionSettingsPage(initial: cfg!, onSaved: _applyConfig),
    ));
  }

  Future<void> _openScan() async {
    final result = await _navigatorKey.currentState?.push<ConnectionConfig>(
      MaterialPageRoute(builder: (_) => const PairingPage()),
    );
    if (result != null && mounted) {
      await _applyConfig(result);
    }
  }

  void _snack(String msg) {
    // ScaffoldMessenger also lives under MaterialApp — use root messenger via key.
    final messenger = _navigatorKey.currentState?.context.findAncestorStateOfType<ScaffoldMessengerState>();
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(msg), duration: const Duration(seconds: 2)));
  }

  @override
  Widget build(BuildContext context) {
    final connected = _client != null && _wsConnected;
    return MaterialApp(
      navigatorKey: _navigatorKey,
      title: 'Orcalore',
      theme: mafwLightTheme(),
      darkTheme: mafwDarkTheme(),
      themeMode: ThemeMode.system,
      home: SessionsPage(
        sessions: _sessions,
        onOpen: _openChat,
        onCreate: _createSession,
        onSettings: _openSettings,
        onScan: _openScan,
        onTriage: () {
          _navigatorKey.currentState?.push(MaterialPageRoute(
            builder: (_) => TriagePage(client: _client),
          ));
        },
        isOffline: !connected,
        baseUrl: _config?.baseUrl,
        isConnecting: _connecting,
        client: _client,
        diagnostics: _diagnostics,
        wsConnected: () => _wsConnected,
        activeProject: _activeProject,
        refreshBus: _workRefresh,
        onOpenGoal: _openGoal,
        onCreateDiscussion: _createDiscussion,
      ),
    );
  }
}
