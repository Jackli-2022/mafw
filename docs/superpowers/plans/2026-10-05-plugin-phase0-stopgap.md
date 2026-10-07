# Phase 0: v1 插件止血（死代码清除 + 打包修复 + 全局接线）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清除 opencode v1 宿主插件中 ~800 行死代码，修复发布包缺失插件入口的打包 bug，并修复全局 opencode 配置指向 v4.5.1 陈旧副本的接线错误——让插件部署重新生效、dev loop 可用。

**Architecture:** 纯删除与修复，无新功能、不改 gateway。`src/plugin.ts` 是唯一被修改的活代码（摘除 HookManager 死链）；打包层给 `package.json` 补回入口字段（`main` + `opencode.plugin`，v4.5.1 陈旧副本证明该约定可用）；部署层把 `~/.config/opencode/opencode.jsonc` 的 `file:` 引用从旧包名路径重指到新全局安装。

**Tech Stack:** TypeScript (tsc CJS)、npm pack、opencode v1 插件机制（`plugin: ["file:<path>"]` + 包内 `opencode.plugin` 字段）。

## Global Constraints

- **验证体系说明**：插件侧无测试运行器（这是 Phase 2/3 要解决的问题）。本计划的验证 = `npm run build`（tsc 编译是死代码删除的安全网——悬空引用会编译失败）+ gateway jest（回归基线 233 suites / 1512 tests，预期不受影响）+ 交付前冒烟清单。
- `git add` 路径必须相对 repo 根（`src/...` 而非 `opencode-plugin-mafw/src/...`）。
- **中文内容一律用 edit/write 工具写文件，不经 PowerShell 管道**（会 UTF-8 损坏）。
- 发版流程固定：`npm run build` → `npm pack` → `mafw stop` → `npm install -g <精确文件名>.tgz`（Windows 通配符不展开）→ `mafw daemon`。
- 版本记录惯例：version bump + commit + 测试数，交付报告含 commit hash。
- **不改 gateway/src 任何文件**（Phase 0 范围外）。

## 背景事实（执行者必读）

1. **陈旧副本 bug（本计划要修的核心 bug）**：`~/.config/opencode/opencode.jsonc` 的 plugin 数组含 `"file:C:/home/ubuntu/.npm-global/node_modules/opencode-plugin-mafw"`——这是 v4.5.1（旧包名 `opencode-plugin-mafw`，已改名 `@jack200714/mafw`）。此后所有 `npm install -g jack200714-mafw-*.tgz` 都装到了 `@jack200714/mafw` 目录，opencode 从未加载过它们。**本仓库**靠项目级 `.opencode/plugins/mafw-plugin.ts` shim（re-export `../src/plugin`）跑当前代码，所以本仓库外的项目全部冻结在 v4.5.1。
2. **入口字段约定（已验证）**：v4.5.1 副本的 package.json 含 `"main": "dist/plugin.js"` + `"opencode": {"plugin": "dist/plugin.js"}` + `files` 含 `dist/`，能正常加载。当前 repo 的 package.json 三者全缺，`files` 白名单不含 `dist/`——npm pack 出的 tarball 里没有插件。
3. **保留物（不是死代码，别删）**：
   - `/status` 命令与 `.mafw/STATUS.md`：gateway 侧 `heartbeat.ts`/`recovery.ts`/`archive-worktree.ts`/`core/utils/status.ts` 在读写，活文件。
   - `src/hooks/session-ending.ts` + `src/utils/state.ts`：legacy goal 环路的崩溃兜底。gateway 的 `phase-orchestrator.ts:120` 仍在写 `nextAction: 'WAIT_PHASE_COMPLETE'`——协议活着。Phase 0 保留，Phase 2/3 随 HostAdapter 重新评估。
   - `src/utils/ttl-map.ts`：`session-recall.ts` 在用。
   - `/goal` 命令与 `.mafw/requests/` 文件流：AGENTS.md §4.2 明确"刻意保留两条路径"。
