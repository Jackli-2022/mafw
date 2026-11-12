# kernel-v2

Phase 0/1 的并行内核模块。当前**不接 live gateway**，只被测试和独立 v2 入口使用。

## 来源

- `manifest.ts`：本 phase 新增，纯 manifest 校验。
- `capability-registry.ts`：从 `spike/capability-registry-tts` @ `5a248271` 的 `gateway/src/core/capability-registry.ts` port。
- `providers/tts-registry.ts`：从同一 spike 的 `gateway/src/tts/registry.ts` port，import 路径改为 kernel-v2。

## port 差异

- 文件名从 `core/capability-registry.ts` 改为 `kernel-v2/capability-registry.ts`。
- TTS registry 从 `src/tts/registry.ts` 改为 `kernel-v2/providers/tts-registry.ts`；v1 原文件不动。
- logger / TTS 类型 import 改到 kernel-v2 相对路径。
- 保留 spike 的 tier（builtin/legacy/package）、default、fallback、list、dispose 行为。

## 边界

- 不 import v1 `kernel.ts` / `boot.ts` / `http/transport.ts` / `tts/registry.ts` / `usage/plugin-loader.ts` / `plugins/package-host.ts`。
- 只 import 契约与纯类型；guard 在 `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`。

## Phase 1.5

独立入口 `main.ts` 使用 `MAFW_KERNEL_V2_PORT` + `MAFW_KERNEL_V2_DATA_DIR`；缺失拒绝启动。runbook 见 `docs/guides/kernel-v2-cutover.md`。
