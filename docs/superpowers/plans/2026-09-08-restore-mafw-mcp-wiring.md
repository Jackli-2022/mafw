# MAFW MCP 工具链修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复 MAFW 的 40 个 MCP 工具在 opencode 会话中的可用性（当前全局配置无 `mcp` 段，工具从未接通），顺带修复两个插件加载错误和两条乱码记忆。

**Architecture:** gateway 已在 `http://127.0.0.1:3000/mcp` 暴露 SSE MCP（实测握手正常）；修复 = 全局 opencode.jsonc 接 `mcp` 段（remote）+ 插件 `config` 返回形状 bug + 项目配置垃圾项 + 乱码记忆重写。**gateway 无需重启**；插件跑在 opencode 进程内，改完用户重启 opencode 会话生效。

**Tech Stack:** opencode 1.x 配置（`mcp` 键）、MCP legacy SSE（`SSEServerTransport`）、TypeScript 插件、jest。

## Global Constraints

- 全局配置 `C:\Users\15524\.config\opencode\opencode.jsonc` 在工作目录之外——修改前必须经用户确认
- 不使用 `gateway/dist/core/mcp-server.js`（stdio）作为 MCP 接入方式：已 deprecated，会自建 HarmonicIndexManager 与 gateway 双写冲突
- PowerShell 5.1 写 JSON body 会损坏 UTF-8 中文——HTTP 写入一律用 curl.exe + UTF-8 文件
- 每个任务独立 commit，commit message 遵循仓库现有风格（`fix(...)`/`chore(...)`）
- 插件单测命令：`npm test`（仓库根，jest）

## 背景（证据摘要）

- `49dbd446`（2026-07-06）删除插件原生工具（7 个），承诺走 gateway MCP SSE
- `opencode.json.example` 用的是旧键 `mcpServers`；opencode 1.x 已改为 `mcp` 键，旧键被静默忽略
- 147MB opencode 日志中 MCP 工具真实调用 = 0 次
- opencode.log 现存两个错误：`failed to load plugin path=install`（项目配置垃圾）、`plugin config hook failed: N.config is not a function`（plugin.ts 返回 config 对象而非函数，类型契约见 `@opencode-ai/plugin/dist/index.d.ts:178`）
- 乱码记忆：`mem_1788851156672_ucib1a`（首版）与 `mem_1788851297761_ql5hsp`（重写版，supersede 链）均因 PowerShell 编码损坏

---

### Task 1: 修复乱码记忆

**Files:**
- Create: `%TEMP%`/临时 payload（用 Write 工具写 UTF-8，不落 repo）

**Interfaces:**
- 产出：`mem_<新id>`（semantic），supersede 链：`mem_1788851156672_ucib1a` → `mem_1788851297761_ql5hsp` → 新 id

- [ ] **Step 1: 用 Write 工具写 UTF-8 payload 文件**

写 `C:\Users\15524\AppData\Local\Temp\opencode\memory-fix-payload.json`：

```json
{
  "content": "【根因】index-scan 冷扫描（hit<50%，7% 次数/58% uncached input）= ①闲置>5min 缓存 TTL 过期：burst 首扫冷率 43.3%；②连续请求下 DashScope 缓存异步写入滞后：burst 内持续 12-20% 冷。\n【已否定】supersede 删条目断 append-only prefix 假设——有无条目变化的 refresh 后冷扫率 7.3% vs 7.1% 无相关，tombstone 方案取消。\n【背景】历史数据全来自旧 session-based 扫描路径（无 cache_control/无去重/无节流，10-51x 放大）；09-01 起新 direct-HTTP 路径已内置显式缓存+去重+60s 节流，生产数据尚为零。\n【待办】先观察新路径再动手；索引文本瘦身（65K→35K）为候选，可走 LongMemEval L1 scan 集成 A/B；成本口径矛盾（opencode 报 $455 vs 价目表 $27）待对阿里云账单核实。\n全文：docs/reports/2026-09-08-memory-token-usage-analysis.md",
  "memoryType": "semantic",
  "primaryAbstraction": "index-scan 冷扫描根因：TTL 过期+缓存异步写",
  "cueAnchors": ["index-scan", "prompt cache", "缓存命中率", "冷扫描", "记忆成本", "DashScope", "token 用量", "index-scan优化"],
  "importance": 0.8,
  "supersedes": "mem_1788851297761_ql5hsp"
}
```

- [ ] **Step 2: curl 提交（避开 PowerShell 编码坑）**

