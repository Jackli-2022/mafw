/// Orcalore Mobile 主题（spec
/// `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md` §3/§3.1）。
///
/// 设计语言 = 裁定 B「Grok 单色极简」+ Orcalore 品牌修订：
/// - 中性主导：底色纯黑、surface ink `#1D1F25`、正文 cream `#FCF8F1`
/// - accent mint `#4FD388`（与桌面 accent 同源）是**唯一彩色**，只用于
///   ① 需要你 ② 激活态 ③ CTA ④ 进行中的时间线节点/进度焦点
/// - 阶段徽标全部中性：`badgeBg #24272F` 底 + `badgeText #C9C9D4` 字
/// - PASS/FAIL 不引入绿/红（verdict 用白 ✓ / 灰 ✕）；粉/青/琥珀已从 UI 语义色退役
///
/// v1 只有一套深色主题（spec §3「深色极简」）。`mafwLightTheme()` 保留为
/// API 兼容别名并返回同一主题，防止 `ThemeMode.system` 在亮色设备上回落到
/// 遗留的紫色/白色调色板。
library;

import 'package:flutter/material.dart';

/// Orcalore 品牌 token（值 = spec §3 token 表；UI 不写字面色，一律走这里）。
class MafwPalette {
  const MafwPalette._();

  /// 应用底色（OLED 真黑）。
  static const Color black = Color(0xFF000000);

  /// 卡片 / 浮层 / 导航表面（ink）。
  static const Color surface = Color(0xFF1D1F25);

  /// 分隔线与卡片描边。
  static const Color border = Color(0xFF2A2D36);

  /// 主文本（cream）。
  static const Color text = Color(0xFFFCF8F1);

  /// 次级文本。
  static const Color dim = Color(0xFF9CA3AF);

  /// 三级文本 / 占位。
  static const Color faint = Color(0xFF6B6B72);

  /// 唯一彩色：mint accent（需要你 / 激活态 / CTA / 进行中）。
  static const Color accent = Color(0xFF4FD388);

  /// accent 的弱化底（mint 13%，对齐桌面 `--accent-dim`：`rgba(79,211,136,.13)`）。
  static const Color accentDim = Color(0x214FD388);

  /// 阶段徽标 / 中性 chip 底。
  static const Color badgeBg = Color(0xFF24272F);

  /// 阶段徽标 / 中性 chip 字。
  static const Color badgeText = Color(0xFFC9C9D4);
}

/// 品牌主色（mint accent；语义 = `MafwPalette.accent`）。
const Color kMafwPrimary = MafwPalette.accent;
/// 强调/CTA 色（与 primary 同源，mint 是唯一彩色）。
const Color kMafwAccent = MafwPalette.accent;
/// Manager/Lead 会话标识（中性化：品牌不再用琥珀）。
const Color kMafwManager = MafwPalette.dim;
/// 子代理标识（中性化：品牌不再用灰紫）。
const Color kMafwSubagent = MafwPalette.dim;
/// Goal 进行中（mint = 激活态语义）。
const Color kMafwGoalActive = MafwPalette.accent;
/// 记忆能量高（mint = accent，不引入 success 绿）。
const Color kMafwEnergyHigh = MafwPalette.accent;

/// 深色模式的应用底色（OLED 真黑）。
const Color kMafwDarkSurface = MafwPalette.black;
/// 深色模式卡片 / 浮层（ink）。
const Color kMafwDarkSurfaceVariant = MafwPalette.surface;

/// Orcalore 唯一的 ColorScheme（深色）。
const ColorScheme _orcaloreScheme = ColorScheme.dark(
  primary: MafwPalette.accent,
  onPrimary: MafwPalette.black,
  primaryContainer: MafwPalette.badgeBg,
  onPrimaryContainer: MafwPalette.text,
  secondary: MafwPalette.text,
  onSecondary: MafwPalette.black,
  secondaryContainer: MafwPalette.badgeBg,
  onSecondaryContainer: MafwPalette.text,
  tertiary: MafwPalette.dim,
  onTertiary: MafwPalette.black,
  tertiaryContainer: MafwPalette.badgeBg,
  onTertiaryContainer: MafwPalette.text,
  error: Color(0xFFE5484D),
  onError: MafwPalette.text,
  errorContainer: Color(0xFF3A1113),
  onErrorContainer: Color(0xFFF0757A),
  surface: MafwPalette.surface,
  onSurface: MafwPalette.text,
  surfaceDim: MafwPalette.black,
  surfaceBright: MafwPalette.badgeBg,
  surfaceContainerLowest: MafwPalette.black,
  surfaceContainerLow: MafwPalette.black,
  surfaceContainer: MafwPalette.surface,
  surfaceContainerHigh: MafwPalette.badgeBg,
  surfaceContainerHighest: MafwPalette.badgeBg,
  onSurfaceVariant: MafwPalette.dim,
  outline: MafwPalette.border,
  outlineVariant: MafwPalette.border,
  shadow: MafwPalette.black,
  scrim: MafwPalette.black,
  inverseSurface: MafwPalette.text,
  onInverseSurface: MafwPalette.black,
  inversePrimary: MafwPalette.accent,
  surfaceTint: MafwPalette.accent,
);

