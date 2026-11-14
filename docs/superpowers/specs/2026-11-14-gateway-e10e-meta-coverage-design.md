# Gateway E10e 契约覆盖（第五批：元数据 / 注册表面）：设计（2026-11-14）

> 承接 E10d（61/318）。本批 **8 个读接口**，无 override 变更，无 wire 变更。
> 规则沿用 `2026-11-13-gateway-e10-contract-coverage-design.md` §2。

## 0. 基线

- catalog：318 ops，**61** 个有 response schema。
- overrides：12（本批不涉及）。
- 终值：**69/318（21.7%）**。

## 1. 范围

| op | path | handler | 备注 |
|---|---|---|---|
| `agents.list` | `/api/agents` | `routes/misc.ts:111` | `{items: MafwAgent[]}` |
| `providers.list` | `/api/provider` | `routes/misc.ts:96` | `{items: MafwProvider[], default?, connected?}` |
| `mcp.servers` | `/api/mcp/servers` | `routes/mcp-mgmt.ts:35` | `{servers?: McpServerEntry[]}` |
| `plugins.list` | `/api/plugins` | `routes/wave2-handlers.ts:108` | `PluginsListResult` |
| `skills.list` | `/api/skills` | `routes/skills.ts:26` | internal |
| `tools.list` | `/api/tools` | `routes/tools.ts:29` | internal |
| `config.get` | `/api/config` | `routes/config.ts:20` | 配置视图（内部） |
| `scheduler.status` | `/api/scheduler/status` | `routes/scheduler.ts:31` | internal |

Reserve：`automations.list`（仍为 override，下一批）、`plugins.client`、`runtime.get`。

## 2. 增量规则

1. handler 为事实源；有 SDK DTO 的 4 个 op 加 `AssertEq`（`MafwAgent`、`MafwProvider`、`McpServerEntry`、`PluginsListResult`）。
2. `config.get` / `tools.list` / `skills.list` / `scheduler.status` 无 SDK client：schema-only；若 payload 含 runtime-owned 字段（如 config 的动态段），边界对象 + owner 注释，不得整响应放宽。
3. 覆盖率清单追加 8，阈值 61 → 69，`TOTAL_OPS` 318。
4. 生成物入库；`emit:openapi` + `gen:api` 幂等，diff 只允许 8 个目标 op。

## 3. 非目标

- 请求体 schema、其余 ~249 ops。
- `automations.list` / `automations.get` / `automations.history`（下一批，含 override 转 code-first）。
- TUI/mobile phantom 字段。

## 4. 门禁

gateway tsc 0 + 全量（9 env-red）+ coverage 69/318 + analyze TOTAL 0。
SDK tsc/full（226）/contract 4/4 + `gen:api` 幂等。
desktop full（1 resolver env-red）+ tsgo（2 `node:tls`）。
mobile targeted + analyze；TUI env-red；kernel-split 7/7。
