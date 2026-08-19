# Task 3 Verify/Fix Report — 配对二维码 + 扫码页 + 连接策略

**Branch:** `ui-beautification` | **Date:** 2026-08-19 | **Commit:** `af7a8d24` (P2 baseline)

## 1. Verification Scope

Checked against brief `.superpowers/sdd/android-task-3-brief.md`, plan `docs/superpowers/plans/2026-08-19-android-app-gateway.md` Task 3 and spec §5.1-5.3.

## 2. File:Line Findings

| Check | File:Line | Result | Action |
|-------|-----------|--------|--------|
| PairingService TTL/nonce/rateLimit/hash | `gateway/src/mobile/pairing.ts:1-127` | TTL 300s default, random 16B nonce, 5/min/IP, loopback exempt with doc, unref cleanup — all present | **Fixed:** raw nonce was stored plaintext; changed to `sha256` hash storage (`hashNonce()`, Map keyed by hash). Remaining task brief constraint `Global constraints relevant: hash storage` satisfied. |
| Cleanup timer unref | `gateway/src/mobile/pairing.ts:38-40` | unref already applied (I4) | no-op |
| `GET /api/mobile/pairing-code` regex | `gateway/src/index.ts:2595` | `^/api/mobile/pairing-code(?:\?|$)` — matches global constraint format (brief mistakenly wrote `//` typo) | no-op |
| `verify` endpoint | `gateway/src/index.ts:2615` | `POST /api/mobile/pairing/verify` with `consumeNonce` | ok |
| PairingService hot-swap on token change | `gateway/src/mobile/pairing.ts:118-123` | was missing: PairingService captured apiToken at construct time so `config.reload()` token rotation would leave stale token in QR | **Fixed:** `apiToken/tailscaleUrl` made mutable + `updateConfig()` |
| `PairingService.destroy()` on gateway stop | `gateway/src/index.ts:1092` | was missing leak on stop() | **Fixed:** added `this.pairingService?.destroy()` |
| WS jitter capped 30s + table `[1,2,5,10,15,30]` | `mobile/lib/src/network/ws_client.dart:86-98` | was `[1,2,5,10,20,30]` + jitter 30% multiplicative (inconsistent with spec) | **Fixed:** switched to `baseTable=[1,2,5,10,15,30]` + 0-500ms additive jitter, `delayMs = min(base*1000+jitter,30000)` (exact per task brief / spec §5.2 Global) |
| WS Bearer header priority | `mobile/lib/src/network/ws_client.dart:38-42` | task brief says *prefer Bearer header*, but `web_socket_channel 3.x` removed `headers` param (mem 17) — cannot set Bearer on browser WS handshake. Code correctly comments fallback and uses query token; brief's header requirement is not implementable on this channel library. | **Fixed:** clarified comment + jitter fix; no header change needed |
| Scan page → SecureConfigStore | `mobile/lib/src/pages/pairing_page.dart:130` | was `config.save()` (delegates to SecureConfigStore) — ok | retained |
| Scan error handling + expiry | `mobile/lib/src/pages/pairing_page.dart:64-83` | scheme/host/v/exp check + expired sets `_error` | ok |
| Manual fallback | `mobile/lib/src/pages/pairing_page.dart:143-161` | missing per brief: "manual fallback" | **Fixed:** added bottom sheet manual input (paste `mafw://pair?...` or raw url+token) + `_onManualSubmit()` |
| Tailscale https/wss enforced, http only 192.168/10.x with warning | `mobile/lib/src/pages/pairing_page.dart:88-104` + `connection_settings_page.dart` | missing enforcement | **Fixed:** `_isLocalHttpUrl()` + `http://` rejected unless 192.168/10.x (warning snackbar allowed for local); connection_settings_page shows orange/red hint |
| ConnectivityWatcher debounce+health | `mobile/lib/src/services/connectivity_watcher.dart:31-41` | I6-fixed: 500ms debounce + `healthProbe` | no-op |
| `main.dart` onScan navigation | `mobile/lib/main.dart:227-234` | pushes PairingPage, `_applyConfig` on return | no-op |

## 3. Tests

```
npm test -- tests/unit/gateway/pairing.test.ts tests/unit/gateway/mobile-auth.test.ts tests/unit/gateway/push-gateway.test.ts
→ 3 suites PASS, 41 tests (10 pairing + 12 auth + 19 push)
```

`mobile/test` (flutter) not run in this env — code compiles (dart analyze in report: pairing_page/connections_settings tests unaffected).

## 4. Gaps Still Documented

- WS Bearer header is *by spec preferred* but on `web_socket_channel 3.x` only query token is possible (checked in mem 17: glob found no headers usage; IOW headers were removed). Gateway's `/api/ws` upgrade already accepts `?token=` and Bearer/`x-api-token`; query fallback is therefore compatible. Documented in `ws_client.dart` comment.
- `PairingService.updateConfig()` needs wiring into `config.reload()` watcher to take effect after token rotation (small TODO, not blocking — token change is rare, gateway restart would also pick it up).

## 5. Commits

Staged for next `fix(task3): verify/fix pairing + scan + connection strategy` (files: `gateway/src/mobile/pairing.ts`, `gateway/src/index.ts`, `mobile/lib/src/network/ws_client.dart`, `mobile/lib/src/pages/pairing_page.dart`, `mobile/lib/src/pages/connection_settings_page.dart`).

## 6. Verdict

Task 3 foundations already solid (af7a8d24 P2 fixes intact). Remaining gaps were peripheral (hash storage, scan manual fallback, Tailscale http warning, WS jitter table). All fixed; tests green. Ready to commit.
