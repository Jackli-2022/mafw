# kernel-v2

Phase 0/1/2 的并行内核模块。当前**不接 live gateway**，只被测试和独立 v2 入口使用。

## 来源

- `manifest.ts`：纯 manifest 校验。
- `capability-registry.ts`：从 `spike/capability-registry-tts` @ `5a248271` 的 `gateway/src/core/capability-registry.ts` port。
- `providers/tts-registry.ts`：从同一 spike 的 `gateway/src/tts/registry.ts` port，import 路径改为 kernel-v2。
- `providers/media.ts`、`providers/asr.ts`、`providers/asr-sidecar.ts`、`providers/commands.ts`、`providers/notifications.ts`、`providers/automation.ts`：Phase 2 新增的叶子 adapter。
- `subprocess-ledger.ts`、`probes/asr-subprocess.ts`：S3 子进程所有权/生命周期证明。

## port 差异

- 文件名从 `core/capability-registry.ts` 改为 `kernel-v2/capability-registry.ts`。
- TTS registry 从 `src/tts/registry.ts` 改为 `kernel-v2/providers/tts-registry.ts`；v1 原文件不动。
- logger / TTS 类型 import 改到 kernel-v2 相对路径。
- 保留 spike 的 tier（builtin/legacy/package）、default、fallback、list、dispose 行为。

## 边界

- 核心文件（`kernel-v2/*.ts`，除 `main.ts`/`facade.ts`）不 import `providers/**` 或 `probes/**`。
- provider 不 import v1 组合根 `kernel.ts` / `boot.ts` / `http/transport.ts`，也不 import `voice/registry.ts` / `media/media-plugin-loader.ts` / `commands/custom-exec.ts` 等单例。
- provider 只用 v1 叶子类型/纯函数（`media/media-service`、`voice/types`、`commands/custom-commands` 等）。
- guard 在 `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`。

## Phase 1.5

独立入口 `main.ts` 使用 `MAFW_KERNEL_V2_PORT` + `MAFW_KERNEL_V2_DATA_DIR`；缺失拒绝启动。runbook 见 `docs/guides/kernel-v2-cutover.md`。

## Phase 2

S3 → media → ASR → commands → notifications → automation action 已落地；G2 由 `gateway/tests/integration/kernel-v2-g2.test.ts` 证明。交付记录见 `docs/releases/2026-11-12-capability-kernel-phase2.md`。