```powershell
curl.exe -s -X POST "http://localhost:3000/api/memory/add" -H "Content-Type: application/json; charset=utf-8" --data-binary "@C:\Users\15524\AppData\Local\Temp\opencode\memory-fix-payload.json"
```

预期：`{"success":true,"id":"mem_..."}`

- [ ] **Step 3: 验证中文可读 + 链完整**

```powershell
curl.exe -s "http://localhost:3000/api/memory/get?id=<新id>" | Out-String
```

预期：`primary_abstraction` 为正常中文（非 `??` 乱码），memory 字段包含【根因】等结构段

- [ ] **Step 4: 验证旧条目已 superseded**

```powershell
curl.exe -s "http://localhost:3000/api/memory/get?id=mem_1788851297761_ql5hsp"
```

预期：返回含 supersede 链指向新 id

---

### Task 2: 修复 plugin.ts 无效 config 返回（"plugin config hook failed"）

**Files:**
- Modify: `src/plugin.ts:164-168`

**Interfaces:**
- 依据：`@opencode-ai/plugin/dist/index.d.ts:178` → `config?: (input: Config) => Promise<void>`（必须是函数）
- 删除理由（评审修正版）：opencode config 的 `skills` 键只有 `paths`/`urls`（仅新增，无禁用 API，`opencode-dev/packages/opencode/src/skill/index.ts:211-222`），该禁用意图**在任何形态下都无法实现**；且 4 个 legacy skills（mafw-goal/plan/execute/review）的 SKILL.md **无 YAML frontmatter**，skill 发现器自动跳过——实际本就不会出现在会话里（本会话 skill 列表证实）

- [ ] **Step 1: 确认无测试依赖该返回**

```powershell
Get-ChildItem gateway\tests -Recurse -Filter "*plugin*"
```

预期：无输出（插件无单测；若将来出现，先看断言再改）

- [ ] **Step 2: 删除 config 块**

`src/plugin.ts` 第 164-168 行：

```ts
  return {
    config: {
      skills: [{ name: 'mafw-goal', enabled: false }, { name: 'mafw-plan', enabled: false },
               { name: 'mafw-execute', enabled: false }, { name: 'mafw-review', enabled: false }],
    },
    tool: {
```

改为：

```ts
  return {
    tool: {
```

- [ ] **Step 3: 类型检查验证（根 tsc 覆盖 src/）**

```powershell
npx tsc --noEmit
```

预期：无错（完整构建验证在 Task 5）

- [ ] **Step 4: Commit**

```powershell
git add src/plugin.ts
git commit -m "fix(plugin): remove invalid config return (opencode requires config hook to be a function)"
```

---

### Task 3: 删除项目配置垃圾 plugin:["install"]

**Files:**
- Modify: `.opencode/opencode.json`

- [ ] **Step 1: 删除 plugin 键**

`.opencode/opencode.json` 当前内容：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "install"
  ]
}
```

改为：

```json
{
  "$schema": "https://opencode.ai/config.json"
}
```

- [ ] **Step 2: Commit**

```powershell
git add .opencode/opencode.json
git commit -m "chore(opencode): remove bogus 'install' plugin entry (failed to load on every start)"
```

---

### Task 4: 全局 opencode.jsonc 接 MCP 线

**Files:**
- Modify: `C:\Users\15524\.config\opencode\opencode.jsonc`（**工作目录外——执行前向用户确认**）

- [ ] **Step 1: 在 `"plugin": [...]` 数组后插入 mcp 段**

将：

```jsonc
  "plugin":[
    "file:C:/home/ubuntu/.npm-global/node_modules/opencode-plugin-mafw",
    "superpowers@git+https://github.com/obra/superpowers.git",
  ],
```

改为：

```jsonc
  "plugin":[
    "file:C:/home/ubuntu/.npm-global/node_modules/opencode-plugin-mafw",
    "superpowers@git+https://github.com/obra/superpowers.git",
  ],
  "mcp": {
    "mafw": {
      "type": "remote",
      "url": "http://127.0.0.1:3000/mcp",
      "enabled": true,
      "oauth": false
    }
  },
