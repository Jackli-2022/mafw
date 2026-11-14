# 2026-11-14 · MCP 管理页

- **版本**：desktop `5.1.0`（未 bump）
- **Commit**：`9d78cffc`
- **范围**：Desktop 左 rail / 主内容区 / `/mcp` 命令

## 背景

MCP 管理此前只存在于 Config → 扩展，入口深，且无法一眼看到「连没连上」。本轮增加一级 MCP
管理页，保留 Config 里的同一套管理能力。

## 交付

- 新增 `pages/McpPage.tsx`：
  - 摘要：服务器总数 / 已连接 / 需要处理（`needs_auth` + `failed`）/ 未连接或已禁用；
  - 列表：名称、`remote` / `local` / `runtime` 类型、状态徽标、URL 或命令、来源、错误详情；
  - 操作：连接 / 断开、复制认证命令、添加服务器（`McpServerDialog`）、删除配置文件项；
  - 筛选：全部 / 已连接 / 需要处理；
  - `mcpApi` 缺失时显示中性空态，不报 runtime 名。
- 新增 `pages/mcp-page-model.ts`：状态标签、状态语义色、摘要统计、筛选匹配纯函数。
- 导航：
  - `NavTab` 增加 `mcp`；
  - IconRail 增加 `mcp` 图标入口（`active` 跟随当前页）；
  - 命令面板增加「MCP 服务器」；
  - Chat `/` 增加 `/mcp`。
- 样式沿用 `mafw-ext-*` 列表，新增 `.mafw-mcp-summary` / `.mafw-mcp-status--*`，全部走主题 token。

## 验证

- desktop 全量：**3852 / 3852**（735 suites）
- 本轮新增测试：**7**
  - `mcp-page-model.test.ts`：4（标签 / 状态色 / 摘要 / 筛选）
  - `tests/mcp-page-wiring.test.ts`：3（导航接线 / 页面 API / token 样式）
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 边界

- 状态来源仍是 gateway 的 `mcp.servers`（adapter 合并配置 + 运行时状态）；本轮没有新增 gateway
  路由或 runtime 契约。
- Config → 扩展的 MCP 管理保留，两个入口共用同一组 API。
