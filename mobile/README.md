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

## Contract notes (2026-11-02 breaking migration)

The client speaks **MAFW View DTO + canonical events** only. There is no
legacy-shape fallback; the gateway is the source of truth for both contracts
(`packages/gateway-sdk/src/view-dto.ts`, `packages/gateway-sdk/src/events.ts`).

- **History** — `GatewayClient.messages` requests
  `GET /api/sessions/:id/messages?format=flat` and parses flat
  `{ id, sessionID, role, content: MafwPart[], time }`. The opencode wire
  envelope `{info, parts}` is **not** parsed. `format=flat` is explicit only
  during the transition; it disappears when the gateway default flips.
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
`format=flat` outlet and canonical `mafw_event` frames.
