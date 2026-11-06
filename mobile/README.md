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
flutter analyze   # must be clean (CI gate)
flutter test
```

## Connecting to the gateway

The app talks to the desktop Orcalore (MAFW) gateway over Tailscale.

- **Preferred URL**: `http://<machine>.<tailnet>.ts.net:3000` (MagicDNS hostname;
  the pairing code prefers it via `mobile.tailscaleUrl`). Bare `100.x` / LAN IPs
  still work but show a warning; public cleartext hostnames are rejected.
- **Cleartext policy (two layers)**: the app itself (Dart/`package:http` sockets)
  allows `https`, `*.ts.net`, loopback, and private-LAN/bare-IP cleartext with a
  warning — public cleartext hostnames are **rejected**. Android's
  `network_security_config.xml` covers the platform native stack (media playback
  such as TTS via just_audio/ExoPlayer) and allowlists the `ts.net` domain tree;
  it uses `<domain includeSubdomains="true">ts.net</domain>` because a bare
  `<domain>ts.net</domain>` matches the exact host only and would block
  `machine.<tailnet>.ts.net`.
- **Tailscale DNS**: keep 「Use Tailscale DNS」 enabled on the phone (V2). If it is
  off, `*.ts.net` hostnames do not resolve even though Tailscale itself is up.
- **Required token**: set `MAFW_SERVER_API_TOKEN` (or `server.apiToken`) on the
  gateway — an empty token rejects every remote request with `401`. Env var names
  intentionally stay `MAFW_*`.
- **Gateway-side Tailscale URL**: `mobile.tailscaleUrl` in
  `~/.config/mafw/config.yaml`, or the `MAFW_MOBILE_TAILSCALE_URL` env override
  (env > config > auto-detected host). The pairing URL uses this value and is
  hot-reloaded.
- **Pairing deep link**: `orcalore://pair?...` (`orcalore` scheme, `pair` host).
  Legacy `mafw://pair` links are rejected — regenerate the QR code after
  upgrading the gateway. The Android intent-filter registers `orcalore://` only.
- **mDNS discovery** is LAN-only and provides no token; pair via QR or enter the
  URL + token manually.

## In-app diagnostics (dev-only)

「我的」→「调试」 is available in debug builds, and in release builds only when
built with `--dart-define=ORCALORE_DEBUG_PANEL=true`.

- **Connection card**: base URL, masked API token, WS state, last frame time, and
  a live `GET /health` probe.
- **Event inspector**: last 200 raw WS frames with their verdict
  (`canonical` / `flat` / `discarded` + reason) and the effect they triggered
  (e.g. `writing`, `refreshWork`).
- **HTTP log**: last 100 calls (method, path, status, duration, error body).
- **复制诊断包**: copies a JSON bundle with the API token masked — this is the
  standard log exit on a real device without USB/adb.

Background and the full troubleshooting table: `docs/architecture/mobile.md` §7.

## Contract notes (2026-11-02 breaking migration)

The client speaks **MAFW View DTO + canonical events** only. There is no
legacy-shape fallback; the gateway is the source of truth for both contracts
(`packages/gateway-sdk/src/view-dto.ts`, `packages/gateway-sdk/src/events.ts`).

- **History** — `GatewayClient.messages` calls
  `GET /api/sessions/:id/messages` (the default and only shape) and parses flat
  `{ id, sessionID, role, content: MafwPart[], time }`. The opencode wire
  envelope `{info, parts}` is **not** parsed; the `format` opt-in no longer
  exists.
- **Parts** — tool parts carry neutral identity: `toolClass`
  (readonly/search/file-edit/shell/subagent/web/plan/other) +
  `canonicalTool` (runtime-neutral name) + `state {status, input, output, …}`.
  `MafwPart.displayTool` prefers `canonicalTool`.
- **Events** — only the `mafw_event` envelope is unpacked
  (`{type:'mafw_event', data:{type, properties, sessionID}}`). Canonical inner
  names only: `turn.completed|failed|aborted`, `part.updated|delta|complete`,
  `message.updated`, `session.*`, `permission.*`, … Legacy `opencode_event`,
  `message.part.*`, `message.complete`, `message.error` and `session.idle`
  frames are ignored. `message.updated` carries the flat message in
  `properties.message`.
- **CI** — the Flutter job runs `flutter pub get && flutter analyze &&
  flutter test` when `mobile/**` or the shared View DTO / event vocabulary
  changes. Building an AAB stays a release gate, not a per-commit requirement.

Upgrading an installed app: this build requires a gateway that serves the flat
history contract and canonical `mafw_event` frames.
