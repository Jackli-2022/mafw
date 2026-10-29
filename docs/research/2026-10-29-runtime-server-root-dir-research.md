# Runtime server 启动根目录调研（opencode serve cwd）

2026-10-29 · 状态：已实施（B 方案：`~/.mafw/runtime-root`）

## 1. 要解决的问题

MAFW 的 agent runtime server（当前是内置 opencode `serve`）需要一个**稳定、跨项目共享的启动目录**：

- 不能是当前项目根：切项目后 server 不重启，cwd 会变成旧项目；
- 不能是 gateway 的启动目录：桌面端由 Electron/快捷方式启动，cwd 不可控；
- session 的工作目录必须仍然由 `SessionCreateOpts.directory` 显式决定。

用户裁决：**server 不随项目重启，启动根目录用用户主目录。**

## 2. 现状（代码事实）

| 事实 | 位置 |
|---|---|
| gateway 由 desktop spawn，未设置 cwd | `packages/desktop/src/main/mafw-sidecar.ts:120-128` |
| gateway 最终由 `new MafwScheduler('.')` 启动 | `gateway/src/index.ts:8614` |
| serve 由 runtime 契约 `agentProcess.spawnServe` 拉起 | `gateway/src/index.ts:3902-3927` |
| opencode 的 spawn 实现在 `startServeSidecar` | `gateway/src/runtime/opencode-runtime.ts:488-511` |
| 实际 spawn **没有传 `cwd`** | `gateway/src/runtime/serve-sidecar.ts:141-150` |
| 默认 bind `127.0.0.1:4096` | `gateway/src/config.ts:423-425` |
| 会话目录唯一权威是 `opts.directory`（必填、绝对） | `gateway/src/runtime/contract.ts:135-139` |
| gateway 解析会话目录：UI 当前项目优先，否则 config 根 | `gateway/src/index.ts:1558-1560` |
| 项目切换写 `currentProjectDir` + kv | `gateway/src/index.ts:5526-5527` |
| runtime 插件 ctx 的项目根是创建时快照 | `gateway/src/index.ts:1603-1606`、`loader.ts:27-29` |

结论：现在 `opencode serve` 的 cwd **完全取决于 gateway 进程从桌面继承到的目录**，没有规范。

## 3. 实证（隔离 probe，opencode 2.1.0）

目的：确认 cwd 到底影响什么，避免把「server 根目录」和「session 目录」混在一起。

方法：

1. 建临时 `server-root`（作为 serve cwd）与 `project-b`（作为 session location）；
2. 用 `opencode.exe serve --hostname=127.0.0.1 --port=4199` 启动，`cwd=server-root`，env 带 `OPENCODE_CONFIG_CONTENT='{}'` + 已知密码；
3. 通过 HTTP 创建 session：`POST /api/session { location: { directory: projectB } }`；
4. 分别观察 `/api/project`、`/api/config`、`/api/agent`、`POST /api/session`；
5. 删除 session、树杀 serve、删除临时目录。

### 结果

| 观察点 | 结果 |
|---|---|
| server 启动 | 正常输出 `server listening on http://127.0.0.1:4199` |
| `/api/project` | **serve 的 cwd 被注册成一个 opencode project**（`server-root`）；`projectB` 在创建 session 时也被注册 |
| `POST /api/session {location.directory: projectB}` | 200；返回的 session `location.directory` **精确等于 projectB** |
| 删除 session | 204 |
| `/api/config`（默认 location） | 全局配置 + **server cwd 的 `.opencode`** |
| `/api/config` + `x-opencode-directory: projectB` | 全局配置 + **projectB 的 `.opencode`**；不再包含 server cwd 的 `.opencode` |
| `/api/agent` | 只按默认 location 返回内建 agent；带 directory 头也不改变（opencode 的 agent 列表不是 project-scoped） |

### 结论

1. **cwd 只决定默认 location**，不会决定显式 session 的目录；
2. 每个 project-scoped 请求带 `directory` / `x-opencode-directory` 时，配置按目标项目解析；
3. **cwd 会被注册成 project**——这是一个副作用，主目录作为 cwd 时也会被登记为主目录项目；
4. 不传 directory 的 API（如 `/api/agent`、默认 `/api/config`）会落在 server cwd。

## 4. 主目录实际是什么

本机实测：

```
os.homedir()        C:\Users\15524
opencode debug paths home  C:\Users\15524
opencode data       C:\Users\15524\.local\share\opencode
opencode config     C:\Users\15524\.config\opencode
```

注意：`C:\home\ubuntu` 是 npm 全局 prefix，不是用户主目录；不要把它当 root。

主目录现状：

