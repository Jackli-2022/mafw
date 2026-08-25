/// MAFW Mobile 主题（方案 C：AI 紫品牌风）。
///
/// - 主色：AI 紫 `#7C3AED` + 生成粉 `#EC4899`（强调）
/// - 深色：OLED 真黑 surface（省电 + 高对比）
/// - 语义色扩展：Goal 完成/进行、记忆 energy 高/低、Manager 琥珀、子代理灰紫
library;

import 'package:flutter/material.dart';

/// MAFW 品牌主色（AI 紫）。
const Color kMafwPrimary = Color(0xFF7C3AED);
/// 生成粉（强调色，用于 CTA/选中/链接）。
const Color kMafwAccent = Color(0xFFEC4899);
/// Manager 会话标识（琥珀）。
const Color kMafwManager = Color(0xFFF59E0B);
/// 子代理标识（灰紫）。
const Color kMafwSubagent = Color(0xFF8B7CF6);
/// Goal 进行中（青）。
const Color kMafwGoalActive = Color(0xFF22D3EE);
/// 记忆能量高（绿）。
const Color kMafwEnergyHigh = Color(0xFF34D399);

/// 深色模式的真黑 surface（OLED）。
const Color kMafwDarkSurface = Color(0xFF000000);
/// 深色模式卡片/浮层（近黑）。
const Color kMafwDarkSurfaceVariant = Color(0xFF121212);

/// MAFW 主题：亮色。
ThemeData mafwLightTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: kMafwPrimary,
    brightness: Brightness.light,
  );
  return _build(scheme, Brightness.light);
}

/// MAFW 主题：暗色（OLED 真黑）。
ThemeData mafwDarkTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: kMafwPrimary,
    brightness: Brightness.dark,
  ).copyWith(
    surface: kMafwDarkSurface,
    surfaceContainerHighest: kMafwDarkSurfaceVariant,
    surfaceContainer: kMafwDarkSurfaceVariant,
    surfaceContainerLow: kMafwDarkSurfaceVariant,
    surfaceContainerLowest: kMafwDarkSurface,
  );
  return _build(scheme, Brightness.dark);
}

ThemeData _build(ColorScheme scheme, Brightness brightness) {
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    scaffoldBackgroundColor: scheme.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        color: scheme.onSurface,
        fontSize: 17,
        fontWeight: FontWeight.w600,
      ),
    ),
    // AI 正文排版：16pt / 行高 1.5（Claude 式全宽文档感）
    textTheme: TextTheme(
      bodyMedium: TextStyle(
        fontSize: 16,
        height: 1.5,
        color: scheme.onSurface,
      ),
      bodySmall: TextStyle(
        fontSize: 12,
        height: 1.4,
        color: scheme.onSurfaceVariant,
      ),
    ),
    // 触控目标 ≥48dp（Android 标准）
    visualDensity: VisualDensity.adaptivePlatformDensity,
    splashFactory: InkSparkle.splashFactory,
  );
}

/// 按 energy 取值返回语义色（记忆能量条）。
Color mafwEnergyColor(double? energy) {
  if (energy == null) return Colors.grey;
  if (energy >= 0.8) return kMafwEnergyHigh;
  if (energy >= 0.5) return kMafwGoalActive;
  return kMafwManager;
}