4. **已确认无 importer 的死文件**（grep 全 src 验证）：hooks 的 session-start / tool-before / user-prompt / llm-after / session-compacting / handoff / tool-executed / observation-capture（仅被同为死文件的 tool-executed 引用）；utils 的 status / circuit-breaker / retry / fallback / git / github / global-path。`config-loader` 仅剩一处返回值被丢弃的调用。

---

### Task 1: 摘除死 hook 链与 HookManager

**Files:**
- Delete: `src/hooks/session-start.ts`, `src/hooks/tool-before.ts`, `src/hooks/user-prompt.ts`, `src/hooks/llm-after.ts`, `src/hooks/session-compacting.ts`, `src/hooks/handoff.ts`, `src/hooks/tool-executed.ts`, `src/hooks/observation-capture.ts`, `src/hooks/hook-manager.ts`
- Modify: `src/plugin.ts`

**Interfaces:**
- Consumes: 无（纯删除）
- Produces: `src/plugin.ts` 导出签名不变（`export default async function MafwPlugin({ directory })`，返回 tool/hooks/command 对象）；`sessionEndingHook` 改为在 `'session.end'` 内联调用

- [ ] **Step 1: 删除 9 个死文件**

```powershell
Remove-Item src\hooks\session-start.ts, src\hooks\tool-before.ts, src\hooks\user-prompt.ts, src\hooks\llm-after.ts, src\hooks\session-compacting.ts, src\hooks\handoff.ts, src\hooks\tool-executed.ts, src\hooks\observation-capture.ts, src\hooks\hook-manager.ts
```

- [ ] **Step 2: 修改 plugin.ts —— 替换 import 块（第 1-26 行）**

删除后精确的 import 块（删除了 state/config-loader/hook-manager/session-start/tool-before/user-prompt/llm-after/session-compacting/handoff 九个 import）：

```ts
import * as fs from 'fs';
import * as path from 'path';
import { sessionEndingHook } from './hooks/session-ending';
import { sessionRecallHook } from './hooks/session-recall';
import { mediaIngestHook, ingestLargeMediaBeforeStore } from './hooks/media-ingest';
import { pythonGuideHook } from './hooks/bash-python-guide';
import { mediaAskTool } from './tools/media-ask';
import { mediaUploadTool } from './tools/media-upload';
import { mediaSpeakTool } from './tools/media-speak';
import { pythonExecTool } from './tools/python-exec';
import { pythonRestartTool } from './tools/python-restart';
import { memoryGuideHook } from './hooks/memory-guide';
import { userProfileSystemHook } from './hooks/user-profile';
import { voiceGuideMessagesHook, voiceGuideSystemHook } from './hooks/voice-guide';
import { pushObservation, extractTextFromParts, toolFailureText } from './utils/obs-capture';
import { addMemoryTool } from './tools/add-memory';
import { ensureMcpWiring, resolveGatewayApiUrl } from './utils/self-wiring';
```

- [ ] **Step 3: 删除 ConfigLoader 调用（原第 77 行）**

删除这一行（返回值从未被使用，无其他消费者）：

```ts
ConfigLoader.getInstance(directory).getAll();
```

- [ ] **Step 4: 删除 HookManager 与 13 个注册（原第 89-171 行），内联 session.end**

删除 `const hookManager = new HookManager(...)` 到最后一个 `hookManager.register({...})` 的整块（原 89-171 行），保留 `const gatewayUrl = getGatewayUrl(mafwDir);`（命令仍用）。然后把返回对象里的：

```ts
'session.end': (ctx: any) => hookManager.execute('session.end', ctx),
'tool.execute.before': (ctx: any) => hookManager.execute('tool.before', ctx),
```

替换为（`tool.execute.before` 整个 key 删除——它的 handler 是空桩）：

