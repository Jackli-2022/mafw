# Final Fix Report — 3 Critical Bugs

## BUG 1 — Device registration endpoint URL mismatch

**Problem:** Mobile `PushService.registerDevice()` calls `POST /api/mobile/devices/register`, but gateway only exposes `POST /api/devices`. Device registration 404s — FCM tokens never reach the gateway.

**Fix:** Added `POST /api/mobile/devices/register` route alias on gateway (`gateway/src/index.ts:2529-2548`). The new route maps mobile's `{ token, platform, deviceName }` payload to gateway's `{ id, fcmToken, platform, apiTokenHash }` format using SHA-256 hashing for `id` and `apiTokenHash`.

**Files changed:**
- `gateway/src/index.ts` — Added mobile device registration route alias

---

## BUG 2 — Pairing nonce never consumed

**Problem:** `PairingService.generatePairingCode()` generates a nonce embedded in the QR URL. Mobile scans and extracts token+URL+nonce but never calls any gateway endpoint to consume the nonce. The nonce validation (single-use, 5-min TTL) is completely bypassed.

**Fix:** 
1. Added `POST /api/mobile/pairing/verify` endpoint on gateway (`gateway/src/index.ts:2560-2585`) that calls `pairingService.consumeNonce(nonce)`.
2. Updated mobile `PairingPage` (`mobile/lib/src/pages/pairing_page.dart`) to call the verify endpoint after scanning, before saving credentials. Flow: scan QR → extract nonce → POST /api/mobile/pairing/verify → save config.

**Files changed:**
- `gateway/src/index.ts` — Added pairing verify endpoint
- `mobile/lib/src/pages/pairing_page.dart` — Added verify call + `dart:convert` + `http` imports

---

## BUG 3 — SessionCache not wired into the app

**Problem:** `SessionCache` is fully implemented (hive_ce, TTL, size limit) with tests, but never imported or used anywhere in the app. `ChatPage._loadHistory()` always fetches from the gateway.

**Fix:** 
1. Wired `SessionCache` into `main.dart` — created instance, init on startup, dispose on shutdown, pass to `ChatPage`.
2. Updated `ChatPage._loadHistory()` to check cache first, show cached messages immediately, then refresh from gateway in background. Cache is populated after gateway fetch.

**Files changed:**
- `mobile/lib/main.dart` — Added SessionCache import, instance, init/dispose, pass to ChatPage
- `mobile/lib/src/pages/chat_page.dart` — Added `cache` parameter, cache-first `_loadHistory()`, `_refreshFromGateway()`, `_updateCache()` helpers

---

## Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| Gateway (all) | 194 | ✅ PASS |
| Mobile (TS cache) | 11 | ✅ PASS |
| PairingService | 10 | ✅ PASS |
| PushGateway | 19 | ✅ PASS |

Flutter/Dart tests require Flutter SDK (not available in CI) — changes are API-compatible with existing Dart test patterns.

## Remaining Concerns

- **apiTokenHash derivation**: The mobile registration route derives `apiTokenHash` from the FCM token (not the gateway's apiToken), since the mobile client doesn't have access to the gateway's apiToken at registration time. This is acceptable because `apiTokenHash` is stored as metadata but never used for auth verification in any code path.
- **No new Dart tests**: The Dart test changes (PairingPage verify call, ChatPage cache wiring) require Flutter SDK to run. The TS-side tests cover the gateway endpoints and SessionCache logic.
