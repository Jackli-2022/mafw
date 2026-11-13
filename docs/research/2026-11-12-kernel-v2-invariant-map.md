# Kernel v2 invariant → guard / conformance map

- 日期：2026-11-12
- 目的：Phase 0/1 的“不变量有 owner、守卫或 conformance kit”清单
- 规则：没有现有守卫的，标 `GAP` 并在对应 phase 补测；不把“实现存在”当作守卫。

## Gateway

| 不变量 | 现有守卫 / 测试 | 状态 | 说明 |
|---|---|---|---|
| 人类验收只允许人类（带 `actorSessionID` → 403） | `gateway/tests/unit/pod/pod-accept-route.test.ts` | OK | route 级测试 |
| 计划批准绑定 `planHash` / `evalHash` | `gateway/tests/unit/pod/plan-approval-hash.test.ts` | OK | hash 变更作废旧批准 |
| 记忆 soft supersede，不物理删除 | `gateway/tests/unit/superseded-resolve.test.ts` | OK | 出口撤销 superseded |
| `distinct_from` 双向禁止合并 | `gateway/tests/unit/memory/distinct-from.test.ts` | OK |  |
| `pinned` / `sticky` 披露层 | `gateway/tests/unit/pinned-recall.test.ts`、`sticky-memory.test.ts`、`pin-memory-sticky.test.ts` | OK |  |
| worker 输出不回流 T1 | `gateway/tests/unit/memory/worker-origin.test.ts`、`recall/worker-origin.test.ts` | OK |  |
| 边界 recall 100ms 硬契约 | `gateway/tests/unit/recall-context-scan-budget.test.ts`、`gateway/tests/unit/core/memory/bm25-token-cache.test.ts` | OK | 客户端 abort + BM25 缓存 |
| 日衰减批量写 | `gateway/tests/unit/memory/decay-batching.test.ts` | OK |  |
| MinHash 写路径合并退役 | `gateway/tests/unit/memory/minhash-retired.test.ts` | OK |  |
| canonical 事件顺序 / 广播 | `gateway/tests/unit/runtime/event-broadcast.test.ts`、`event-field-contract.test.ts` | OK |  |
| 未知/非法 runtime 事件 fail-closed | `gateway/tests/unit/runtime/conformance-scenarios.test.ts`、`adapter-event-mapper.test.ts` | OK |  |
| 历史出口 flat `{ data, nextCursor }` | `gateway/tests/unit/runtime/conformance-scenarios.test.ts`、`canonical-types.test.ts` | OK |  |
| 缺失能力中性 503，不含 runtime/capability 名 | `gateway/tests/unit/runtime/route-surface-catalog.test.ts`、`architecture-boundaries.test.ts` | OK |  |
| `SessionCreateOpts.directory` 必填绝对路径 | `packages/runtime-core/src/core.test.ts`、`gateway/tests/unit/runtime-root.test.ts` | OK |  |
| 路由 catalog / attach 顺序 | `gateway/tests/unit/architecture/legacy-route-inventory.test.ts`、`runtime/route-surface-catalog.test.ts` | OK |  |
| kernel 拆分守卫 | `gateway/tests/unit/architecture/kernel-split-guards.test.ts` | OK |  |
| DB migration / 原子写 | `gateway/tests/unit/gateway-db-*.test.ts`、`gateway/tests/unit/memory/a5-schema-writeback.test.ts` | OK |  |
| capability manifest / plane | 本 phase Task 0.2/0.4 新增 | GAP→新增 |  |
| provider lifecycle / dispose | 本 phase Task 1.2 新增 | GAP→新增 |  |
| diagnostics / versioning | 本 phase Task 0.6 新增 | GAP→新增 |  |
| 核心不 import provider；provider 不 import v1 组合根 | `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`（Phase 2 Task 2.11） | OK | 静态 import 扫描 |
| 子进程 provider 无 orphan / adopted 不 kill | `gateway/tests/unit/kernel-v2/subprocess-ledger.test.ts`、`asr-subprocess-probe.test.ts`（S3） | OK | ledger + probe |
| media fallback 语义 | `gateway/tests/unit/kernel-v2/media-provider.test.ts`、`media-conformance.test.ts` | OK | conformance kit |
| ASR sidecar fallback | `gateway/tests/unit/kernel-v2/asr-sidecar-provider.test.ts` | OK | builtin health → package tier |
| notification fan-out 失败隔离 | `gateway/tests/unit/kernel-v2/notifications-provider.test.ts` | OK | 单 channel 失败不影响其他 |
| automation action missing/unhealthy fail-closed | `gateway/tests/unit/kernel-v2/automation-provider.test.ts` | OK | 规则调度仍为核心 |
| observer 只读/fail-open/不阻塞 | `gateway/tests/unit/kernel-v2/observer.test.ts`、`observer-conformance.test.ts`（S5） | OK | 同步入队 + timeout + bounded queue |
| observer 快照脱敏 | `gateway/tests/unit/kernel-v2/canonical-event.test.ts` | OK | token/secret/prompt/credential 剔除 |
| plugin tool 命名空间/失败隔离/scope | `gateway/tests/unit/kernel-v2/tools.test.ts`、`tools-conformance.test.ts` | OK | `plugin:<package>:<tool>` |
| G3 tools + observer 闭环 | `gateway/tests/integration/kernel-v2-g3.test.ts` | OK | fake runtime |
| live 接线仅一个 bridge import kernel-v2 | `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`（Phase 3.5） | OK | `runtime/v2-live.ts` |
| feature flag 关闭零行为变化 | `gateway/tests/unit/runtime/v2-live.test.ts` | OK | 两 flag 都关 → bridge null |
| observer live stage fail-open | `gateway/tests/unit/runtime/event-dispatch.test.ts` | OK | 抛错仍继续 finalBroadcast |
| plugin tool live merge fail-open | `gateway/tests/unit/runtime/mafw-tools.test.ts` | OK | extraTools 抛错回退 builtin |
| package tools/observers 校验与投影 | `gateway/tests/unit/plugins/package-validator.test.ts` | OK | tools/observers 不留在 legacy |
| package commit/remove 发布 entries | `gateway/tests/unit/plugins/package-host.test.ts` | OK | revision + 空数组退订 |
| package entries → live bridge diff | `gateway/tests/unit/runtime/v2-live.test.ts` | OK | revision 替换 / 移除退订 |
| package tools/observers 端到端 | `gateway/tests/integration/kernel-v2-plugin-host.test.ts` | OK | PluginHost + v2-live |