```ts
'session.end': (ctx: any) => sessionEndingHook(ctx?.data || ctx),
```

- [ ] **Step 5: 清理 chat.message / tool.execute.after 里的死分发**

`'chat.message'` 中删除这一行（userPromptHook 是空桩）：

```ts
hookManager.execute('user.prompt', input);
```

`'tool.execute.after'` 中删除这一行（tool-executed handler 是纯空操作）：

```ts
hookManager.execute('tool.executed', { ...input, data: output });
```

- [ ] **Step 6: 清理构建并验证**

```powershell
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue; npm run build
```
Expected: tsc 编译成功，无 "Cannot find module" 错误（悬空引用会被 tsc 抓住）。

- [ ] **Step 7: Commit**

```powershell
git add src/plugin.ts src/hooks/session-start.ts src/hooks/tool-before.ts src/hooks/user-prompt.ts src/hooks/llm-after.ts src/hooks/session-compacting.ts src/hooks/handoff.ts src/hooks/tool-executed.ts src/hooks/observation-capture.ts src/hooks/hook-manager.ts
git commit -m "chore: remove dead hook chain and HookManager from plugin"
```

---

### Task 2: 删除未使用 legacy utils

**Files:**
- Delete: `src/utils/status.ts`, `src/utils/circuit-breaker.ts`, `src/utils/retry.ts`, `src/utils/fallback.ts`, `src/utils/git.ts`, `src/utils/github.ts`, `src/utils/global-path.ts`, `src/utils/config-loader.ts`
- Modify: 无（Task 1 已移除 plugin.ts 中唯一 import）

**Interfaces:**
- Consumes: Task 1 的 plugin.ts（已无这些 import）
- Produces: 无

- [ ] **Step 1: 确认无残余引用**

用 Grep 工具在 `src/` 目录搜 pattern：`utils/(status|circuit-breaker|retry|fallback|git|github|global-path|config-loader)`
Expected: 0 匹配（若 `gateway/` 有同名文件是 gateway 自己的副本，不在本计划范围）。

- [ ] **Step 2: 删除 8 个文件**

```powershell
Remove-Item src\utils\status.ts, src\utils\circuit-breaker.ts, src\utils\retry.ts, src\utils\fallback.ts, src\utils\git.ts, src\utils\github.ts, src\utils\global-path.ts, src\utils\config-loader.ts
```

- [ ] **Step 3: 验证构建**

```powershell
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue; npm run build
```
Expected: 编译成功。

- [ ] **Step 4: Commit**

```powershell
git add src/utils/status.ts src/utils/circuit-breaker.ts src/utils/retry.ts src/utils/fallback.ts src/utils/git.ts src/utils/github.ts src/utils/global-path.ts src/utils/config-loader.ts
git commit -m "chore: remove unused legacy utils from plugin"
```

---

### Task 3: 打包修复——入口字段 + dist 进包 + 版本日志

**Files:**
- Modify: `package.json`（根）
- Modify: `src/plugin.ts`（激活日志加版本号）

**Interfaces:**
- Produces: 发布 tarball 含 `dist/plugin.js`；opencode 可经 `file:<全局安装路径>` 加载；激活日志输出 `[MAFW] Plugin activated v<x.y.z>`（冒烟断言用）

- [ ] **Step 1: package.json 补入口字段与 dist**

在 `"bin": {...},` 块之后插入：

```json
  "main": "dist/plugin.js",
  "opencode": {
    "plugin": "dist/plugin.js"
  },
```

并把 `files` 数组改为（加 `"dist/"`，注意保持其他项不变）：

```json
  "files": [
    "gateway/dist/",
    "gateway/package.json",
    "bin/",
    "dist/",
    "packages/tui/dist/",
    "README.md"
  ],
```

- [ ] **Step 2: 激活日志加版本号（冒烟断言点）**

在 `src/plugin.ts` 的 `MafwPlugin` 函数内，把：