/// Orcalore 主题（亮色钩子：v1 只有一套深色主题，见文件头注释）。
ThemeData mafwLightTheme() => mafwDarkTheme();

/// Orcalore 主题：深色（唯一）。
ThemeData mafwDarkTheme() => _build(_orcaloreScheme);

ThemeData _build(ColorScheme scheme) {
  final cream = MafwPalette.text;
  final borderRadius = BorderRadius.circular(14);
  return ThemeData(
    colorScheme: scheme,
    brightness: Brightness.dark,
    useMaterial3: true,
    scaffoldBackgroundColor: MafwPalette.black,
    canvasColor: MafwPalette.black,
    dividerColor: MafwPalette.border,
    appBarTheme: AppBarThemeData(
      backgroundColor: MafwPalette.black,
      foregroundColor: cream,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        color: cream,
        fontSize: 17,
        fontWeight: FontWeight.w600,
      ),
      iconTheme: IconThemeData(color: cream),
    ),
    // 正文排版：16pt / 行高 1.5（全宽文档感）；二级文本走 dim。
    textTheme: TextTheme(
      bodyMedium: TextStyle(fontSize: 16, height: 1.5, color: cream),
      bodySmall: TextStyle(fontSize: 12, height: 1.4, color: MafwPalette.dim),
    ),
    cardTheme: CardThemeData(
      color: MafwPalette.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: const EdgeInsets.symmetric(vertical: 4),
      shape: RoundedRectangleBorder(
        borderRadius: borderRadius,
        side: BorderSide(color: MafwPalette.border),
      ),
    ),
    dividerTheme: DividerThemeData(
      color: MafwPalette.border,
      thickness: 1,
      space: 1,
    ),
    iconTheme: IconThemeData(color: cream),
    chipTheme: ChipThemeData(
      backgroundColor: MafwPalette.badgeBg,
      labelStyle: TextStyle(color: MafwPalette.badgeText, fontSize: 12),
      side: BorderSide(color: MafwPalette.border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
    inputDecorationTheme: InputDecorationThemeData(
      isDense: true,
      filled: true,
      fillColor: MafwPalette.surface,
      hintStyle: TextStyle(color: MafwPalette.faint),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: borderRadius,
        borderSide: BorderSide(color: MafwPalette.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: borderRadius,
        borderSide: BorderSide(color: MafwPalette.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: borderRadius,
        borderSide: BorderSide(color: MafwPalette.accent),
      ),
    ),
    // FAB：纯白（cream）圆形 + 黑色＋号（spec §3）。
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: MafwPalette.text,
      foregroundColor: MafwPalette.black,
      elevation: 0,
      focusElevation: 0,
      hoverElevation: 0,
      highlightElevation: 0,
      shape: const CircleBorder(),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: MafwPalette.surface,
      indicatorColor: MafwPalette.accentDim,
      elevation: 0,
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return TextStyle(
          color: selected ? MafwPalette.text : MafwPalette.dim,
          fontSize: 12,
        );
      }),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return IconThemeData(
          color: selected ? MafwPalette.accent : MafwPalette.dim,
        );
      }),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: MafwPalette.badgeBg,
      contentTextStyle: TextStyle(color: MafwPalette.text),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: MafwPalette.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: MafwPalette.surface,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: MafwPalette.accent,
      linearTrackColor: MafwPalette.border,
      circularTrackColor: MafwPalette.border,
    ),
    // 触控目标 ≥48dp（Android 标准）
    visualDensity: VisualDensity.adaptivePlatformDensity,
    splashFactory: InkSparkle.splashFactory,
  );
}

/// 按 energy 取值返回语义色（记忆能量条：mint → 中性灰阶）。
Color mafwEnergyColor(double? energy) {
  if (energy == null) return MafwPalette.faint;
  if (energy >= 0.8) return MafwPalette.accent;
  if (energy >= 0.5) return MafwPalette.dim;
  return MafwPalette.faint;
}
