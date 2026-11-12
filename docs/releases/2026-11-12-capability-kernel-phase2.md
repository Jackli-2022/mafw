# Capability Kernel Phase 2 交付记录

- 日期：2026-11-12
- 版本：5.1.0（未 bump、未发布）
- 路线：B（并行 `kernel-v2`，v1 仍是默认入口）
- Spec：`docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`
- 路线图：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- 详细 plan：`docs/superpowers/plans/2026-11-12-kernel-v2-phase2-leaf-providers.md`

## 交付范围

Phase 2A（S3 子进程 probe）：

- `gateway/src/kernel-v2/subprocess-ledger.ts`：子进程所有权（provider/external）、状态、LIFO dispose、失败隔离。
- `gateway/src/kernel-v2/probes/asr-subprocess.ts`：sidecar-owning provider；懒启动、single-flight、启动失败/超时记录、adopted 不 kill、health 缓存。
- `docs/research/2026-11-12-s3-asr-subprocess-probe.md`：S3 结论与未决项。

Phase 2B（media）：

- `gateway/src/kernel-v2/providers/media.ts`：media engine 解析；unknown/unsupported/unhealthy fallback 与 v1 `resolveMediaPrompt` 一致。
- `gateway/tests/helpers/kernel-v2/media-conformance.ts`：conformance kit。
- `gateway/tests/fixtures/kernel-v2/media-echo-provider.ts`：测试包 provider。

Phase 2C（ASR）：

- `gateway/src/kernel-v2/providers/asr.ts`：ASR capability adapter（resolve/list/available）。
- `gateway/src/kernel-v2/providers/asr-sidecar.ts`：sidecar provider 绑定；sync health 读取缓存；dispose 移除注册并停子进程。
- `gateway/tests/helpers/kernel-v2/asr-conformance.ts`：conformance kit。
- `gateway/tests/fixtures/kernel-v2/asr-fake-provider.ts`：测试包 engine。

Phase 2D（commands）：

- `gateway/src/kernel-v2/providers/commands.ts`：command source 合并（builtin → legacy → package），坏 source fail-open，LIFO dispose。
- `gateway/tests/helpers/kernel-v2/commands-conformance.ts`：conformance kit。
- `gateway/tests/fixtures/kernel-v2/command-package-source.ts`：测试包 source。

Phase 2E（notifications）：

- `gateway/src/kernel-v2/providers/notifications.ts`：出站通知 fan-out；单 channel 失败隔离；unhealthy skip；push adapter。
- `gateway/tests/helpers/kernel-v2/notifications-conformance.ts`：conformance kit。
- `gateway/tests/fixtures/kernel-v2/notification-webhook-channel.ts`：测试包 channel。

Phase 2F（automation action）：

- `gateway/src/kernel-v2/providers/automation.ts`：action provider；missing/unhealthy/handler throw 全部 fail-closed 返回结果。
- `gateway/tests/helpers/kernel-v2/automation-conformance.ts`：conformance kit。
- `gateway/tests/fixtures/kernel-v2/automation-echo-action.ts`：测试包 action。

Phase 2G（G2）：

- `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`：核心不 import provider/probe；provider 不 import v1 组合根/单例。
- `gateway/tests/integration/kernel-v2-g2.test.ts`：测试包替换 media/ASR/TTS/usage，以及新增 commands/notifications/automation action。
- `gateway/src/kernel-v2/capability-registry.ts`：新增单条 `remove()`，供 provider dispose 精确注销。

## 验证

- 定向门禁（kernel-v2 + architecture + G2 + shadow）：**146 tests / 146 pass**。
- gateway 全量：**6768 tests / 6768 pass**。
  - run 1 clean；run 2 出现既存 `instance-ownership` 时序 flake（`takeover waits for the old owner to release`），单文件重跑 6/6 通过；run 3、run 4 连续 clean。
  - 未归因 kernel-v2：v1 未 import v2，Phase 2 未改 v1 路径。
- `npx tsc --noEmit -p tsconfig.json`：通过。
- Phase 1 基线 6693 → Phase 2 6768，**新增 75 个测试**。

## 明确未做

- v1 `MafwScheduler` 仍是默认入口，零行为变化。
- v2 未接 live gateway，不写 live `~/.mafw`。
- 没有 provider package loader / 安装流程；G2 的“测试包”是测试内直接注册 `package` tier。
- 没有 desktop UI 槽位（Phase 4）。
- 没有 worker 隔离；untrusted provider 仍 fail-closed 拒绝（Phase 6）。
- embedding / reranker 未做，已移到 Phase 5。
- 没有把 notifications 接到 live broadcast；只有 capability + push 结构适配器。

## Rollback

- 本 phase 没有改变 v1 行为；回滚只需删除 kernel-v2 provider 注册或回退本次提交。
- 单个 provider 回滚：移除 `register*` 调用，registry 自动回退到下一 tier / 默认实现。
- 子进程回滚：删除 `bindAsrSidecar` 注册；`provider.dispose()` 会停掉 owned child，adopted 进程不受影响。

## 关键 commit

- `a70e53de` docs: plan kernel-v2 phase 2 leaf providers
- `33ffde62` feat(kernel-v2): add subprocess ledger
- `1c289929` feat(kernel-v2): prove sidecar-owning provider lifecycle (S3)
- `fa4bf3e9` docs: record S3 ASR subprocess probe
- `2426fd6e` feat(kernel-v2): add media provider adapter
- `6c27e8c1` test(kernel-v2): add media conformance kit and package fixture
- `00e83095` feat(kernel-v2): add asr provider adapter
- `7577590c` feat(kernel-v2): bind sidecar asr provider with fallback
- `73f45224` feat(kernel-v2): add command source capability
- `ec315de2` feat(kernel-v2): add notification channel capability
- `deebddde` feat(kernel-v2): add automation action capability
- `06a6b415` test(kernel-v2): guard core/provider import direction
- `4aff0538` test(kernel-v2): prove G2 package provider replacement

## Next

Phase 3：S5 canonical event observer probe → tools contribution → read-only event observer。先证明 observer 在超时/异常时 fail-open，且不阻塞 SSE / 100ms recall。