```ts
console.log('[MAFW] Plugin activated. All hooks registered.');
```

替换为：

```ts
const pkg = require('../package.json') as { version: string };
console.log(`[MAFW] Plugin activated v${pkg.version}. All hooks registered.`);
```

（运行时相对解析：经 shim 加载 → repo package.json；经 dist/plugin.js 加载 → 安装包的 package.json，两者都正确。）

- [ ] **Step 3: 构建 + 打包验证**

```powershell
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue; npm run build; npm pack
```
Expected: 产出 `jack200714-mafw-4.16.1.tgz`（此时版本号还没 bump）。

- [ ] **Step 4: 验证 tarball 内容**

```powershell
tar -tf jack200714-mafw-4.16.1.tgz | Select-String "package/dist/plugin.js"
```
Expected: 至少一条 `package/dist/plugin.js` 匹配。若无匹配 = 打包失败，回头检查 files 数组。

- [ ] **Step 5: 验证入口可解析**

```powershell
node -e "const p = require('./package.json'); console.log(p.main, p.opencode.plugin)"
```
Expected: `dist/plugin.js dist/plugin.js`

- [ ] **Step 6: 清理 tarball + Commit**

```powershell
Remove-Item jack200714-mafw-4.16.1.tgz
git add package.json src/plugin.ts
git commit -m "fix: package plugin entry (main + opencode.plugin), ship dist/, log version on activation"
```

---

### Task 4: 发版 4.17.0 + 全局接线修复 + 冒烟验证

**Files:**
- Modify: 版本号（`node scripts/bump-version.mjs 4.17.0` 自动改 root + workspaces）
- Modify（repo 外，机器配置）: `~/.config/opencode/opencode.jsonc`
- Modify: `AGENTS.md`（§4.2 工具数 + dev loop 说明）
- Delete（repo 外）: `C:\home\ubuntu\.npm-global\node_modules\opencode-plugin-mafw`（陈旧 v4.5.1 副本）

**Interfaces:**
- Produces: 全局 opencode 加载 v4.17.0 插件；本 repo 的 `.opencode/plugins/mafw-plugin.ts` shim 注释与 package.json 事实重新一致

- [ ] **Step 1: 版本 bump 与校验**

```powershell
node scripts/bump-version.mjs 4.17.0; node scripts/bump-version.mjs --check
```
Expected: `--check` 通过（无版本漂移）。

- [ ] **Step 2: 全量构建 + gateway 回归**

```powershell
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue; npm run build; npm test
```
Expected: build 成功；jest 输出基线 **233 suites / 1512 tests passed**（gateway 不受插件改动影响，若有失败先查明再继续）。

- [ ] **Step 3: 打包 + 全局安装**

```powershell
npm pack; npm install -g jack200714-mafw-4.17.0.tgz
```
（精确文件名——Windows 通配符不展开。）

- [ ] **Step 4: 重指全局 opencode 配置**

先取全局前缀：

```powershell
npm config get prefix
```

用 edit 工具修改 `~/.config/opencode/opencode.jsonc`：把 plugin 数组中的

```jsonc
"file:C:/home/ubuntu/.npm-global/node_modules/opencode-plugin-mafw",
```

替换为（`<PREFIX>` 用上一步输出，斜杠改正斜杠）：

```jsonc
"file:<PREFIX>/node_modules/@jack200714/mafw",
```

注意：不要动 `superpowers@git+...` 条目、`mcp` 段和顶部 `/* mcp-hotreload-touch */` 注释。

- [ ] **Step 5: 删除陈旧副本 + 重启 agent serve**

```powershell
Remove-Item -Recurse -Force C:\home\ubuntu\.npm-global\node_modules\opencode-plugin-mafw
mafw restart-agent
```
Expected: restart-agent 成功（重启 opencode serve sidecar 并重载插件）。

- [ ] **Step 6: 冒烟验证（repo 内）**

