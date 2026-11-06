/// 当前项目（active project）选择（Task 7）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.1「App 维护单一『当前项目』：工作 tab 头部项目切换器（`GET /api/projects`
/// 列表选择，持久记住）」。
///
/// 语义：
/// - [current] 是上次选择（或解析后的默认值）；首次启动为 `null`。
/// - [resolve] 用 `projects()` 的真实列表把「记住的项目」收敛成一个有效目录：
///   记住的项目还在 → 用它；已消失 → 用第一个已注册项目；空列表 → `null`。
///   纯函数，不改状态（持久化由调用方按需 [set]）。
/// - [set] 立即更新内存值并异步落 SharedPreferences（fail-open：写失败只影响
///   下次启动的默认值，不影响当前会话）。
library;

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/pod_models.dart';

/// SharedPreferences key：当前项目的绝对目录。
const String kActiveProjectPrefsKey = 'orcalore_active_project';

class ActiveProjectStore extends ChangeNotifier {
  ActiveProjectStore({this.prefsKey = kActiveProjectPrefsKey});

  /// SharedPreferences key（测试可注入独立 key）。
  final String prefsKey;

  String? _dir;
  bool _loaded = false;

  /// 上次选择（或解析后写回的默认值）；尚未选择时为 `null`。
  String? current() => _dir;

  /// 是否已尝试从磁盘恢复过（测试/诊断用）。
  bool get loaded => _loaded;

  /// 从 SharedPreferences 恢复一次（幂等）。
  Future<void> load() async {
    if (_loaded) return;
    _loaded = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(prefsKey);
      if (saved != null && saved.isNotEmpty) _dir = saved;
    } catch (_) {
      // fail-open：读不到就用「第一个项目」的默认解析。
    }
  }

  /// 有效项目目录：记住的项目仍在列表里则优先，否则第一个；空列表 → `null`。
  String? resolve(List<ProjectInfo> projects) {
    if (projects.isEmpty) return null;
    final saved = _dir;
    if (saved != null && saved.isNotEmpty && projects.any((p) => p.dir == saved)) {
      return saved;
    }
    final first = projects.first.dir;
    return first.isEmpty ? null : first;
  }

  /// 切换当前项目并持久化。
  Future<void> set(String dir) async {
    if (dir.isEmpty) return;
    final changed = dir != _dir;
    _dir = dir;
    if (changed) notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(prefsKey, dir);
    } catch (_) {
      // fail-open：持久化失败只影响下次启动的默认值。
    }
  }
}
