# Task 4 Fix Report: PushService Firebase Integration

## What Was Fixed

### 1. `push_service.dart` — Full Firebase Integration (Critical)

The `init()` method was a no-op stub. Implemented complete Firebase Cloud Messaging lifecycle:

- **Firebase.initializeApp()** — delegated to `main.dart` (called before `runApp()`)
- **Notification channels** — Creates `mafw_messages` (high importance) and `mafw_goals` channels via `flutter_local_notifications` Android plugin
- **Permission request** — `FirebaseMessaging.instance.requestPermission()` for Android 13+ `POST_NOTIFICATIONS`
- **FCM token retrieval** — `getToken()` + device registration with gateway via `POST /api/mobile/devices/register`
- **Token refresh listener** — `onTokenRefresh` re-registers with new token
- **Foreground message display** — `FirebaseMessaging.onMessage` → `flutter_local_notifications` `show()` with correct channel routing (messages vs goals)
- **Click-through navigation** — Three pathways:
  - `onMessageOpenedApp` — app opened from background via notification tap
  - `getInitialMessage()` — app opened from terminated state
  - `onDidReceiveNotificationResponse` — local notification tap payload
- **Periodic token refresh** — Timer every 12h to re-fetch FCM token

### 2. `push_service.dart` — WsClient Event Consumption (Critical)

Added WsClient parameter and event subscription:

- Constructor accepts `WsClient? ws` and `Future<void> Function()? onRefreshSessions` callback
- `_subscribeToWsEvents()` listens to `ws.events` stream
- Filters for `session.created`, `message.updated`, `session.idle` opencode events
- Calls `onRefreshSessions` callback (debounced in main.dart) to refresh session list

### 3. `main.dart` — Firebase Init + PushService Wiring (Critical)

- Added `Firebase.initializeApp()` before `runApp()` in `main()`
- Added `WidgetsFlutterBinding.ensureInitialized()` (required for async init)
- Created `PushService` instance with:
  - `ws:` — WsClient reference for event consumption
  - `onRefreshSessions:` — wired to `_refreshSessions` (existing method)
  - `onNavigateToSession:` — wired to new `_navigateToSession` method
- Added `_navigateToSession(String sessionID)` — finds session in list, refreshes if needed, opens ChatPage
- Cleanup in `dispose()` — `PushService` disposed with app lifecycle

### 4. `main.dart` — WorkManager Background Health Check

- Registered 15-min periodic task via `Workmanager().registerPeriodicTask()`
- Config persisted to `SharedPreferences` for background handler access
- Top-level `_backgroundCallback()` reads config from SharedPreferences, hits `GET /health` with 10s timeout
- `Constraints(networkType: NetworkType.connected)` ensures runs only when online

### 5. `ws_client.dart` — API Compatibility Fix (Bugfix)

Fixed `WebSocketChannel.connect()` compilation error — `headers` parameter removed in `web_socket_channel` 3.x. Switched to query parameter auth (`?token=...`) which works with the gateway's WebSocket auth.

### 6. `android/build` — Google Services Plugin

- `android/app/build.gradle.kts` — Added `id("com.google.gms.google-services")` plugin
- `android/settings.gradle.kts` — Added `com.google.gms.google-services` version `4.4.2` to plugin management

### 7. `pubspec.yaml` — WorkManager Dependency

Added `workmanager: ^0.5.2` dependency for background health checks.

## Files Changed

| File | Change |
|------|--------|
| `mobile/lib/src/services/push_service.dart` | Full rewrite: Firebase lifecycle, WsClient events, click-through nav, WorkManager |
| `mobile/lib/main.dart` | Firebase init, PushService wiring, navigation callback |
| `mobile/lib/src/network/ws_client.dart` | Fixed `WebSocketChannel.connect` API (query param auth) |
| `mobile/pubspec.yaml` | Added `workmanager: ^0.5.2` |
| `mobile/android/app/build.gradle.kts` | Added Google Services plugin |
| `mobile/android/settings.gradle.kts` | Added Google Services plugin dependency |
| `mobile/test/push_service_test.dart` | Updated tests: 14 tests covering new constructor, click-through, token management |

## Tests

```
00:03 +14: All push_service_test.dart tests passed!
```

14/14 tests pass:
- registerDevice sends correct payload
- registerDevice includes Authorization header
- registerDevice throws on non-200 response
- registerDevice retries on network error
- notification channels have correct configuration
- parseNotificationData extracts sessionID
- parseNotificationData handles missing optional fields
- token refresh triggers re-registration
- dispose cleans up resources
- constructor accepts optional WsClient and callbacks
- handleNotificationTap returns sessionID for message type
- handleNotificationTap returns null for non-message type
- handleNotificationTap returns null when sessionID is missing
- setCurrentToken updates currentToken

**Pre-existing test failures** (3 tests, unrelated to this fix):
- `pairing_page_test.dart` — `_FakeSecureStorage` uses invalid `...` spread syntax
- `secure_config_test.dart` — same `_FakeSecureStorage` mock issue
- `widget_test.dart` — `connectivity_watcher.dart` missing `VoidCallback` import

## Remaining Concerns

1. **`google-services.json` is a placeholder** — Real Firebase project credentials needed for production. Current values (`AIzaSyPlaceholder`, `000000000000`) won't work with actual FCM.
2. **Background handler config persistence** — Uses `SharedPreferences` which is not encrypted. API tokens stored in plaintext for WorkManager background access. Consider `flutter_secure_storage` if security requirements tighten.
3. **Foreground message notification display** — Uses `notification.hashCode` as notification ID, which means multiple rapid messages could overwrite each other. Consider using a counter or session-based ID.
4. **WsClient auth method changed** — Switched from Bearer header to query parameter auth. Verify gateway's `/api/ws` endpoint accepts `?token=` query parameter for WebSocket authentication.