- `C:\Users\15524\.opencode\opencode.json`：只有 `$schema`；
- `C:\Users\15524\.opencode\mafw\`：旧版 MAFW 数据目录（不是项目配置）；
- 没有 `C:\Users\15524\AGENTS.md`、没有 `.git`；
- 全局 `~/.config/opencode/opencode.jsonc` 配置了 MAFW + superpowers 插件、MCP、providers。

因此 **当前**以主目录为 cwd 不会加载到主目录 AGENTS.md；但会：

- 把主目录注册为 opencode project；
- 默认 location 使用主目录的 `.opencode` 配置；
- 若未来主目录出现 `AGENTS.md` / `.opencode/plugin`，会成为默认配置的一部分。

另外，opencode 的配置发现会向上走父目录：位于 `C:\Users\15524\...` 下的项目本来就会继承主目录 `.opencode`。本次 probe 的 `projectB` 就同时看到了主目录 `.opencode` 和自身 `.opencode`。这是 opencode 既有语义，不是 cwd 引入的。

## 5. 方案对比

### A. 字面主目录 `os.homedir()`（用户当前选择）

- 优点：稳定、跨项目、符合“共享 server”心智；
- 代价：opencode project 表会多一个主目录 project；默认 location 使用主目录配置；
- 对显式 session 无影响（`opts.directory` 仍然权威）。

### B. 主目录下的专用 runtime root（如 `~/.mafw/runtime-root`）

- 优点：同样稳定；不会把主目录登记成 project；默认 `.opencode` 不会命中主目录；
- 代价：不是字面主目录；需要创建/校验目录；插件若依赖“server cwd=home”需要改。

### C. 可配置 `runtime.rootDir`，默认主目录

- 保留 A 的默认行为，同时允许用户改到专用目录；
- 需要契约字段、配置校验、文档与测试；
- 对 runtime 插件暴露 `ctx.rootDir`，对 `agentProcess.spawnServe` 传入 root。

## 6. 推荐规范（待批准）

1. **server root 单源**：`runtime.rootDir`（默认 `os.homedir()`），必须绝对路径、存在、目录；
2. **内置 opencode**：`startServeSidecar` 显式 `cwd: rootDir`，日志打印实际 cwd；不再继承 gateway cwd；
3. **runtime 插件**：`RuntimePluginContext.rootDir` 暴露同一值；`external: true` 的插件启动自己的 server 时必须用它；gateway 不猜；
4. **session 目录**：`SessionCreateOpts.directory` 仍必填；任何 project-scoped 请求都必须带 directory；禁止回落到 server cwd / `ctx.projectDir`；
5. **测试**：
   - `serve-sidecar.test.ts` 断言 spawn options `cwd === os.homedir()`（或注入的 root）；
   - runtime plugin ctx 测试断言 `rootDir` 为绝对路径；
   - 集成 probe 断言：cwd=root 时显式 session 的 `location.directory` 不变；
6. **文档**：runtime-plugin-authoring skill 增加“server root vs session directory”一节。

## 7. 未决问题

- 是否接受“主目录被 opencode 注册为 project”这一副作用（方案 A），还是用专用 `~/.mafw/runtime-root`（方案 B）？
- `runtime.rootDir` 是否需要配置覆盖（方案 C），还是 v1 固定主目录？
- `/api/agent` 当前不按 directory 解析；若未来需要项目级 agent 列表，应另行给 adapter 加 directory 参数（本次不扩）。

## 8. 实施记录（2026-10-29）

按 B 方案落地：

- 新增 `gateway/src/runtime/runtime-root.ts`：`resolveRuntimeRoot()` / `ensureRuntimeRoot()`；
- `serve-sidecar.ts` spawn 显式 `cwd = ensureRuntimeRoot(rootDir ?? ~/.mafw/runtime-root)`；
- `ServeSpawnOpts.rootDir` + `RuntimePluginContext.rootDir` 同源；
- gateway 的 `startServe` / supervisor spawn / plugin ctx 全部传 root；
- session cwd 不变（`opts.directory`）；
- 测试：gateway **3044/3044（427 suites）**、tsgo/build rc=0。

**边界**：external/adopted serve 的 cwd 由外部所有者负责；gateway 只保证自己 spawn 的 serve 从 runtime root 启动。

## 9. 证据文件

- probe 脚本：`C:\Users\15524\AppData\Local\Temp\opencode\serve-cwd-probe2.mjs`（临时，未入库）
- 代码：`gateway/src/runtime/serve-sidecar.ts`、`opencode-runtime.ts`、`runtime/loader.ts`、`runtime/contract.ts`
- 既有契约：`docs/superpowers/specs/2026-10-20-session-directory-contract-design.md`
