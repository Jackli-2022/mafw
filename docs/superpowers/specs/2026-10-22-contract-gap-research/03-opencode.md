# 03 · OpenCode 能力面盘点 — MAFW 网关契约缺口研究

> 调研日期：2026-10-22 · 只读调研代理产出 · 姊妹篇：本目录其他 runtime 盘点
> 对照基线：MAFW 网关契约（MafwMessage/MafwPart flat DTO、事件族、RuntimeClient 动词，见 `gateway/src/runtime/contract.ts`）
> 方法：本地 SDK 类型逐行枚举 + npm/官方 docs/GitHub releases 网络核实 + gateway/plugin 源码消费面 grep + 运行时实例化验证。

**证据缩写**（本地路径均相对 `C:\work\work-loop\opencode-plugin-mafw\`）：
- `SDK/` = `gateway/node_modules/@opencode-ai/sdk/`（**1.18.21**，与 opencode CLI v1.18.21 锁步）
- `SDK/dist/gen/sdk.gen.d.ts` = **SDK1**（v1 客户端）；`SDK/dist/gen/types.gen.d.ts` = **SDK1T**
- `SDK/dist/v2/gen/sdk.gen.d.ts` = **SDK2**（v2 客户端：兼容层 Session2 + v2 原生类）；`SDK/dist/v2/gen/types.gen.d.ts` = **SDK2T**
- `[API]` = https://opencode.ai/v2/docs/api （v2 服务端 OpenAPI 面，146 operations，CLI 2.1.x，访问 2026-10-22）
- `[docs:xxx]` = https://opencode.ai/v2/docs/xxx/ （v2 文档，更新至 2026-10-20）；`[v1docs:xxx]` = https://opencode.ai/docs/xxx/

---

## ① 版本钉扎

| 层 | 本地/本机 | 上游最新（2026-10-22） | 对应关系与增量 |
|---|---|---|---|
| `@opencode-ai/sdk`（gateway 依赖 `^1.18.21`） | **1.18.21**（`SDK/package.json:4`） | **1.19.3**（2026-10-16 发布，npm provenance 与 opencode v1.19.3 同仓库同日） | SDK 版本号与 **v1 线 CLI** 锁步（v1.18.21 release = 2026-08-21，GitHub releases API 实测）。**1.18.21→1.19.3 API 面零增量**：tarball 实 diff 仅 4 处类型微调（`chunkTimeout: number\|false`、模型 variant `reasoning_options`（effort/toggle/budget_tokens）、`update` 语义改"仅通知不自动装"、`global.upgrade` target 变必填）——无新命名空间/方法。本地枚举即当前枚举 |
| `@opencode-ai/sdk`（**root** `package.json` `^1.17.12`） | **1.18.30**（`node_modules/@opencode-ai/sdk`） | — | ⚠️ 仓库内 SDK **三副本**（gateway 1.18.21 / root 1.18.30 / npm 1.19.3）；gateway 编译走自己的 1.18.21，root 副本仅供 plugin dev loop，升级时需三处对齐 |
| OpenCode CLI（v2 线，`@opencode/cli`） | **v2.1.0**（本机 `opencode --version` 实测；npm 发布 2026-10-20） | **2.1.2**（2026-10-21） | v2 与 v1 **共用 `opencode` 命令、不可并存**（[v1docs:intro]）。MAFW serve sidecar spawn 的就是 2.1.0 |
| v2 生态包（全部 **2.1.2 锁步**） | 未消费 | `@opencode/plugin` 2.1.2（插件 API）、`@opencode/client` 2.1.2（网络客户端 + `Service.discover/ensure/stop` 后台服务管理）、`@opencode/sdk` 2.1.2（**进程内宿主**："executes Server's assembled HTTP router in memory, opening no listener"——npm 元数据原文）、`@opencode/{core,server,schema,protocol,ai,util,theme}` | v2 已模块化：MAFW 用的 `@opencode-ai/sdk` 是**旧一代 hey-api 双客户端**（v1 兼容 + v2 子集）；新一代分 `client`（网络）/`sdk`（进程内）/`plugin`（宿主扩展）三包 |
| 代码仓库 | — | **github.com/anomalyco/opencode**（已从 sst/opencode 迁移；docs/npm provenance 一致） | GitHub releases 只对 **v1.x** 出 notes（v1.19.3=2026-10-16 最新）；**v2.x 有 tag（v2.1.2）无 release notes**——v2 changelog 以 docs 为准 |

**结论（钉扎）**：本地 SDK 1.18.21 ≈ npm 1.19.3（无 API 增量），但**两者都落后于 v2 服务端真实面**——SDK2 客户端只覆盖 v2 OpenAPI 146 操作中的一部分；v2 新面（forms/voice/shell 路由/persistent-pty/fs.write/session import-export/instructions/pairing 等，见 §2.4）只能直接 HTTP 消费。CLI 2.1.0 → 2.1.2 为补丁位差距。

---

## ② SDK API 面全枚举 vs 已消费面

### 2.1 我们已消费的面（证据）

**HTTP/SDK 侧**（`gateway/src/runtime/opencode-adapter.ts`，经 `@opencode-ai/sdk/v2` `createOpencodeClient`，:62）：

| 动词 | 证据 |
|---|---|
| session.create / promptAsync / prompt（parts+agent+model+variant+system+noReply）/ messages(limit,before) / get / delete / update(title) / abort / list(directory) / todo / children / summarize(providerID,modelID) / fork / revert(messageID,partID) / unrevert / diff | opencode-adapter.ts:104-268 |
| vcs.diff(mode) / vcs.apply(patch)（diffApi） | :270-278 |
| question.list / reply / reject（+ directNative `/question/:id/reply|reject` 带 directory） | :298-330 |
| permissionList → directNative `GET /permission` | :332-335 |
| permissionReply → `(client.session as any).permission.reply` | :286 ⚠️ **见 §3.0 契约风险** |
| global.event()（全局 SSE 事件流） | :340；index.ts:1078 |
| provider.list() / app.agents() / config.get() / config.update() | :346-369 |
| 工具注册：`registerTools` ack no-op + `OPENCODE_NATIVE_TOOLS` 静态清单（六件套由 v1 宿主插件 + MCP 自接线承载） | :374-379 |
| completionApi：`config.get()` 解析 provider baseURL/apiKey + auth.json 直读 | opencode-runtime.ts:333-357、runtime/auth.ts:12-38 |
| credentials：`~/.local/share/opencode/auth.json` 直读（不走 API） | runtime/auth.ts:14 |
| sessionStorageApi：opencode SQLite（opencode.db）直读 listByDirectory | opencode-runtime.ts:8-11、contract.ts:40 |
| agentProcessApi：自有 spawn/kill `opencode serve` sidecar（SDK `createOpencodeServer` 已弃用改手写） | opencode-runtime.ts:363-384、serve-sidecar.ts |
| agentConfigApi：agent md 文件物化（description/mode/model/system/permissions frontmatter） | opencode-runtime.ts:188-227 |
| MCP 接线：激活期写全局 `opencode.jsonc` `mcp` 段（**文件写入，非 mcp.add API**） | src/utils/self-wiring.ts |

**事件侧**（`gateway/src/runtime/opencode-events.ts`，2.x serve legacy/next 双发双方言互斥消费）：
- 消费：`session.idle/error`→turn 终态、`message.part.updated/delta`→part.*、`todo.updated`→plan.updated、`session.next.prompted`、`session.next.tool.called/progress/success/failed`（工具三原语）、`session.next.text/reasoning.delta`、`session.next.compaction.started/ended`、`permission.v2.asked/replied`、`question.v2.*`、`message.updated`（transform 翻 info→message）、canonicalIdentity 恒等行（session.created/updated/deleted 等）——opencode-events.ts:36-205
- **显式 drop（有语义价值但未消费）**：`session.next.{retried, revert.*, agent.switched, model.switched, moved, prompt.admitted, context.updated, synthetic, shell.*, step.*}`、`message.removed/part.removed`、`compaction.delta`、遥测 41 族（`file.edited/file.watcher.updated/lsp.updated/vcs.branch.updated/pty.*/tui.*/mcp.tools.changed/workspace|worktree.ready/installation.*/server.connected/...`）——opencode-events.ts:51-84、166-201

**插件 API 侧**（`src/plugin.ts`，OpenCode **V2 插件 API**）：`ctx.tool.transform`（六件套 JSON Schema 注册 :148-157）、`ctx.session.hook('context')`（messages+system 注入 :160-190）、`ctx.session.hook('prompt')`（admission 观察+媒体指针 :193-203）、`ctx.tool.hook('execute.after')`（:206-225）、`ctx.event.subscribe`（:231）、`ctx.session.context/synthetic/prompt`（:238/252/271）、`ctx.command.transform`（:250）。

### 2.2 SDK1（v1 客户端命名空间，SDK1 全枚举）

`global{event}` · `project{list,current}` · `pty{list,create,remove,get,update,connect}` · `config{get,update,providers}` · `tool{ids,list}` · `instance{dispose}` · `path{get}` · `vcs{get}` · `session{list,create,status,delete,get,update,children,todo,init,fork,abort,unshare,share,diff,summarize,messages,prompt,message,promptAsync,command,shell,revert,unrevert}` · `command{list}` · `oauth{authorize,callback}` · `provider{list,auth}` · `find{text,files,symbols}` · `file{list,read,status}` · `app{log,agents}` · `auth{remove,start,callback,authenticate,set}` · `mcp{status,add,connect,disconnect,auth.*}` · `lsp{status}` · `formatter{status}` · `control{next,response}` · `tui{appendPrompt,openHelp,openSessions,openThemes,openModels,submitPrompt,clearPrompt,executeCommand,showToast,publish,control}` · `event{subscribe}` · 顶层 `postSessionIdPermissionsPermissionId`（SDK1:22-403）

### 2.3 SDK2（v2 客户端：兼容层 + v2 原生，SDK2 全枚举）

**兼容层（打 v1 风格路由，2.x serve 仍承载）**：`auth{remove,set}` · `app{log,agents,skills}` · `experimental{controlPlane.moveSession, capabilities.get, console.{get,listOrgs,switchOrg}, session.{list,background}, resource.list, projectCopy.generateName, workspace.{list,create,syncList,status,remove,warp,adapter.list}}` · `global{health,event,dispose,upgrade,config.{get,update}}` · `event{subscribe}` · `config{get,update,providers}` · `tool{list,ids}` · `worktree{remove,list,create,reset}` · `find{text,files,symbols}` · `file{list,read,status}` · `instance{dispose}` · `path{get}` · `vcs{get,status,diff,apply,diff2.raw}` · `command{list}` · `lsp{status}` · `formatter{status}` · `mcp{status,add,connect,disconnect,auth.*}` · `project{list,current,initGit,update,directories}` · `pty{shells,list,create,remove,get,update,connectToken,connect}` · `question{list,reply,reject}` · `permission{list,reply,respond(deprecated)}` · `oauth{authorize,callback}` · `provider{list,auth}` · `session{list,create,status,delete,get,update,children,todo,diff,messages,prompt,deleteMessage,message,fork,abort,init,unshare,share,summarize,promptAsync,command,shell,revert,unrevert}` · `part{update,delete}` · `sync{start,replay,steal,history.list}` · `tui{*,control}`（SDK2:28-1491）
**v2 原生（打 `/api/*`）**：`v2.health` · `v2.location` · `v2.agent.list` · `v2.session{list,create,active,get,switchAgent,switchModel,prompt(delivery/resume),compact,wait,context,history,events,interrupt,message,messages,revert.{stage,clear,commit},permission.{list,create,get,reply},question.{list,reply,reject}}` · `v2.model.list` · `v2.provider.{list,get}` · `v2.integration.{list,get,connect.{key,oauth},attempt.{cancel,status,complete}}` · `v2.credential.{remove,update}` · `v2.permission.{request.list,saved.{list,remove}}` · `v2.fs.{read,list,find}` · `v2.command.list` · `v2.skill.list` · `v2.event.subscribe` · `v2.pty.*` · `v2.question.request.list` · `v2.reference.list` · `v2.projectCopy.{remove,create,refresh}`（SDK2:1492-2240）

### 2.4 v2 服务端 OpenAPI 面（**SDK 未覆盖**、需直连 HTTP；CLI 2.1.x，[API]）

`POST /api/pair`+`GET /auth/connect/{code}`（配对码）· `POST /api/location/reload`（热重载配置）· `GET /api/agent/{agentID}` · `POST /api/plugin/check|update` · `GET /api/experimental/session/stats`（SessionStats：activity/model usage/tool totals）· `POST /api/experimental/session/import`+`GET /api/experimental/session/{id}/export`（**会话导入/导出**）· `POST /api/experimental/session/{id}/skill`（激活 skill）· `GET/PUT/DELETE /api/experimental/session/{id}/instructions/entries{,/key}`（**每会话动态 instruction 条目**）· `GET /api/session/{id}/inbox`+`PATCH/DELETE /api/session/{id}/inbox/{inboxID}`（**持久 inbox**：User/Synthetic/Compaction/Move，可取消）· `POST /api/session/{id}/generate`（会话上下文一次性生成）· `GET /api/experimental/session/{id}/log` · `POST /api/session/{id}/move` · `POST /api/session/{id}/view` · `GET/POST /api/session/{id}/form`+`reply`（**表单系统** Form.*）· `PUT /api/session/{id}/environment` · `POST /api/experimental/generate`（无状态生成）· `GET /api/experimental/voice/models`+`POST /api/experimental/voice/session(+instructions)`（**语音会话** WebRTC/WebSocket）· `POST /api/experimental/integration/wellknown` · `integration connect/external` · `PUT/DELETE /api/experimental/mcp/{server}`（add/**remove**）· `POST /api/credential`（**create**）+`activate` · `POST /api/vcs/init`+`GET /api/vcs/base|branch` · `POST /api/experimental/fs/write` · `POST /api/worktree/refresh` · `GET/POST /api/shell`+`GET/DELETE /api/shell/{id}`+`GET /api/shell/{id}/output`（**位置级 shell 路由**：后台命令/输出/取消）· persistent-pty 原型（session terminal read/attach、snapshot、handoff、shutdown）· `GET /api/debug/location`+DELETE（位置驱逐）· `GET /api/experimental/migration/v1` · `GET /api/websearch/provider`+`POST /api/websearch` · `GET /api/config/shell` · `GET /api/model/default` · `POST /api/rpc/{rpcID}/{method}`（**插件 RPC**）
消息模型：`Session.Message.Info` = AgentSelected | ModelSelected | LocationSwitched | User | Synthetic | System | Skill | Shell | Assistant | Compaction | Idle（11 形状）；`PromptInput{text, files?, agents?, skills?}`；`Session.ForkBoundary`。

### 2.5 插件 API 全面（`@opencode/plugin` 2.1.2，[docs:build/plugins]）

MAFW 已消费见 §2.1。**未消费**：`ctx.storage`（插件级持久 JSON KV + prefix scan）、`ctx.generate.text`（无会话生成）、`ctx.permission.{assert,list,get,reply}`+`permission.hook('evaluate')`、`ctx.shell.hook('create.before')`、`ctx.session.hook('compaction'|'generate'|'title'|'model.request'|'http.request'|'http.response'|'experimental.ws.*'|'retry')`、transforms：`provider/model/agent/command/integration/mcp/reference/skill/vcs/worktree/websearch`（含 `editor.default.set`、自定义 VCS 提供方、**自定义 worktree 策略**、自定义 websearch 提供方）、`ctx.credential.activate`、`ctx.integration.*`（OAuth/命令式连接）、`ctx.tool` 的 `namespace/update/remove/progress`、插件 RPC（`/rpc` 导出 + 事件）、Effect 插件变体、CLI 插件（`cli.json`）、V1+V2 双形态导出、插件热重载（watch 目录 + `opencode service restart`）。

---

## ③ 超出基线的前沿能力清单（缺口表）

判定口径：**HAVE**=基线已有等价消费；**PARTIAL**=部分消费/网关侧自建替代；**MISSING**=完全未消费。

### 3.0 ⚠️ 先说一个发现的契约风险（基线动词疑似断线）

| 发现 | 证据 |
|---|---|
| **`permissionReply` 的 SDK 目标面不存在**：adapter 调 `(client.session as any).permission.reply(...)`，但 SDK 1.18.21/1.18.30/1.19.3 的 v2 兼容类 `Session2` **没有 `permission` 成员**（运行时实测 `client.session.permission === undefined` → 调用即 TypeError）。正确面是 `client.permission.reply`（兼容全局）或 `client.v2.session.permission.reply`（v2 会话级，参数形状 `{sessionID,requestID,reply,message}` 与现调用完全吻合——疑似漏写 `.v2`）。编译产物同样带此调用（`gateway/dist/opencode-adapter.js:243`）。hook 路径 fail-open 会掩盖（自动应答静默失败），HTTP reply 路由会 500。**serve 当前未运行，未能活体复现；建议列入契约测试修复清单** | opencode-adapter.ts:286；`node -e` 实例化验证输出（本调研）；SDK2 Session2 类定义（SDK2:952-1280 无 permission getter）vs Permission2（SDK2:1550-1596） |

### 3.1 会话与事件模型

| # | 能力 | SDK/HTTP 表面 | 判定 | 对多运行时网关契约的意义 | 证据 |
|---|---|---|---|---|---|
| 1 | **持久事件历史 + 按会话 SSE 回放**（seq 游标：先重放后直播） | `v2.session.history{after,limit}`、`v2.session.events{after}`、`SessionDurableEvent`/`SessionHistory{hasMore}`、`sync.history.list`（聚合级） | **MISSING** | 根治我们的 SSE 脆弱性：serve watchdog 重启/重订阅**不再丢事件**（当前 `subscribeToEvents` 重连即断档）；契约可加 `session.events(after)` 原语，pi 侧用快照补 | SDK2:1726-1739；SDK2T:2247-2251 |
| 2 | **持久 prompt inbox**（`delivery:'queue'`、取消待处理输入、幂等 `id`、`resume:false` 仅入队不执行） | `v2.session.prompt{id,delivery,resume}`、`GET/PATCH/DELETE /api/session/{id}/inbox/{inboxID}`、`Session.Inbox.{User,Synthetic,Compaction,Move}` | **PARTIAL**（仅 delivery:steer） | 基线 `SessionPromptOpts.delivery` 只有 steer；queue+取消+幂等重试是"goal 派发不丢消息"的运行时中立原语；Move 作为 inbox 项可见 | SDK2:1690-1696；[API] session 组；SDK2T Session.Inbox.* |
| 3 | **富消息模型**（11 形状：AgentSelected/ModelSelected/LocationSwitched/Skill/Shell/System/Compaction/Idle…） | `Session.Message.Info` union | **PARTIAL**（flat user/assistant） | MafwMessage 只有 user/assistant；agent/model 切换、skill 装载、shell 消息若进契约，桌面/TUI 可显示系统级事件流 | [API] Schemas；SDK2T:128-145（UserMessage.format/summary/agent/model） |
| 4 | **未消费 part 类型**：`snapshot`（文件快照 id）、`patch`（hash+files）、`agent`（子代理提及）、`retry`（attempt+error）、`compaction`（auto 标记）、`subtask`（子任务快照） | SDK1T:300-353 Part union | **PARTIAL**（基线 6 类） | patch/snapshot 是"本回合改了哪些文件"的第一手数据（现靠 diffApi 二次拉取）；subtask/agent part 是子代理编排的可视化载体 | SDK1T:300-353 |
| 5 | part 级变更与消息删除：`part.update/part.delete`、`session.deleteMessage`（不回滚文件） | SDK2:1281-1303、:1109-1114 | **MISSING** | 网关侧工具卡编辑/撤回；与 message.removed/part.removed 事件配对 | SDK2:1281-1303 |
| 6 | 会话检索面：全文 `search`、游标分页（cursor.prev/next）、`roots`、`archived` 归档（`time.archived`）、`slug` | Session2.list 参数（SDK2:958-967）、`session.update{time.archived}`、v2 SessionV2 | **PARTIAL**（list(directory) 全量） | 网关 session.listByDirectory 现走 SQLite 直读；search/分页可下沉 runtime；archived 是"归档不删除"生命周期原语（goal archive 可用） | SDK2:958-967/1024-1036；SDK2T:64-115 |
| 7 | **会话迁移/移动**：`session.move`（跨目录，安全边界生效）+ `experimental.controlPlane.moveSession`（跨项目+可选带走变更）+ LocationSwitched 消息 | SDK2:88-92、[API] | **MISSING** | goal worktree 归档（archive-worktree）可用原生 move 替代自研搬运 | SDK2:88-92 |
| 8 | 会话统计/日志：`/api/experimental/session/stats`（activity/model usage/tool totals）、`/api/experimental/session/{id}/log` | [API] | **MISSING** | usage.updated 事件之外的结构化用量面（TrajectoryStore 可交叉校验） | [API] |
| 9 | **会话导出/导入**（`opencode session export --sanitize` / `import`；experimental API） | [API] session 组；[docs:cli/commands] | **MISSING** | TUI `/export` 是自研 Markdown 导出；原生 JSON export/import（含脱敏）是备份/迁移/评测数据源 | [docs:cli/commands] |
| 10 | 事件族缺口（v2 新词被 drop）：`session.next.retried`（重试可见性）、`revert.staged/cleared/committed`、`agent.switched/model.switched`、`prompt.admitted`、`context.updated`、`compaction.delta`、`file.edited`、`file.watcher.updated`、`lsp.updated`、`vcs.branch.updated`、`mcp.tools.changed`、`installation.update-available` | opencode-events.ts drop 行 | **PARTIAL** | retried→turn 级重试可观测（BudgetGuard 误判防线）；update-available→gateway 可代办升级；file.edited→回合 diff 增量信号 | opencode-events.ts:166-201 |

### 3.2 子代理与编排（含"tasks"核实结论）

| # | 能力 | 表面 | 判定 | 意义 | 证据 |
|---|---|---|---|---|---|
| 11 | **核实结论：不存在 `tasks` create/update/subscribe API**——SDK 1.19.3 双 gen、v2 OpenAPI 146 ops 均无 task 命名空间；v1 的 `task` 工具在 v2 更名为 `subagent`（permissions 文档明示 V2 用 `subagent` 替代 `task`） | 全量枚举反证 | N/A | "任务"= 子代理子会话（下两条）+ todo（plan）+ 我方 goal 系统 | SDK1/SDK2/[API] 全枚举；[docs:permissions] "V2 uses … `subagent` instead of … `task`" |
| 12 | **原生 subagent 工具**：`subagent{agentID,description,prompt,background:true}`——前台等待/后台返回 sessionID 续聊；`subagent_depth`（默认 1 层） | [docs:tools] Subagent 节；config `experimental.subagent_depth` | **MISSING** | MAFW goal 编排现全量 spawn 顶层 session；原生后台子会话 = 轻量并行 wave（explore/review 类只读节点）+ parentID 天然成树（session.children 已消费） | [docs:tools]；[docs:config] |
| 13 | prompt 内子任务部件：`SubtaskPartInput{prompt,description,agent,model?,command?}`、`AgentPartInput{name}`（@agent 提及） | SDK2T:2119-2140 | **MISSING** | prompt 载荷可声明子任务——多 runtime 契约 `SessionPromptOpts.parts` 可扩展 | SDK2T:2119-2140 |
| 14 | **同步子代理转后台**：`experimental.session.background`（detach 阻塞中的 subagent 继续后台跑） | SDK2:157-161、`POST /api/session/{id}/background` | **MISSING** | 长任务的"转后台"原语——goal execute 节点 watchdog 场景直接受益 | SDK2:157-161 |
| 15 | 原生步数上限：agent `steps`（末步撤工具+强制总结；新输入重置） | [docs:agents] Options/Steps | **PARTIAL**（网关 BudgetGuard maxTurns 自建） | 原生强制比网关侧 abort 温和（收尾总结而非硬停）；契约可暴露 `agent.steps` | [docs:agents] |
| 16 | agent 定义全量字段：`mode: primary/subagent/all`、`hidden`、`color`、`disabled`、`request`（headers/body overlay，暂不生效）、`default_agent`、内置 build/plan/general/explore + 隐藏 compaction/title/summary | [docs:agents]；agent md/JSONC 双形态 | **PARTIAL**（物化 5 字段） | `hidden` 可把 mafw-* 身份从用户切换列表隐藏；`disabled` 可按项目关内置 agent；plan agent 写 `~/.opencode/plan` 的文件边界 | [docs:agents]；opencode-runtime.ts:188-227 |
| 17 | **会话级 sticky agent/model 切换**：`v2.session.switchAgent/switchModel`（后续 provider turn 生效）+ AgentSelected/ModelSelected 消息/事件 | SDK2:1672-1684 | **MISSING**（仅 per-prompt agent/model 参数） | 桌面/TUI 的 agent 选择现每 prompt 重发；sticky 切换 + 切换事件 = UI 状态与 runtime 真值同步 | SDK2:1672-1684 |

### 3.3 权限与交互

| # | 能力 | 表面 | 判定 | 意义 | 证据 |
|---|---|---|---|---|---|
| 18 | **v2 规则模型**：`{action, resource, effect: allow/deny/ask}` 三段 + `*`/`?` 通配 + last-match-wins + 层级合并（project→global→agent 追加）+ `external_directory` 边界 + MCP 工具 action（`<server>_<tool>`） | [docs:permissions] | **PARTIAL**（MAFW 自有 prefix 规则） | 我方 `isReadOnlyTool`+三档预设可编译成 opencode 原生 ruleset 下推，审批判定在 runtime 侧一次完成（不再事后 reply） | [docs:permissions] |
| 19 | **会话级 ruleset**：`session.create/update{permission: PermissionRuleset}`，子会话继承创建时规则 | SDK2T:58-63、SDK2:973-989/1024-1036 | **MISSING** | goal 会话可按 taskType 下发专属规则集（如 review 节点 deny edit） | SDK2T:58-63 |
| 20 | **saved approvals**：`always` 回复由工具提议 pattern 沉淀为**项目级持久 allow**（不覆盖 deny）；`v2.permission.saved.{list,remove}` 管理 | [docs:permissions] Approvals；SDK2:1954-1971 | **PARTIAL**（自有 permission-rules.json，两套账本） | 我们切片 1 自建沉淀；对齐原生后 TUI/桌面/opencode TUI 三端共享同一份批准记忆 | [docs:permissions]；SDK2:1954-1971 |
| 21 | **编程式权限请求**：`v2.session.permission.create`（evaluate→ask 则建请求）+ `permission.request.list`——外部动作可走同一审批管线 | SDK2:1560-1575 | **MISSING** | MAFW 自有 approval（mafw_ask_user/桌面 Approvals）可统一挂到 runtime 权限面，用户一个收件箱 | SDK2:1560-1575 |
| 22 | **插件权限钩子**：`ctx.permission.hook('evaluate')`（allow/ask 后可改判）+ `ctx.permission.assert`（插件工具动作断言，`save` 提议沉淀 pattern） | [docs:build/plugins] Permissions 节 | **MISSING** | MAFW 审批政策（ApprovalPolicyService 三档）可作为 opencode 插件钩子**前移**进 runtime，替代事件环 + permissionReply 回写（也顺带修复 §3.0） | [docs:build/plugins] |
| 23 | **policies**（组织级硬拒层）：`provider.use / tool.use / integration.use`，Console/MDM 下发、优先级反转（broader 配置后评估） | [docs:policies] | **MISSING** | 多租户/合规面；网关可读策略做"为什么被拒"的归因展示 | [docs:policies] |
| 24 | **表单系统**：session/location `form` create/reply/cancel（字段：string/number/integer/boolean/multiselect/external + `when` 条件）+ **MCP elicitation**（服务器中途要输入）+ question v2 | [API] form 组；[docs:mcp-servers] Input requests | **PARTIAL**（question 三动词） | 比 question 富得多的结构化交互；MCP elicitation 到达时若网关不代理，用户侧只见卡死 | [API]；SDK2T:5839-5868 |
| 25 | **TUI 控制面**：`tui.appendPrompt/submitPrompt/selectSession/showToast/publish/executeCommand` + `control.next/response`（TUI 请求队列） | SDK2:1381-1491 | **MISSING** | 用户若同时跑 opencode TUI，网关可向其投递提示/toast/跳转会话（"另一个前端"通道） | SDK2:1381-1491 |

### 3.4 工具与上下文供给

| # | 能力 | 表面 | 判定 | 意义 | 证据 |
|---|---|---|---|---|---|
| 26 | **Code Mode（`execute` 工具）**：JS 沙箱编排工具目录（并行调用/中间值不进上下文）；MCP 工具默认经它（`codemode:false` 可关）；`opencode` 命名空间（session_rename/session_move/worktree_*）+ desktop `browser` 命名空间（tab/快照/点击/截图/网络/Lighthouse） | [docs:tools] Execute/Browser/Sessions/Worktrees 节 | **MISSING** | 工具编排下沉 runtime（我方无对应物）；browser 面与 MAFW desktop 自动化重叠，可评估复用 | [docs:tools] |
| 27 | **后台 shell**：`shell{background:true}` 无超时+完成通知+大输出托管文件；`/api/shell` 路由（list/run/cancel/output） | [docs:tools] Shell；[API] shell 组 | **PARTIAL**（TUI `!` 本地 shell；网关无） | goal execute 节点的 dev server/长命令原语；输出托管文件 = 工具输出预算的 runtime 解法 | [docs:tools] |
| 28 | **find 三件套**：`find.text`（ripgrep）、`find.files`、**`find.symbols`（LSP 符号搜索）** over HTTP | SDK1:227-240、SDK2:430-464 | **MISSING** | 网关/curator 的只读探测面可走 runtime（无需自带 grep 进程）；symbols 是符号级检索增量 | SDK1:227-240 |
| 29 | **file/fs API**：`file.list/read/status`（git 状态）、`v2.fs.read/list/find`、`POST /api/experimental/fs/write` + `file.edited/file.watcher.updated` 事件 | SDK1:241-254、SDK2:1978-2016、[API] | **MISSING** | curator 只读验证（A 切片）可从"bash 放行"改为 fs/find 白名单面；file.edited 事件驱动回合 diff 增量 | SDK1:241-254 |
| 30 | **LSP 集成**：30+ 内建语言 server（按扩展名自启）、诊断进 agent 回路（`lsp.client.diagnostics` 事件）、`lsp.status`、`lsp` config（disabled/command/env/initialization）；v2 schema 保留 `Config.LSP.ServerEncoded` | [v1docs:lsp]；SDK1:306-311 | **MISSING** | 编辑后诊断反馈闭环（现在靠 bash 跑 lint）；状态页可显示 LSP 健康 | [v1docs:lsp] |
| 31 | **skills 全面**：`skill` 工具按 ID 装载、`@skill-id` 提及、`PromptInput.skills` 附件、`POST /api/experimental/session/{id}/skill` 会话激活、HTTP skills catalog（index.json+version 缓存）、`autoinvoke` 开关、`v2.skill.list`、`skill.transform`、发现 `.claude/.agents` 兼容目录 | [docs:skills]；[API] | **PARTIAL**（只写 SKILL.md 文件） | W2 skill 物化只走文件；消费 API 可热装载/按会话激活/远程 catalog（团队分发） | [docs:skills] |
| 32 | **references**：命名外部目录/Git 仓库（自动 clone/24h 刷新/`repos/` 缓存）+ `v2.reference.list` + `reference.transform` + `reference.updated` 事件 | [docs:references]；SDK2:2164-2176 | **MISSING** | 跨项目知识供给（文档/规范仓）——比"读绝对路径+external_directory 放行"更结构化 | [docs:references] |
| 33 | **每会话 instruction entries**：`GET/PUT/DELETE /api/experimental/session/{id}/instructions/entries{,/key}`（动态指令切片，压缩后成为基线） | [API] session 组 | **MISSING** | `<user-profile>/<agent-priors>` 现每轮 transform 注入；原生 per-session 指令条目可**压缩免疫 + 免每轮注入**，是记忆披露层的更优载体 | [API] |
| 34 | 每会话环境变量：`PUT /api/session/{id}/environment` | [API] | **MISSING** | worker 会话隔离 env（API key/特性开关） | [API] |
| 35 | websearch 供给：`GET /api/websearch/provider`+`POST /api/websearch`、`websearch` config、插件自定义 provider（`websearch.transform`） | [API]；[docs:websearch] | **MISSING** | 网关可统一搜索配额/替换搜索引擎 | [API] |

### 3.5 提供方与凭据

| # | 能力 | 表面 | 判定 | 意义 | 证据 |
|---|---|---|---|---|---|
| 36 | **integrations/credentials 体系**：`integration.list/get`、connect `key/oauth/command/external`、attempt 轮询/取消、`credential` CRUD+`activate`（多凭据每集成）、`opencode auth login --method/logout/switch`（多账户）、`wellknown` 注册 | SDK2:1788-1940；[API]；[docs:cli/commands] | **PARTIAL**（只读 auth.json） | credentials 契约目前是"读文件"；原生 CRUD/激活/多账户可让 gateway 管理凭据生命周期（轮换、按项目账户） | SDK2:1788-1940 |
| 37 | **provider/model 装配面**：`provider.transform`（注册自定义 provider+模型源）、`model.transform`（过滤/改限价/默认模型 `editor.default.set`）、模型 `reasoning_options` variants、`provider.use` 策略、provider 包（`@opencode/ai/providers/*`）、transport `websocket` | [docs:build/plugins]；SDK2T reasoning_options；[docs:policies] | **PARTIAL**（config.update 写 provider 端点） | mafw_get_model_route 的模型目录可改由 transform 注入（含预算标记）；模型热切换不必改配置文件 | [docs:build/plugins] |
| 38 | **无状态生成通道**：`ctx.generate.text`、`POST /api/experimental/generate`、`session.generate`（会话上下文一次性生成，不进历史） | [docs:build/plugins] Generate；[API] | **MISSING**（自有 completionApi 直连 HTTP 等价） | completionApi 是 MAFW 私有直连；原生通道走 opencode 凭据/配额/遥测，可作 pi 无凭据时的兜底 | [API] |
| 39 | **prompt 级结构化输出**：`format: OutputFormat{text\|json_schema{schema,retryCount}}`（prompt/promptAsync 参数） | SDK2T:116-127；SDK2:1085-1103 | **PARTIAL**（仅 completion 通道 responseFormat） | laya 判官/提取器可走 session.prompt + json_schema（带原生重试），免自建 parse-retry | SDK2T:116-127 |
| 40 | **warming（保活）**：闲置会话周期性 transient 请求（4min 间隔/30min 窗口，可自定义 prompt） | [docs:config] Warming；[docs:warming] | **MISSING** | worker 会话前缀缓存保活（现靠 workerCompactIdleMs 轮换妥协） | [docs:config] |
| 41 | **原生 provider compaction**：`settings.compaction: native`（OpenAI Responses 服务端加密检查点）vs `summary`；`compaction.{auto,keep.tokens,buffer}` 全量配置 | [docs:compaction] | **MISSING**（只用 summarize 通道 + 事件） | 原生压缩对 provider 内前缀缓存更友好；keep.tokens 可入契约（compaction 语义参数化） | [docs:compaction] |
| 42 | per-prompt 工具开关与系统覆盖：`prompt{tools:{name:boolean}, system, variant, messageID}` | SDK2:1085-1103 | **PARTIAL**（system/variant/model 已透传；tools map 未透传） | 单回合禁用某工具（如 review 回合禁 write）无需另建 agent | SDK2:1085-1103 |

### 3.6 文件/VCS/快照/工作树

| # | 能力 | 表面 | 判定 | 意义 | 证据 |
|---|---|---|---|---|---|
| 43 | vcs 全家：`status`（工作区变更）、`base`（评审基线）、`branch`（分支搜索）、`init`、`vcs.transform`（自定义 VCS 提供方 + Mercurial 探测 + `init(scope)` 回调）、`project.initGit` | SDK2:529-571；[API] vcs 组；[docs:build/plugins] VCS | **PARTIAL**（diff/apply 已消费） | review 节点可用 `vcs.base` 取评审基线；`/diff` TUI 可用 vcs.status 兜底 | SDK2:529-571 |
| 44 | **分阶段 revert + 文件快照**：`v2.session.revert.stage{messageID,files}/clear/commit`（staged 回滚边界可移动、可选恢复文件）、`Session.revert{snapshot,diff}`、`StepStart/FinishPart.snapshot`、`PatchPart`、`snapshots` config（默认开，内部 git 对象库存储）、`/undo /redo` + `session.next.revert.*` 事件 | SDK2:1526-1548；[docs:snapshots]；SDK1T:275-314 | **MISSING**（基线仅消息级 revert/unrevert；文件恢复自研 hunk-patch 反转） | 原生"对话+文件一起回滚"比我方 diff/revertDiff 补丁反转更完整（含未跟踪文件）；契约可加 `revert.stage/commit(files)` | [docs:snapshots]；SDK2:1526-1548 |
| 45 | **原生 worktree API**：`worktree.{create,list,remove,reset}` + `POST /api/worktree/refresh` + `worktree.directory` config + 插件策略（Rift snapshot 等后端）+ Code Mode `worktree_*` 工具 | SDK2:389-429；[API]；[docs:config] Worktrees | **MISSING**（自研 simple-git SessionWorktreeManager） | 并行会话 worktree 可交 runtime 管（含策略后端/清单/孤儿清理）；`worktree.ready/failed` 事件已有 | SDK2:389-429 |

### 3.7 运行时、运维与宿主形态

| # | 能力 | 表面 | 判定 | 意义 | 证据 |
|---|---|---|---|---|---|
| 46 | **PTY 全家**：`pty.{shells,list,create,remove,get,update,connectToken,connect}`（WebSocket 流）+ **persistent PTY 原型**（会话终端 read/attach、snapshot、handoff、shutdown） | SDK2:740-832、2051-2146；[API] pty/persistentPty 组 | **MISSING** | 桌面可加"会话终端"面板；persistent-pty handoff 是长交互进程跨会话接管的唯一原生通道 | SDK2:740-832 |
| 47 | **voice sessions**（实验）：`voice/models`、`voice/session`（WebRTC/WebSocket transport）、`voice/session/{id}/instructions` 替换 | [API] voice 组 | **MISSING**（自有 TTS/VAD 管线） | 与 MAFW 语音管道重叠——评估"server-brokered 语音"作为桌面 voice 的 runtime 侧替代/补充 | [API] |
| 48 | **pairing / web UI**：`POST /api/pair`+`/auth/connect/{code}`、`opencode pair [--remote]`（OpenTunnel 端到端加密公网暴露）、web UI（密码保护、30 天会话、service set hostname/port/password/cors/env） | [docs:cli/web]；[API] | **MISSING** | MAFW desktop 之外的零安装访问面（手机/异地）；pairing 码机制可借鉴进网关鉴权 | [docs:cli/web] |
| 49 | **session share/unshare**（v1 兼容面仍在）：`session.share/unshare` → 分享 URL（`Session.share.url`） | SDK2:1161-1179；SDK2T:88-90 | **MISSING** | goal 评审产物一键分享链接（只读对话） | SDK2:1161-1179 |
| 50 | **升级与热重载**：`global.upgrade{target}`（API 升级 opencode！）、`opencode upgrade [ver] --method`、`update: notify/auto` config、`opencode reload`（不重启重载配置，运行会话下步生效）、`POST /api/location/reload`、插件 watch 热重载、`instance/global.dispose`、`experimental.location_idle_timeout`（位置卸载）、`GET/DELETE /api/debug/location` | SDK2:317-322；[docs:cli/commands]；[docs:config] | **MISSING** | MAFW 自更新只管 gateway；opencode CLI 升级可纳入 `mafw update`（API 化）；`reload` 可消除"改配置=重启 serve"的窗口 | SDK2:317-322；[docs:cli/commands] |
| 51 | **后台服务模型**：`opencode service start/stop/restart/status/set/unset`（每用户单例共享 server）、`--standalone`/`--server`、`@opencode/client/service` 的 `Service.discover/ensure/stop`（版本兼容谓词） | [docs:cli]；[docs:build/client] | **MISSING**（自管 sidecar） | 网关 spawn 模式与官方 service 模式**可能撞车**（同机用户跑 `opencode` 即起共享 service）；Service.ensure 的注册表发现可替代我们的端口探测 | [docs:cli]；[docs:build/client] |
| 52 | **进程内宿主 `@opencode/sdk`**：`OpenCode.create({plugins})`——内存内执行 server 路由，**零 HTTP listener、零网络跳**，同一 Promise 客户端 API + `await using` 生命周期 | [docs:build/sdk]；npm @opencode/sdk@2.1.2 描述 | **MISSING** | sidecar 架构的终局替代选项：gateway 内嵌 opencode（无 spawn/watchdog/端口），插件经 `OpenCode.create({plugins})` 程序化注册——多 runtime 契约可新增 `embeddedHost` 能力位 | [docs:build/sdk] |
| 53 | **插件 API 未消费面**（详见 §2.5）：storage/generate/permission.assert/evaluate 钩子/shell 钩子/model.request+http+ws+retry 钩子/9 类 transforms/integration/插件 RPC/Effect 变体/CLI 插件 | [docs:build/plugins] | **PARTIAL** | `ctx.storage` 可替代 kv 部分场景；`http.request/response` 钩子可观测 provider 流量（用量对账）；retry 钩子可接管 429 退避策略 | [docs:build/plugins] |
| 54 | **MCP 客户端面**：`mcp.add/connect/disconnect`（动态）、`mcp.auth` OAuth（PKCE/CIMD/DCR）、`GET /api/mcp/resource`（资源读取）、MCP prompts→`/<server>:<prompt>` 命令、elicitation 表单、`{env:}` 替换、per-server timeout、`protocol: 2026-07-28`、`_meta["ai.opencode/sessionID"]` 关联 | SDK2:648-687；[docs:mcp-servers] | **PARTIAL**（仅配置文件自接线） | 自接线后无健康观测（mcp.status/mcp.tools.changed 未消费）；OAuth 型 MCP server 我们完全不支持；MCP prompts 作为命令暴露可桥接网关命令注册表 | [docs:mcp-servers] |
| 55 | **MCP server 模式（opencode 作为 MCP server 暴露）**：核实结论——**当前 v2 文档/CLI/OpenAPI 均无此模式**（无 `opencode mcp serve` 类命令）；对外的"被集成"面是 **ACP**（`opencode acp` stdio Agent Client Protocol，编辑器集成）与**插件 RPC**（`POST /api/rpc/{rpcID}/{method}`） | [docs:cli/commands] acp 节；[API] rpc 组 | **MISSING**（且核实为不存在） | 若想让外部 MCP 客户端消费 MAFW 工具，仍需 gateway 自带 MCP 端点（现状正确）；ACP 是另一个可评估的编辑器接入口 | [docs:cli/commands]；[docs:acp] |
| 56 | **配置面全量**：`config.update` 可写全 schema（references/skills 数组/compaction/warming/snapshots/watcher ignore/tool_output/media/websearch/worktree/permissions/policies/update…）；配置分层合并（system→global→project 直写→.opencode，`.opencode` 全体压过直写）、managed/MDM 最高优先、`{env:}`/`{file:}` 变量替换 | [docs:config]；https://opencode.ai/config.json | **PARTIAL**（get/update 已接，仅写 provider 段） | 网关 Config 页可下推更多 runtime 旋钮（compaction keep、snapshots、watcher ignore）；注意 `.opencode` 目录优先级陷阱（自接线写全局配置会被项目配置盖） | [docs:config] |
| 57 | **experimental workspaces/sync**（云/远端工作区）：`workspace.{list,create,syncList,status,remove,warp}`（会话历史迁入工作区）、`sync.{start,replay,steal}`、workspace 适配器、`workspace.ready/failed/status` 事件 | SDK2:198-279、1318-1359 | **MISSING** | 前瞻：多机/云工作区同步原语（跨设备 goal 续跑的潜在底座） | SDK2:198-279 |
| 58 | **Console**（云端）：org 切换（`console.{get,listOrgs,switchOrg}`）、团队 workspace/成员/预算/用量、组织策略分钟级下发、harnesses（Claude Code/Codex 复用 Console 模型）、Go 订阅 | SDK2:105-135；[docs:console] | **MISSING** | 团队场景的配额/策略统一面；usage 插件体系可对接 Console 预算 API | SDK2:105-135 |
| 59 | project copies（项目副本 create/remove/refresh/generateName）+ `project.update{name,icon,commands}` + `project.directories` | SDK2:174-186、2177-2204；SDK2:688-739 | **MISSING** | 桌面项目列表可显示原生元数据（icon/自定义命令） | SDK2:2177-2204 |
| 60 | `opencode api` CLI（原生命令行调 API：`opencode api session.list --data`）与 `opencode stats`（可分享用量统计）、`opencode run --format json --file … --agent …`（CI 自动化） | [docs:cli/commands] | **MISSING** | 网关运维手册可引用（脚本化冒烟/对账）；run --format json 是评测数据采集捷径 | [docs:cli/commands] |

---

## ④ 重点核实项逐条结论（对应任务清单）

| 核实项 | 结论 |
|---|---|
| agents（primary/subagent、per-prompt 切换） | ✅ 已核实：md/JSONC 双形态、mode 三值、内置 build/plan/general/explore+隐藏 3 个；per-prompt `agent` 参数我们已消费（HAVE），sticky `switchAgent` MISSING（§3.2 #17） |
| tasks（create/update/subscribe） | ✅ 已核实：**无此 API**（SDK 1.19.3 双 gen + v2 OpenAPI 146 ops 反证）；等价物 = subagent 子会话（#11-14）+ todo（已消费） |
| permission 系统 | ✅ 规则/pattern 体系完整且与我们 approval 双轨并存（§3.3 #18-23）；另发现我们 permissionReply 目标面断线（§3.0） |
| plan mode | ✅ plan 是 primary agent（edits 除 `~/.opencode/plan` 外 deny）；我们已消费其切换（desktop plan/build 引导 = HAVE） |
| MCP client 配置 + MCP server 模式 | ✅ client 面完整（§3.7 #54，我们 PARTIAL）；**server 模式不存在**，对外集成面是 ACP + 插件 RPC（#55） |
| session.share | ✅ 兼容 API 在（SDK2:1161-1179），v2 主推 pair/web/Console；我们 MISSING（#49） |
| session revert/undo | ✅ v2 = staged revert + 文件快照（#44）；我们仅消息级（PARTIAL） |
| session export | ✅ experimental export/import + CLI `session export --sanitize`（#9）；我们自研 Markdown 导出（MISSING 原生面） |
| summarize | ✅ 兼容 `session.summarize` 我们已消费（worker compaction + TUI /compact）；v2 原生 `session.compact`（inbox 化、幂等 id、`session.compaction.*` 事件）MISSING |
| provider/model 热切换 | ✅ `v2.session.switchModel/switchAgent`（#17）+ `model.transform` 默认模型（#37）；我们仅 per-prompt（PARTIAL） |
| LSP 集成 | ✅ 30+ 内建 server、诊断进回路（#30）；我们 MISSING |
| file/editor 状态 | ✅ `file.{list,read,status}`+`file.edited/file.watcher.updated`（#29）；v2 另有桌面 app（browser 工具面，#26）；我们 MISSING |
| git 集成 | ✅ `vcs.{get,status,diff,apply,base,branch,init}` + 自定义 VCS 插件（#43）；我们 PARTIAL（diff/apply） |
| snapshot/file-history | ✅ 每步双快照 + 内部 git 对象库 + staged revert（#44）；我们 MISSING（且快照 part 被丢弃 #4） |
| autocompact | ✅ `compaction.{auto,keep.tokens,buffer}` + native provider compaction（#41）；我们只消费 compaction 事件（PARTIAL） |
| upgrade/hot reload | ✅ `global.upgrade` API + `opencode upgrade` + `opencode reload`/`location/reload` + 插件热重载（#50）；我们 MISSING |
| plugin API | ✅ 全面盘点见 §2.5/§3.7 #53；我们消费 ~8 个入口，storage/generate/权限钩子/9 transforms/RPC 未消费（PARTIAL） |
| config schema | ✅ 全量见 [docs:config] + https://opencode.ai/config.json（#56）；我们 PARTIAL |
| worktree/subagent 内建 | ✅ 原生 worktree API + 策略插件（#45，我们自研）；subagent 工具/深度/后台（#12-14，我们 MISSING） |

---

## ⑤ Top 10 缺口（按多运行时网关契约价值排序）

1. **持久事件历史 + 按会话 SSE 回放**（`v2.session.history/events` + seq 游标）——根治 serve 重启/重订阅丢事件，契约可加 `session.events(after)` 原语。
2. **持久 inbox**（`delivery:'queue'`、待处理输入可取消、幂等 id、`resume:false`）——超出我们 `delivery:'steer'` 的投递语义。
3. **原生子代理/后台子会话**（`subagent background:true`、`SubtaskPartInput`、`experimental.session.background`、`session.children`、`subagent_depth`）——goal 并行 wave 的轻量替代。
4. **分阶段 revert + 文件快照**（`revert.stage/clear/commit{files}`、PatchPart/SnapshotPart、`snapshots` 内部 git 对象库）——替代自研 hunk-patch 反转，未跟踪文件也能回滚。
5. **会话级 sticky agent/model 切换 + 富消息模型**（`switchAgent/switchModel`、Message.AgentSelected/ModelSelected/Skill/Shell/Compaction/Idle 11 形状）。
6. **v2 权限栈**（session 级 `PermissionRuleset`、saved approvals、编程式 `permission.create`、插件 `permission.hook('evaluate')` + `ctx.permission.assert`）——审批政策前移 runtime，顺带修复 §3.0 断线。
7. **表单系统 + MCP elicitation**（`Form.*` create/reply、question v2）——结构化交互超出 question 三动词。
8. **无状态生成 + 每会话 instruction entries + skills 激活**（`/api/experimental/generate`、`session.generate`、`instructions/entries` PUT/DELETE、`PromptInput{files,agents,skills}`、会话 skill 激活）——记忆披露层/判官通道的原生化。
9. **文件/VCS/shell/LSP 读平面**（`fs.*`、`find.symbols`、`vcs.{status,base,branch,init}`、后台 shell、`lsp.status`、`file.edited` 事件）——curator 只读验证与 review 节点的白名单探测面。
10. **会话可携带性与生命周期运维**（`export/import --sanitize`、`session.move`、原生 worktree API、`global.upgrade`、`opencode reload` 热重载）——goal 归档/迁移/升级窗口收敛。

（紧随其后：persistent PTY、voice sessions、pairing/web、`@opencode/sdk` 进程内宿主、插件 `ctx.storage`/RPC、workspaces/sync 实验族——见 §3.7。）

---

## 参考源

- 本地：`gateway/node_modules/@opencode-ai/sdk@1.18.21`（SDK1/SDK1T/SDK2/SDK2T + `dist/v2/gen/sdk.gen.js` URL 全集）、root `node_modules/@opencode-ai/sdk@1.18.30`、`gateway/src/runtime/{opencode-adapter,opencode-runtime,opencode-events,contract,auth}.ts`、`gateway/dist/opencode-adapter.js`、`src/plugin.ts`
- npm（2026-10-22 实测）：`@opencode-ai/sdk@1.19.3`（tarball diff）、`@opencode/cli@2.1.2`（time 索引：2.1.0=2026-10-20）、`@opencode/plugin@2.1.2`、`@opencode/sdk@2.1.2`
- GitHub：`api.github.com/repos/anomalyco/opencode/{releases,tags}`（v1.x releases / v2.x tags）
- 文档（访问 2026-10-22，更新至 2026-10-20）：opencode.ai/v2/docs/{intro,config,agents,permissions,policies,plugins,build/plugins,build/client,build/sdk,mcp-servers,tools,skills,references,snapshots,compaction,cli,cli/web,cli/commands,console,api} + v1 docs（/docs/lsp/、/docs/ intro）
- 运行时验证：`node` 实例化 SDK v2 客户端枚举成员（本机）；`opencode --version` = v2.1.0；serve 4096 探测（未运行，未能活体验证 compat 路由与 §3.0）
