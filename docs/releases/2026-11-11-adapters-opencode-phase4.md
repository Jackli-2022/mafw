# adapters/opencode Phase 4 — 原生驱动 + 协议守卫

日期：2026-11-11
分支/合并：`feat/adapters-opencode-phase4` → local `main`

## 交付

- **W1** `3fa66b3f`：adapter 原生 `AdapterEvent` 发射层（`emit.ts`、`turn-attribution.ts`、`translateNative`/`translateNative21`），69 行 golden 同时钉 type 与 `data`。
- **W2** `6f0c8238`：`transport.ts` / `host.ts` / `channels.ts` / `entry-registry.ts`；`definition.ts` 改为直接 `defineRuntime`，删除 legacy bridge 依赖；修复大写 `requestID`、v2 synthetic 抑制、完整 `NEED_TURN`、fan-out 批次归属。
- **W3** `9f6e3db4`：v1/v2 全通道 + `discovery.roots()`，经 `createNeutralRuntime` 验证 mcp/config/discovery/instructions/PTY/checkpoint/background。
- **W4** `1d556087`、`f2872dfd`、`05280798`、`a3b37722`：adapter 注册描述符；删除 gateway 凭据/代理/serve-auth fallback；skills/instruction roots 走 adapter；legacy runtime tag 集中；external mode 单源；`normalizeRuntimeEvent`；删除 `types/sdk.d.ts`；bridge 迁 `legacy-plugin-bridge.ts`。
- **W5** `fcc04813`：事件流断流后指数退避重订阅、重连重探、单飞订阅；dialect probe 接受显式 auth headers；外部模式不暴露 `agentProcess`。
- **W6**：删除 `adapters/opencode/src/legacy-definition.ts`；新增 `runtime-protocol-guards.test.ts`（G1–G4）；docs 更新。

## 门禁

- gateway Jest **764 suites / 6011 tests**（W4 全量）
- `typecheck:gateway-tests` / gateway `tsc` / desktop `tsgo` 全 0
- adapter `tsc` 0；contract 24/24；core 48/48；kit 15/15
- W5 后目标套件 29 suites / 379 tests（含 resubscribe + probe headers）

## 兼容性

- 保留 adaptive/v1/v2/v21 四个注册名与事件表。
- `legacy-plugin-bridge.ts` 仅服务旧文件插件 `createRuntime(ctx)`；opencode 驱动不再经过它。
- 未 push / 未发布。