## Desktop

| 不变量 | 现有守卫 / 测试 | 状态 | 说明 |
|---|---|---|---|
| renderer sandbox / preload allowlist | `packages/desktop/src/main/windows.ts` + `shared/browser-policy.ts`；`plugin-web-session.test.ts` | 部分 | 需要 source-level guard 断言 config |
| webview 不拿 gateway apiToken，走 per-surface ticket | `packages/desktop/src/main/plugin-web-session.test.ts` | OK | ticket/path allowlist |
| webview attach 强制 preload / 无 Node | `plugin-web-session.test.ts` | OK |  |
| plugin descriptor 纯数据、无 Host code | `packages/plugin-contract/src/validate.test.ts`、`packages/desktop/src/renderer/mafw/plugins/*.test.ts` | OK |  |
| 插件 action package-local | `packages/plugin-contract/src/validate.test.ts` | OK |  |
| 主题 token 单源 | `packages/desktop/src/renderer/mafw/visual-language-css.test.ts`、`theme-merge-css.test.ts` | OK |  |
| UI 槽位 revision/stale guard | `packages/desktop/src/renderer/mafw/plugins/*.test.ts` | OK |  |
| 菜单贡献 grammar / surface / action 引用 | `packages/plugin-contract/src/validate.test.ts`、`packages/desktop/src/renderer/mafw/context-menu/contributions.test.ts` | OK | S4 |
| 菜单贡献 revision / unload | `packages/desktop/src/renderer/mafw/plugins/plugin-menu-contributions.test.ts` | OK | S4 |
| 菜单 action 路由 | `packages/desktop/src/renderer/mafw/plugins/plugin-menu-contributions.test.ts` | OK | S4 |
| composer action 校验 / 插入草稿 / 失败隔离 | `packages/plugin-contract/src/validate.test.ts`、`packages/desktop/src/renderer/mafw/plugins/plugin-composer-actions.test.ts` | OK | 2026-11-13 |
| composer action 宿主渲染 | `packages/desktop/src/renderer/mafw/components/plugin-composer-wiring.test.ts` | OK | 宿主 ButtonV2 + Icon |
| panel rail entry 校验 / 投影 / 打开路径 | `packages/plugin-contract/src/validate.test.ts`、`packages/desktop/src/renderer/mafw/plugins/plugin-view-model.test.ts`、`plugin-web-wiring.test.ts` | OK | 复用 `openPluginFocus` |
| capability manifest / plane | 本 phase Task 0.4 新增 | GAP→新增 | shared contract |
| desktop cutover 并行窗口 | Phase 4 | GAP | 不在 Phase 0/1 |

## Conformance kit ownership（Phase 2+）

| 能力 | kit 负责 | 最早 phase |
|---|---|---|
| runtime | flat history / fail-closed / 503 / absolute directory | Phase 2 |
| memory | soft supersede / T1 / 100ms / scope | Phase 5 |
| tools | schema / permission / error isolation / session scope | Phase 3 |
| TTS | default/override/fallback/dispose/stream | Phase 1 |
| usage | provider resolution / fallback / record-replay | Phase 1 |
| UI | descriptor / order / dedupe / action / teardown | Phase 4 |

## 评审签核

- Spec review：GLM-5.3，2026-11-12，结论 With fixes；Critical/Important 已修，见 `docs/research/2026-11-12-glm53-architecture-spec-review.md`。
- Phase 0/1 开工前未决项：无；若新增，必须先更新本表。