```

- [ ] **Step 2: 验证 gateway MCP 端点存活**

```powershell
curl.exe -s -N --max-time 3 "http://127.0.0.1:3000/mcp"
```

预期：输出 `event: endpoint` + `data: /mcp?sessionId=...`

> 若 gateway 未运行：先 `mafw status`，未运行则 `mafw start`

- [ ] **Step 3: 用 opencode CLI 验证连接（无需开新会话）**

```powershell
opencode mcp list
```

预期：列表含 `mafw`，状态 connected/ok

> **兼容性已实证**：opencode（已装 1.18.29）的 remote MCP 客户端先尝试 StreamableHTTP、失败后自动回退 legacy SSE
>（`opencode-dev/packages/opencode/src/mcp/index.ts:269-291` 双 transport 循环），gateway 的 SSE 端点可兼容。
> 若仍连接失败：不**改用 stdio（见 Global Constraints），而是单独调查 gateway 侧 streamable-HTTP 兼容层，另开任务

---

### Task 5: 重建并重装插件

**Files:**
- 无代码改动；产物 `opencode-plugin-mafw-4.1.0.tgz` 会被刷新并已在 git 跟踪

- [ ] **Step 1: 构建**

```powershell
npm run build
```

预期：tsc 无错，`dist/plugin.js` + `gateway/dist/` 刷新

- [ ] **Step 2: 打包 + 全局重装**

```powershell
npm pack
npm install -g opencode-plugin-mafw-4.1.0.tgz
mafw version
```

预期：版本输出 4.1.0

- [ ] **Step 3: Commit 刷新后的 tgz**

```powershell
git add opencode-plugin-mafw-4.1.0.tgz
git commit -m "chore: repack 4.1.0 after plugin config-hook fix"
```

---

### Task 6: 验证端到端（用户动作）

- [ ] **Step 1: 用户重启 opencode 会话**（当前进程为 09-07 17:49 启动，插件与配置修复必须新进程生效）
- [ ] **Step 2: 新会话中验证工具可见**

新会话里问 agent："列出你可用的 mafw_ 开头工具"

预期：出现 `mafw_search_hybrid`（MCP 通道）、`mafw_add_memory`、`mafw_python`、`mafw_media_ask` 等

- [ ] **Step 3: 验证 hooks 复活**

```powershell
Get-Content .mafw\logs\mafw.log -Tail 3
```

预期：出现当日新行 `File logging enabled` + `Plugin activated. All hooks registered.`

- [ ] **Step 4: 验证记忆主动检索可用**

新会话中让 agent 调 `mafw_search_hybrid` 查 "index-scan 冷扫描"，预期命中 Task 1 写入的记忆

---

### Task 7: AGENTS.md 补记接线要求

**Files:**
- Modify: `AGENTS.md`（§4.1 Gateway MCP 工具一节）

- [ ] **Step 1: 在 §4.1 表后追加接线说明**

在 §4.1 表格之后追加：

```markdown
> **接线要求（2026-09-08 修复）**：以上工具经 gateway SSE MCP 暴露（`http://127.0.0.1:3000/mcp`），
> opencode 侧必须在全局 `~/.config/opencode/opencode.jsonc` 配置 `"mcp": { "mafw": { "type": "remote",
> "url": "http://127.0.0.1:3000/mcp", "enabled": true, "oauth": false } }` 才可用。
> 注意：旧键 `mcpServers`（v4.1 时代 `opencode.json.example`）已被 opencode 1.x 废弃并**静默忽略**，
> 接线缺失无任何报错，工具直接消失。验证：`opencode mcp list` 应显示 mafw connected。
> 插件原生工具（6 个：media×3/python×2/add_memory）不经 MCP，独立可用。
```

- [ ] **Step 2: Commit**

```powershell
git add AGENTS.md
git commit -m "docs: MCP wiring requirement for gateway tools (mcp key, not legacy mcpServers)"
```

---

## 已知非阻塞事项（评审记录，不在本计划范围）

- **MCP 工具 schema 占 context**：接通后每个会话多 39 个工具 schema（tool-registry 实际注册 39 个，AGENTS.md §4.1 写 40 是文档漂移）。
  若在意，后续可在 opencode.jsonc 用 `"tools": { "mafw_desktop_*": false }` 按模式裁剪（desktop 控制类 6 个在 CLI 会话无用）
- **gateway 重启时** opencode 侧 MCP 连接会断开，需重启 opencode 会话重连（MCP 客户端无自动重连语义）
- **桌面端 MafwShell** 走 gateway SDK HTTP 直连，不经 MCP，不受本计划影响

## Self-Review

- 覆盖：MCP 接线（Task 4）、plugin config bug（Task 2）、install 垃圾（Task 3）、乱码记忆（Task 1）、验证（Task 6）、文档（Task 7）、重建（Task 5）——全部问题均有对应任务
- 无占位符：所有代码/命令/JSON 均给出完整内容
- 一致性：Task 1 的新 id 在 Task 6 Step 4 被检索引用，顺序正确
- 风险最小化：不做 stdio 回退（双写冲突）、不改 gateway（无需重启）、不全局降频/tombstone（已证伪）
