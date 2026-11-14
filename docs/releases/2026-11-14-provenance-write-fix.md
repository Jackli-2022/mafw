# 2026-11-14 · Provenance 写入链路修复

- **分支**：`fix/provenance-write`（基于 main `0b8cee6d`）
- **状态**：已实现并通过 focused/构建门禁；待合并/部署
- **根因**：3A 只接通了 MCP handler；serve/worker 实际使用的 host plugin native tool 与 D3 后的 `routes/dashboard.ts` 都没有 `sourceTraceIds`
- **影响**：15,186 条 Knowledge、近 3 天 3,265 条新增，exact provenance 全为 0

## 修复内容

1. **host plugin native tool**
   - `src/tools/add-memory.ts` 增加可选 `sourceTraceIds: string[]`（Zod max 20）
   - HTTP body 仅在有值时透传，旧 payload 形状不变

2. **HTTP `/api/memory/add`**
   - `gateway/src/routes/dashboard.ts` 解析 `sourceTraceIds`
   - 用 `normalizeSourceTraceIds` + `DashboardRouteDeps.hasTrace` 校验存在性、去前缀、去重、上限 20
   - 合法 id 写入 unit 的 `source_trace_ids`；未知 id 丢弃，写入照常成功
   - `subsystems/api-routes.ts` 从 `getGatewayDb().hasTrace` 注入

3. **重复写入强化收紧**
   - `routeAndWrite` skip 分支现在只有 union **新增** trace id 时才强化
   - 相同 provenance 的重复写入恢复为纯 no-op，避免 energy 无意义抬升

## 测试

- `tests/add-memory-tool-provenance.test.ts`：native tool schema + body 透传；无字段时旧形状
- `gateway/tests/unit/routes/dashboard-wiring.test.ts`：HTTP 路由校验/落库；无字段不产生字段
- `gateway/tests/unit/memory/route-write.test.ts`：重复且无新增 provenance 不写盘

## 已知限制

- 不给历史 15,186 条记忆推断 provenance；只对新写入生效
- 需要重建 host plugin（root `npm run build`）并让 agent/worker 会话重新加载工具 schema
- reflection stale / 周级管线未触发是独立问题，本次不修
