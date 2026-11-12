# Capability Kernel Phase 3 交付记录

- 日期：2026-11-12
- 版本：5.1.0（未 bump、未发布）
- 路线：B（并行 `kernel-v2`，v1 仍是默认入口）
- Spec：`docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`
- 路线图：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- 详细 plan：`docs/superpowers/plans/2026-11-12-kernel-v2-phase3-agent-tools-observer.md`

## 交付范围

Phase 3A（S5 canonical observer probe）：

- `gateway/src/kernel-v2/observer.ts`：只读 canonical observer registry；`dispatch()` 同步入队、`setImmediate` 调度、per-observer timeout、bounded queue、fail-open、diagnostics。
- `gateway/tests/helpers/kernel-v2/observer-conformance.ts`：conformance kit。
- `docs/research/2026-11-12-s5-canonical-event-observer-probe.md`：S5 结论与边界。

Phase 3B（plugin tool contribution）：

- `packages/plugin-contract/src/types.ts`：`PluginToolDescriptor` + `PluginGatewayContributes.tools`（additive）。
- `packages/plugin-contract/src/validate.ts`：tools 声明校验（name/description/inputSchema/timeout/scope/未知字段）。
- `gateway/src/kernel-v2/tools.ts`：`ToolContributionRegistry`；命名空间 `plugin:<package>:<tool>`；global/session scope；timeout；unknown/unhealthy/handler throw 全部转 tool error；输出 `MafwToolRegistration`。
- `gateway/tests/helpers/kernel-v2/tools-conformance.ts` + `gateway/tests/fixtures/kernel-v2/plugin-tool-echo.ts`。

Phase 3C（G3 harness）：

- `gateway/src/kernel-v2/canonical-event.ts`：EventFacets → 脱敏快照；剔除 token/secret/password/prompt/credential，深度/长度/数组上限。
- `gateway/tests/integration/kernel-v2-g3.test.ts`：fake runtime 通过 `RuntimeTools.registerTools` 调用插件 tool；observer 收到 tool 事件；坏 observer 不阻塞；快照无 secret。
- 边界守卫新增：kernel-v2 不 import `runtime/event-dispatch.ts`、`runtime/mafw-tools.ts`、`server/event-hub.ts`、`event-bus.ts`、`mcp/tool-registry.ts`、`mcp/tools.ts`。

## 验证

- Phase 3 定向（kernel-v2 + architecture + G3 + G2 + shadow）：**178 / 178 pass**。
  - Phase 2 定向基线 146 → 178，**新增 32 个测试**。
- plugin-contract：**40 / 40 pass**（Phase 2 基线 38 → 40，**新增 2 个**）。
- gateway 全量：**6962 passed / 1 skipped / 6963 total**，连续两次 clean。
  - 全量基线已包含其他会话的 E5a 身份闭环测试，不能把 6963 − 6768 的差值全部归因 Phase 3。
- `npx tsc --noEmit -p tsconfig.json`（gateway）：通过。
- `npx tsc --noEmit -p tsconfig.json`（plugin-contract）：通过。

## 明确未做

- 未接 live `runtime/event-dispatch.ts`；observer 仍不能在生产事件链上订阅。
- 未接 live `RuntimeTools.registerTools`；插件 tool 只在 fake runtime + conformance harness 中证明。
- 未实现 interceptor / veto / rewrite；observer 永远不是前置拦截器。
- 未实现 worker 隔离；同步阻塞的 observer 仍可能占住事件循环（Phase 6）。
- 未接 live gateway 数据，不写 `~/.mafw`。
- 人类验收/审批/权限/审计没有变化；新的 human/device 凭据契约（`human_principal_required`）不被 tool/observer 绕过。

## Rollback

- 本 phase 没有改变 v1 行为；回滚只需不注册 observer/tool。
- 单个 tool 回滚：`registry.register` 返回的 unregister 移除；session-scoped tool 随会话结束自然不可见。
- 单个 observer 回滚：unregister 或 `dispose()`，不影响其他 observer。
- 事件快照回滚：不调用 `toCanonicalEvent` 即可恢复原样。

## 关键 commit

- `0a150c29` docs: plan kernel-v2 phase 3 tools and observer
- `8c6b5f60` feat(kernel-v2): add canonical observer registry (S5)
- `506d8367` docs: record S5 canonical observer probe
- `31b46b81` feat(plugin-contract): add gateway tool declarations
- `08e6a02e` feat(kernel-v2): add plugin tool contribution registry
- `a253a040` test(kernel-v2): add tools conformance kit and package fixture
- `7030cbd0` feat(kernel-v2): add sanitized canonical event snapshot
- `ab628048` test(kernel-v2): prove G3 tools and observer harness

## Next

Phase 3.5 / Phase 4 live wiring：
- 先决定 observer 的 live hook（候选：`conformanceTap` 之后 + feature flag）。
- 再把 `ToolContributionRegistry.factory()` 接进 `activateRuntimeTools`，保持 fail-open。
- 然后进入 Phase 4：S4 menu item → desktop UI 槽位。
