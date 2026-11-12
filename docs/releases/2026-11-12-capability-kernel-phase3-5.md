# Capability Kernel Phase 3.5 交付记录

- 日期：2026-11-12
- 版本：5.1.0（未 bump、未发布）
- 路线：B（并行 `kernel-v2`，v1 默认路径；Phase 3.5 以 feature flag 接线）
- Spec：`docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`
- 路线图：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- 详细 plan：`docs/superpowers/plans/2026-11-12-kernel-v2-phase3-5-live-wiring.md`

## 交付范围

- `gateway/src/runtime/v2-live.ts`：唯一 live bridge；live 代码中只有它能 import `kernel-v2/**`。
  - `MAFW_KERNEL_V2_OBSERVERS=1` → `CanonicalObserverRegistry`
  - `MAFW_KERNEL_V2_TOOLS=1` → `ToolContributionRegistry`
  - 两个 flag 都关 → 返回 `null`，v1 行为不变。
- `gateway/src/runtime/event-dispatch.ts`：新增 `canonicalObserverTap` stage（`conformanceTap` 之后、`internalFilter` 之前）；stage 内部 try/catch，observer 抛错不 halt。
- `gateway/src/runtime/mafw-tools.ts`：`activateRuntimeTools` 新增可选 `extraTools`；plugin tools 合并到 builtin 六件套之后；merge 抛错只 warn 并回退 builtin。
- `gateway/src/kernel.ts`：
  - `initServices()` 创建 bridge（仅 flag 开启时）。
  - `buildDispatchCtx()` 注入 `canonicalObserverTap`。
  - 两个 `activateRuntimeTools` 调用点传入 `extraTools`。
  - `stop()` 释放 observer/tool registry。
  - 新增 `registerCanonicalObserver()` / `registerPluginTool()` 显式注册口；flag 关闭时抛带 env 名称的错误。
- 边界守卫：live 代码只有 `runtime/v2-live.ts` 可以 import `kernel-v2`；`kernel.ts` / `boot.ts` 不直接 import。

## 行为说明

- 默认（两个 env 都不设置）：事件链多一个空 stage（`canonicalObserverTap` 无回调时 no-op），tool factory 与之前完全一致。
- Observer live 位置在 `toolPrimitiveDrop` 之后，因此看不到 `tool.call` / `tool.delta` / `tool.result` 三原语；工具事件以 `part.updated`（tool part）形态出现。这是与 v1 canonical 链一致的语义。
- Observer 只读、post-hoc、fail-open；不能 veto/rewrite。
- Tool 名统一为 `plugin:<package>:<tool>`；session-scoped tool 只对注册会话可见。
- 人类验收/审批/权限/审计不变；`human_principal_required` 不被 observer/tool 绕过。

## 验证

- Phase 3.5 定向（kernel-v2 + v2-live + event-dispatch + mafw-tools + boundaries + G3/G2/shadow）：**238 / 238 pass**。
  - 新增测试：v2-live 5 + event-dispatch 2 + mafw-tools 2 + boundaries 1 = **10**。
- gateway 全量：**6972 passed / 1 skipped / 6973 total**，连续两次 clean。
- `npx tsc --noEmit -p tsconfig.json`（gateway）：通过。

## 明确未做

- plugin host 还没有自动把 `plugin.json` 的 tools/observers 注册进 bridge；目前通过 `MafwScheduler.register*` 显式注册。
- 没有 interceptor / veto / rewrite。
- 没有 worker 隔离；同步阻塞 observer 仍可能占住事件循环（Phase 6）。
- 没有默认打开任何 flag；生产默认行为与 Phase 3 相同。
- 没有 desktop UI 槽位（Phase 4）。

## Rollback

- 删除 `MAFW_KERNEL_V2_OBSERVERS` / `MAFW_KERNEL_V2_TOOLS` 即回到 Phase 3 行为。
- 单个 observer/tool：使用 `register*` 返回的注销函数，或重启 gateway。
- 不需要回滚数据；本 phase 不写 live DB。

## 关键 commit

- `e8c3f9e8` docs: plan kernel-v2 phase 3.5 live wiring
- `ebd26abf` feat(runtime): add kernel-v2 live bridge behind flags
- `3f5f97f8` feat(runtime): add canonical observer dispatch stage
- `222ca855` feat(runtime): merge plugin tools into runtime registration
- `4024fab7` feat(kernel): wire kernel-v2 observer and tools behind flags

## Next

Phase 4：S4 menu item end-to-end → `desktop.ui.menuItems` → composer action → panel rail。Phase 3.5 的 plugin host 自动注册可以在 Phase 4 之前补，也可以随统一插件包安装流程一起做。
