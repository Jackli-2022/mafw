# Capability Kernel Phase 0/1 交付记录

- 日期：2026-11-12
- 版本：5.1.0（未 bump、未发布）
- 路线：B（并行 `kernel-v2`，契约门禁 + shadow，禁止 flag-day）
- Spec：`docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`
- 路线图：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- 详细 plan：`docs/superpowers/plans/2026-11-12-kernel-v2-phase0-1.md`

## 交付范围

Phase 0（契约）：

- `gateway/src/kernel-v2/manifest.ts`：manifest 纯校验（plane/kind/provides/integrity）。
- `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`：v2 不 import v1 组合根/provider registry；v1 不 import v2；入口无 ambient home/network。
- `packages/plugin-contract`：additive gateway/desktop plane 类型 + 校验；现有 client descriptor 不变。
- S1 spike 从 `spike/capability-registry-tts` @ `5a248271` port 到 `gateway/src/kernel-v2/`。
- `diagnostics.ts` / `capability-version.ts`：诊断字段与 apiVersion 兼容规则。
- `docs/guides/kernel-v2-cutover.md`：隔离/ shadow / cutover / rollback / decommission runbook。

Phase 1（内核 MVP + 只读 shadow）：

- `capability-registry.ts`：scope（global/project/session）、tier、priority、health、resolve cache、diagnostics、LIFO dispose。
- `provider-lifecycle.ts`：load → validate → resolve → activate → drain → dispose；safe mode/degraded；untrusted 无 worker 时 fail-closed。
- `providers/tts.ts` / `providers/usage.ts`：只读 adapter。
- `main.ts` / `facade.ts`：独立 v2 入口，`MAFW_KERNEL_V2_PORT` + `MAFW_KERNEL_V2_DATA_DIR` 必填；只读 `/health`、`/api/tts/voices`、`/api/usage`；`usage.json` record/replay。
- `scripts/kernel-v2-shadow.mjs`：v1/v2 normalized JSON 对比。

## 验证

- kernel-v2 + architecture + shadow：**71 tests / 71 pass**。
- plugin-contract：**38 tests / 38 pass**。
- gateway 全量：**6660 tests / 6660 pass**，连续两次 clean（run 3/4）。
  - run 2 出现过一次既存 `instance-ownership` 时序 flake（`takeover waits for the old owner to release`）；单文件重跑通过，run 3/4 连续 clean。未归因于 kernel-v2（v1 未 import v2）。
- `npx tsc --noEmit -p tsconfig.json`：通过。
- `node --check scripts/kernel-v2-shadow.mjs`：通过。

## 明确未做

- v2 未接 live gateway；v1 仍是默认入口。
- 没有写 live `~/.mafw`；没有 writes / dual-write。
- 没有 provider loader / 完整 tts/usage 数据迁移；shadow 使用 fixture / 内置 voice 数据。
- 没有 desktop UI 槽位（Phase 4）。
- 没有 worker 隔离（Phase 6）；untrusted 目前直接拒绝。
- 没有 media/ASR/memory/goal provider（Phase 2/5）。

## 关键 commit

- `517cf541` docs: freeze kernel-v2 invariants and conformance inventory
- `a1a292e7` feat(kernel-v2): add manifest validation and boundary guards
- `105c8bd6` docs: add kernel-v2 cutover runbook
- `fa84bfca` feat(plugin-contract): add gateway and desktop plane declarations
- `1b84ae11` feat(kernel-v2): port capability registry spike
- `0f37169d` feat(kernel-v2): add diagnostics and capability version contracts
- `d3107763` feat(kernel-v2): add scoped capability registry
- `62b256de` feat(kernel-v2): add provider lifecycle
- `0c2978cc` feat(kernel-v2): add tts provider adapter
- `ab122bb6` feat(kernel-v2): add usage provider adapter
- `2eb3b50b` feat(kernel-v2): add isolated read-only shadow entrypoint

## Next

Phase 2 先从 media 开始，ASR 前先做 S3（provider 拥有子进程的生命周期/ledger/health）。每个 provider 独立 plan + conformance kit；核心文件仍要求零改动。
