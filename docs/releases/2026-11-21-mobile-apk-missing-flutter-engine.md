# 2026-11-21 · 真机安装即闪退：arm64 debug 分包缺 `libflutter.so`

## 现象

用户安装 `mobile/build/app/outputs/flutter-apk/app-arm64-v8a-debug.apk`（101 MB）后，
点击图标立即闪退（进程在 Flutter 首帧前结束）。

## 根因

该 APK 的 `lib/arm64-v8a/` 里**只有第三方插件 so**，没有 Flutter 引擎：

```
lib/arm64-v8a/libbarhopper_v3.so
lib/arm64-v8a/libdartjni.so
lib/arm64-v8a/libdatastore_shared_counter.so
lib/arm64-v8a/libimage_processing_util_jni.so
```

对比同批产物：

| APK | `libflutter.so` | 结果 |
|---|---|---|
| `app-x86_64-debug.apk` | 有（38.2 MB） | 模拟器可跑 |
| `app-arm64-v8a-debug.apk` | **无** | 真机启动即 `UnsatisfiedLinkError: dlopen failed: library "libflutter.so" not found` |
| `app-profile.apk` | 有（12 MB）+ `libapp.so` 8.9 MB | 正常 |

原因：`mobile/android/app/build.gradle.kts` 开了 `splits { abi { isEnable = true; isUniversalApk = true } }`，
而上一批包是用 `flutter build apk --debug --target-platform android-x64`（为模拟器验收）构建的。
Flutter 只为该 target 产出引擎产物，AGP 仍按 ABI 切出 arm64 / v7a 分包 ——
这些分包只包含插件 so，不含 Flutter 引擎，装到真机上必然闪退。

## 修复 / 交付

改用 `flutter build apk --profile --target-platform android-arm64`，产出体积更小、AOT 的包：

- `mobile/build/app/outputs/flutter-apk/app-profile.apk`
- 48.2 MB，SHA-256 `a2da8730c358e9c2baf3e1bb0d5761bdcd1663f21d6f802f1ed2e05818f03b78`
- applicationId `ai.orcalore.mobile`，versionCode 2 / versionName 1.1.0，debug 签名（可侧载）
- `lib/arm64-v8a/` 含 `libflutter.so` + `libapp.so`
- `zipalign -c -P 16` 通过；ELF LOAD 段 64KB 对齐（兼容 Android 15+ 16KB page）

## 教训

- **不要**给真机发 `--target-platform android-x64` 构建出来的 split APK。
- 交付前必须校验分包内 `lib/<abi>/libflutter.so` 存在，而不是只看 `native-code:` 里有没有该 ABI
  （badging 的 `native-code` 只反映插件 so）。
- 下次用：`flutter build apk --profile --target-platform android-arm64`，并用
  `unzip -l app-*.apk | findstr libflutter` 自检。
