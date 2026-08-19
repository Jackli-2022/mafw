# mafw_mobile

MAFW Mobile — Flutter client for the MAFW Gateway (Android).

## Build commands

```bash
# Debug APK (quick smoke build)
flutter build apk --debug

# Release APK — split-per-abi + R8 (minify/shrinkResources from build.gradle.kts)
flutter build apk --release --obfuscate --split-debug-info=build/symbols \
  --analyze-size   # size gate: <35MB per abi

# Release AAB (Play 上架) — abi enableSplit 在 build.gradle.kts bundle 段
flutter build appbundle --release --obfuscate --split-debug-info=build/symbols
```

- `--obfuscate --split-debug-info` 必须成对使用；`build/symbols` 需保留用于 release 崩溃栈反混淆（spec §7.1）。
- 体积优化（`splits.abi` / `resConfigs("en","zh")` / `isMinifyEnabled` / `isShrinkResources` / `bundle.abi.enableSplit`）已在 `android/app/build.gradle.kts` 固化，命令行无需重复传参。
- 启动优化（并行初始化 + 首帧延迟 100ms 连 WS + 前后台生命周期管理）见 `lib/main.dart` 与 `lib/src/services/lifecycle_ws.dart`。

## Testing

```bash
flutter test
```
