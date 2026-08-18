# Android Task 2 Fix Report

## What Was Fixed

Three critical issues found in the Task 2 review where PushGateway and DeviceStore were implemented but never integrated into the gateway runtime.

### 1. PushGateway Dead Code → Wired Into Gateway

**Root Cause:** `PushGateway` and `DeviceStore` existed in `gateway/src/mobile/` but were never imported or instantiated in `gateway/src/index.ts`. The broadcast method never called PushGateway, and WS connections never registered with it.

**Fix:**
- Imported `PushGateway` and `DeviceStore` in `gateway/src/index.ts` (line 46-47)
- Added `pushGateway?: PushGateway` property to `MafwScheduler` class (line 236)
- Instantiated `DeviceStore` + `PushGateway` in `initServices()` with persistent storage at `~/.mafw/devices.json` (lines 1145-1149)
- Added `POST /api/devices` HTTP endpoint for mobile device registration (lines 2489-2509)
- Wired WS upgrade handler to extract `?deviceId=` query param and call `pushGateway.addOnlineWs()` (lines 3313-3324)
- Wired `ws.on('close')` and `ws.on('error')` to call `pushGateway.removeOnlineWs()` (lines 3258-3267)
- Added `pushGateway.onBroadcast(event)` call in `broadcast()` method (lines 970-972)
- Added `pushGateway.destroy()` in `stop()` for cleanup (line 1086)

### 2. 3x Exponential Backoff on Send Failure

**Root Cause:** When `ws.send()` failed, the device was immediately removed with no retry. A transient network blip would permanently disconnect the device.

**Fix:** In `push-gateway.ts:onBroadcast()`, replaced single `ws.send()` with 3-attempt retry loop:
- Attempt 0: immediate
- Attempt 1: 100ms delay (2^0 × 100ms)
- Attempt 2: 200ms delay (2^1 × 100ms)
- After 3 failures: device removed from online tracking
- Checks `ws.readyState === OPEN` before each attempt

### 3. Prune Threshold Fixed From 30s to 60s

**Root Cause:** The WS heartbeat terminated connections after a single missed pong (30s). The spec requires "30s ping / 60s prune" — i.e., 2 consecutive missed pongs.

**Fix:** Replaced boolean `isAlive` with counter-based tracking:
- Added `missedPongs` counter on each WS connection (initialized to 0)
- `ws.on('pong')` resets both `isAlive = true` and `missedPongs = 0`
- First missed pong: `missedPongs = 1`, connection kept alive
- Second missed pong: `missedPongs >= 2`, connection terminated
- Effective prune threshold: 2 × 30s = 60s
- All prune paths also clean up PushGateway online tracking via `removeOnlineWs()`

## What Was Tested

- **TypeScript compilation:** `npx tsc --noEmit` — zero errors
- **Full build:** `npm run build` — succeeds
- **Manual review:** All modified code paths verified for correctness

## Files Changed

| File | Changes |
|------|---------|
| `gateway/src/index.ts` | +80 lines: imports, instantiation, WS lifecycle wiring, broadcast integration, HTTP endpoint, prune threshold fix, cleanup |
| `gateway/src/mobile/push-gateway.ts` | +21 lines: 3x exponential backoff in onBroadcast() |

## Remaining Concerns

1. **FCM push not implemented:** PushGateway currently only tracks online WS devices. The `fcmToken` stored in DeviceStore is not used for actual push notifications. When a device is offline, events are silently dropped. A future task should implement FCM push delivery for offline devices.

2. **No automated tests:** No unit tests exist for PushGateway or DeviceStore. Consider adding tests for:
   - Device registration/removal
   - Online/offline tracking
   - Backoff retry logic
   - Prune threshold behavior

3. **Device identification:** The current implementation relies on `?deviceId=` query parameter in the WS upgrade URL. This is functional but could be enhanced with token-based device authentication.