```powershell
opencode run "reply with just ok, no tools"
Select-String -Path .mafw\logs\mafw.log -Pattern "Plugin activated" | Select-Object -Last 3
```
Expected: 日志出现 `[MAFW] Plugin activated v4.17.0`。

**双加载判定**：若 `v4.17.0` 行出现**两次**（shim + 全局 file: 同时加载）——检查该回合消息是否出现两个 `<recall>` 块（gateway 日志 `Select-String -Path $env:USERPROFILE\.mafw\logs\mafw.log -Pattern "\[Recall\]"`，或后续会话里目测）。若确认双重注入：从 jsonc 删除全局 `file:` 条目（本机为开发机，以 shim 为准），再 `mafw restart-agent` 验证只剩一条激活日志；并在 AGENTS.md 记录"非本仓库项目需在全局配置加回 `file:<PREFIX>/node_modules/@jack200714/mafw`"。若仅重复加载但无重复注入（obs 被 turnID UNIQUE 去重、media 二次调用为 no-op、recall 未双发），保留双入口并在 AGENTS.md 记录为已知边界。

- [ ] **Step 7: 冒烟验证（repo 外，单加载路径）**

```powershell
New-Item -ItemType Directory -Force $env:TEMP\mafw-smoke | Out-Null
Set-Location $env:TEMP\mafw-smoke
opencode run "reply with just ok"
Select-String -Path .mafw\logs\mafw.log -Pattern "Plugin activated"
Set-Location C:\work\work-loop\opencode-plugin-mafw
```
Expected: 恰好一条 `[MAFW] Plugin activated v4.17.0`——**这验证了冻结在 4.5.1 的 bug 已修复**。

- [ ] **Step 8: 更新 AGENTS.md（§4.2 插件侧工具表）**

用 edit 工具：① 工具数 4 → 6（补 `mafw_media_speak`、`mafw_add_memory` 两行）；② 表后加一行说明：

```markdown
> 插件 dev loop：本仓库内 opencode 经 `.opencode/plugins/mafw-plugin.ts` shim 直连 `../src/plugin`（v1 原生加载 TS，无需 tsc）；改动生效 = `mafw restart-agent`。仓库外项目靠全局 `file:<npm-prefix>/node_modules/@jack200714/mafw` 加载 dist/plugin.js（发布后 `npm install -g` 更新）。包入口字段：`main` + `opencode.plugin` = `dist/plugin.js`（2026-10-05 修复：此前 tarball 不含 dist/，全局加载的是 v4.5.1 陈旧副本）。
```

- [ ] **Step 9: Commit + 交付报告**

```powershell
git add AGENTS.md package.json packages/gateway-sdk/package.json packages/tui/package.json packages/desktop/package.json
git commit -m "chore: bump version to 4.17.0 (plugin stopgap: dead code, packaging, wiring)"
```
（bump-version.mjs 触及的 workspace package.json 以 `git status` 实际输出为准增删。）

交付报告包含：4 个 commit hash、删除行数统计（`git diff --stat 4.16.1..HEAD -- src/`）、gateway 测试数、冒烟结果（含双加载判定结论）。

---

## 后续阶段（另行立项，不在本计划）

- **Phase 1**：opencode v2 spike（验证 `session.hook("context")` recall 注入 / `tool.hook` 观察捕获 / `ctx.mcp.transform` 替代 self-wiring / `Service.ensure()` 替代手写 sidecar）→ 产出迁移成本估算。
- **Phase 2**：pi 认知面补齐（mafw-host extension 六动词）+ pi autoApprove 旁路修复；届时重评 session-ending.ts / state.ts（legacy goal 环路去留）。
- **Phase 3**：HostAdapter 契约化（认知面入 runtime 契约），v1 插件降级 shim。

依据：`docs/research/2026-10-03-agent-runtime-sdk-survey.md`（§5.2 优先级、§7 能力定界）。
