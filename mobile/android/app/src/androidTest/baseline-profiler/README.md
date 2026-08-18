# Baseline Profile — MAFW Mobile

Records the critical user path `SessionsPage → ChatPage` to generate
`baseline-prof.txt` for Android's Baseline Profile feature (ART startup
optimization via ahead-of-time compilation of hot methods).

## Prerequisites

- Android device or emulator with API 28+
- Flutter project built in profile or release mode
- `flutter build apk --release` completed at least once

## How to Generate

### Option A: Flutter `baseline_profile` package (recommended)

1. Add `baseline_profile` to `dev_dependencies` in `pubspec.yaml`:
   ```yaml
   dev_dependencies:
     baseline_profile: ^2.3.0
   ```

2. Run the generator:
   ```bash
   cd mobile
   flutter pub get
   dart run baseline_profile
   ```

3. The generated file is placed at:
   ```
   android/app/src/main/baseline-prof.txt
   ```

4. Build the app — the baseline profile is automatically included:
   ```bash
   flutter build apk --release
   ```

### Option B: Manual macrobenchmark (current setup)

The Kotlin file `CriticalPathBenchmark.kt` defines JUnit4 instrumented
benchmarks that run on-device via `androidTest`. These use
`MacrobenchmarkRule` from `androidx.benchmark:benchmark-macro-junit4`.

```bash
# Build the app and benchmark test APK
cd mobile/android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest

# Install both APKs
adb install app/build/outputs/apk/debug/app-debug.apk
adb install app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk

# Run all benchmarks
adb shell am instrument -w \
  -e class ai.mafw.mafw_mobile.benchmark.CriticalPathBenchmark \
  ai.mafw.mafw_mobile.test/androidx.benchmark.junit4.AndroidBenchmarkRunner

# Run a single benchmark
adb shell am instrument -w \
  -e class ai.mafw.mafw_mobile.benchmark.CriticalPathBenchmark#recordBaselineProfile \
  ai.mafw.mafw_mobile.test/androidx.benchmark.junit4.AndroidBenchmarkRunner
```

### Option C: adb cold-start measurement (quick gate)

```bash
adb shell am force-stop ai.mafw.mafw_mobile
adb shell am start -W ai.mafw.mafw_mobile/.MainActivity
# Check TotalTime in output — must be < 1200ms
```

## Acceptance Criteria

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Cold start TotalTime | < 1200ms | `adb shell am start -W` |
| APK size per ABI | < 35MB | `flutter build apk --analyze-size` |
| SessionsPage→ChatPage transition | < 300ms | Macrobenchmark trace |

## Files

- `app/src/androidTest/baseline-profiler/CriticalPathBenchmark.kt` — instrumented macrobenchmark
- `app/build.gradle.kts` — includes `benchmark-macro-junit4` dependency
- `baseline-prof.txt` (generated) — ART baseline profile (placed in `android/app/src/main/`)
