# Task 6: Startup/Size/Battery/Traffic Optimization + Cache & Lifecycle

## What Was Implemented

### 1. Build Optimization (`mobile/android/app/build.gradle.kts`)
- **split-per-abi**: ARM64 + x86_64 + universal APK
- **minify + shrinkResources**: Enabled for release builds with ProGuard
- **resConfigs**: Strip to `en` + `zh` only
- **proguard-rules.pro**: Created with Flutter/Firebase/Hive keep rules

### 2. Startup Optimization (`mobile/lib/main.dart`)
- **Parallel init**: `ConnectionConfig.load()` + `Firebase.initializeApp()` run concurrently via `Future.wait()`
- **Lazy WS connect**: `ws.connect()` deferred 100ms after first frame renders
- **First-frame priority**: `_connecting` set to `false` immediately in `_applyConfig`, UI shows SessionsPage before WS connects

### 3. Lifecycle Management
- **`LifecycleWsManager`** (`mobile/lib/src/services/lifecycle_ws.dart`): WidgetsBindingObserver mixin
  - `paused/inactive/detached` → `disconnect()` (closes socket, preserves client)
  - `resumed` → `reconnect()` (re-establishes WS)
  - `scheduleReconnect()` with configurable delay
  - Deduplication: multiple pauses → single disconnect
  - Auto-cleanup on dispose
- **`WsClient.disconnect()`** (`mobile/lib/src/network/ws_client.dart`): New method that closes socket without destroying stream controllers (unlike `dispose()`)

### 4. Cache (`mobile/lib/src/cache/session_cache.dart`)
- **hive_ce** backed `SessionCache` class
- TTL: 24h default, configurable
- Per-session limit: 50 messages, evicts oldest
- Methods: `put`, `get`, `getBySession`, `remove`, `clearSession`, `clear`
- Lazy eviction on read (expired entries removed on access)

### 5. Dependencies (`mobile/pubspec.yaml`)
- Added `hive_ce: ^2.10.0`

## Files Changed

| File | Action |
|------|--------|
| `mobile/android/app/build.gradle.kts` | Modified — split-per-abi, minify, shrinkResources, resConfigs |
| `mobile/android/app/proguard-rules.pro` | Created — ProGuard keep rules |
| `mobile/lib/main.dart` | Modified — parallel init, lazy WS, lifecycle manager |
| `mobile/lib/src/services/lifecycle_ws.dart` | Created — WidgetsBindingObserver lifecycle manager |
| `mobile/lib/src/cache/session_cache.dart` | Created — hive_ce session message cache |
| `mobile/lib/src/network/ws_client.dart` | Modified — added `disconnect()` method |
| `mobile/pubspec.yaml` | Modified — added hive_ce dependency |
| `mobile/test/lifecycle_ws_test.dart` | Created — 9 tests for LifecycleWsManager |
| `mobile/test/session_cache_test.dart` | Created — 10 tests for SessionCache |

## Test Status

**Tests could not be run** — Flutter SDK is not installed in this environment. Tests are written and follow the existing test patterns (e.g., `push_service_test.dart`). They will need to be validated when Flutter is available.

## Self-Review Findings

1. **WsClient.disconnect() vs dispose()**: Correctly distinguished — `disconnect()` closes socket but keeps stream controllers alive for lifecycle reconnection; `dispose()` is only called in `_MafwMobileAppState.dispose()`.

2. **Lifecycle deduplication**: `pause()` guards `!_isResumed`, so multiple background events don't fire disconnect twice. `resume()` guards `_isResumed` similarly.

3. **Lazy WS connect**: 100ms delay is a pragmatic choice — enough for first frame to render, short enough to feel responsive. Could be tuned.

4. **Cache TTL eviction**: Lazy (on read) not proactive — acceptable for 50-message limit. A background sweep could be added later if needed.

5. **ProGuard rules**: Minimal set. If hive_ce or other plugins need additional rules, they'll surface as release-build crashes (caught during testing).

## Concerns

- **No Flutter SDK in CI**: Tests can't be validated here. Recommend running `flutter test` before merge.
- **hive_ce version**: `^2.10.0` is latest as of implementation. Check for compatibility with the project's Dart SDK constraint (`^3.13.0`).
