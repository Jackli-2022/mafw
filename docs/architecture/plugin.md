# MAFW Plugin 架构

> opencode 插件（`src/`）：**注入点 + 观察捕获 + 原生工具 + MCP 自接线**。
> 记忆的存储、检索与维护都在 Gateway 侧——本文只描述插件作为"宿主接入层"的职责。
>
> 时效：2026-10-16 更新（六件套 gateway 单源注记 + Goal 编排分工）。权威细节见 `docs/architecture/*` 与 `docs/guides/*`（2026-11-10 起 AGENTS.md 只保留索引）；
> Gateway 侧架构见 `docs/architecture/gateway.md`；pi 等第三方 runtime 的同类宿主实现
> 见 `gateway/src/runtime/host-adapter.ts`（认知面契约）与 `.opencode/skills/runtime-plugin-authoring/SKILL.md`。

## 目录

- [代码位置](#代码位置)
- [激活生命周期](#激活生命周期)
- [注入面（transform hooks）](#注入面transform-hooks)
- [捕获面（观察与生命周期 hooks）](#捕获面观察与生命周期-hooks)
- [原生工具（src/tools/）](#原生工具srctools)
- [命令与 Gateway 联动](#命令与-gateway-联动)
- [MCP 自接线](#mcp-自接线)
- [与 Gateway 的分工](#与-gateway-的分工)
- [Legacy 附录（v6.x 插件内记忆路径，已废弃）](#legacy-附录v6x-插件内记忆路径已废弃)

---

## 代码位置

```
src/
├── plugin.ts               # 插件入口：注册 hooks / 工具 / 命令，MCP 自接线
├── hooks/
│   ├── hook-manager.ts     # hook 注册管理器
│   ├── memory-guide.ts     # system.transform：注入 <memory-guide>（OptMem 式主动引导）
│   ├── session-recall.ts   # messages.transform：边界 recall（<recall> 指针块注入）
│   ├── user-profile.ts     # system.transform：注入 <user-profile>（pinned 披露层）
│   ├── observation-capture.ts  # 观察捕获 → POST /api/obs/capture → gateway.db
│   ├── media-ingest.ts     # 粘贴媒体自动上传 A2A，替换为文本指针
│   ├── bash-python-guide.ts    # 检测长 python 内联脚本，温和提示改用 mafw_python
│   ├── session-start.ts / session-ending.ts / session-compacting.ts
│   ├── tool-before.ts / tool-executed.ts / llm-after.ts / user-prompt.ts
│   └── voice-guide.ts / handoff.ts
├── tools/
│   ├── add-memory.ts       # mafw_add_memory 原生实现（HTTP → /api/memory/add）
│   ├── media-ask.ts        # mafw_media_ask（A2A 追问）
│   ├── media-upload.ts     # mafw_media_upload（A2A 建任务）
│   ├── media-speak.ts      # mafw_media_speak（TTS 合成回复）
│   ├── python-exec.ts      # mafw_python（持久内核执行）
│   └── python-restart.ts   # mafw_python_restart
├── utils/                  # self-wiring（MCP 自接线）、logger（文件日志）等
└── types/
```

## 激活生命周期

```
opencode 加载插件（plugin.ts）
    ├── installFileLogging()            → <project>/.mafw/logs/mafw.log
    ├── registerWithGateway(directory)  → POST :3000/register（项目注册）
    ├── ensureMcpWiring(apiUrl)         → 全局 opencode 配置缺 "mcp" 段则幂等补写
    │                                     （.bak-mafw-<ts> 备份，fail-open）
    ├── hookManager.register(...)       → 注册全部 hooks（见下两节）
    └── 注册原生工具 + 命令转发
```

> 排错关键：旧键 `mcpServers` 已被 opencode 1.x **静默忽略**，接线缺失无报错、
> MCP 工具直接消失；验证用 `opencode mcp list` 应显示 `mafw connected`。

## 注入面（transform hooks）

插件是 gateway 与 LLM 之间仅有的两个"注射口"的宿主：

| Hook | 时机 | 注入物 |
|---|---|---|
| `session-recall.ts` | `experimental.chat.messages.transform`（每次 LLM 调用前） | `<recall>` 指针块（尾部，per-turn；gateway `GET /api/recall/context`） |
| `memory-guide.ts` | `experimental.chat.system.transform`（常驻） | `<memory-guide>`（OptMem 式：何时主动写入/检索/子代理禁令） |
| `user-profile.ts` | `experimental.chat.system.transform`（常驻，memory-guide 之后保前缀缓存） | `<user-profile>`（pinned 披露层，fail-open 150ms） |

注入渲染收敛在 gateway `recall/inject-format.ts`（`formatRecallContext` /
`formatPinnedProfile` / `formatNoteBoard`），插件不自行拼装格式。

## 捕获面（观察与生命周期 hooks）

| Hook | 职责 |
|---|---|
| `observation-capture.ts` | 用户消息 / 工具执行后 / text.complete / reasoning / tool.failed → `POST /api/obs/capture`（gateway 分配 turnID，UNIQUE 去重）；内部会话白名单过滤——worker 输出永不回流 T1（防递归） |
| `media-ingest.ts` | 粘贴/上传媒体 → A2A 建任务 → 消息替换为 `[媒体附件 taskID: x contextID: y]` 文本指针；`MEDIA_INGEST=off` 可关 |
| `bash-python-guide.ts` | 长内联 python 检测 → 每会话一次温和提示改用 `mafw_python` |
| `session-start.ts` / `session-ending.ts` / `session-compacting.ts` | 会话生命周期挂钩（start 注入 / ending 收尾 / compaction 前处理） |
| `tool-before.ts` / `tool-executed.ts` / `llm-after.ts` / `user-prompt.ts` | 工具与 LLM 调用前后的观察与加工挂钩 |
| `voice-guide.ts` | 语音消息场景引导以 `mafw_media_speak` 语音回复 |
| `handoff.ts` | 会话交接辅助 |

## 原生工具（src/tools/）

六个原生工具**不经 MCP**，独立可用（serve 会话包括管线 worker 无 MCP 连接，
原生路径是它们的写通道）：

| 工具 | 用途 | 通道 |
|---|---|---|
| `mafw_add_memory` | 写入记忆单元（serve/worker 会话的写路径） | HTTP → `POST /api/memory/add` |
| `mafw_media_ask` | 媒体追问（taskID 多轮或 mediaPath 自动上传） | A2A → Media Agent |
| `mafw_media_upload` | 本地媒体上传建任务，返回文本指针 | A2A |
| `mafw_media_speak` | 文本合成语音回复（预置音色） | Media Agent TTS |
| `mafw_python` | 持久 Python 内核执行（变量跨调用保持） | `POST /api/python/execute` |
| `mafw_python_restart` | 重启 Python 内核 | `POST /api/python/restart` |

其余 40 个 `mafw_*` 工具（记忆检索、Goal、自动化、桌面控制…）经 gateway MCP
（`/mcp`）提供，不在此列。

> **六件套 gateway 单源注记（2026-10-15 起）**：runtime 契约新增必选工具注册通道
> （`tools.registerTools`），六件套的 spec 与执行逻辑单源在
> `gateway/src/runtime/mafw-tools.ts`——pi / 第三方 runtime 经契约 factory 获得同集合同
> 语义工具（pi 侧 `T.Unsafe` 包 JSON Schema 桥接）。本插件（`src/tools/`）是 opencode
> 宿主的**独立实现**（生产宿主，刻意不重构），描述文本两处暂存为已知文档债，
> v2 插件迁移时统一。

## 命令与 Gateway 联动

斜杠命令（如 `/btw` 支线问答）由插件捕获后转发
`POST /api/mafw-commands/run`——**UI/用户指令驱动**，刻意不暴露为 MCP 工具给 agent。
人工 `/new-topic` 已退役；Lead 的 compact/recovery 由系统内部处理。
`/merge-memory`（跨 worktree 记忆融合）走 `POST /api/merge-memory`（复用 MCP handler）。
命令清单经 `GET /api/mafw-commands` 暴露（含用户自定义命令，见 `docs/architecture/gateway.md` 归档 §5.13c）。

## MCP 自接线

`utils/self-wiring.ts`：插件激活时检测全局 `~/.config/opencode/opencode.jsonc`，
缺 `"mcp"` 段则幂等补写（`"mcp": { "mafw": { "type": "remote", "url": "http://127.0.0.1:3000/mcp", … } }`），
带 `.bak-mafw-<ts>` 备份，fail-open（失败不影响插件其余功能）。

## 与 Gateway 的分工

| 职责 | 归属 |
|---|---|
| 记忆注入（recall/profile/guide） | 插件 transform 注入，内容由 gateway 渲染 |
| 观察捕获 | 插件 hooks → gateway 入库（t1_observations） |
| 记忆存储/检索/合并/衰减/重验 | **Gateway**（HarmonicUnitFileStore + 管线，见 gateway.md） |
| 媒体/Python/TTS 执行 | 插件工具发 HTTP/A2A，Gateway 承载服务 |
| Goal 编排 | Gateway NodeDriver（state v3 + 事件驱动双门判定，见 gateway.md） |
| opencode 权限/agent 定义安装 | Gateway `runtime.agents.install`（agentConfigApi） |

### 三种插件形态（别混淆）

| 形态 | 位置 | 说明 |
|---|---|---|
| opencode **宿主插件** | 仓库根 `src/`（本文） | 跑在 opencode 进程内：注入面 / 观察捕获 / 原生工具 / MCP 自接线 |
| **runtime 驱动包** | `adapters/{opencode,pi,claude}`（workspace 包） | 实现 `RuntimeDefinition`（transport + channels + host），由 gateway 的单一 fail-soft shim（`gateway/src/runtime/opencode-adapter.ts` / `pi-adapter.ts`）加载 |
| **统一插件包** | `<project>/.mafw/plugin-drafts` → 安装 | 一包多贡献（usage/media/runtime/uiTools/tts），见下节 |

约束（Plan 6）：`gateway/src` 里只有 shim 能 `require('@mafw/adapter-*')`（一个发布周期的
re-export shim 已在 Task 7 删除）；驱动包不得 import `gateway/src`，只依赖
`@mafw/runtime-contract` / `@mafw/runtime-core` / 自身原生 SDK / Node 内置 / 本地模块。
打包面：`gateway/package.json` 的 `mafw.bundledPackages` 登记 `../adapters/opencode`，
根 `postinstall` 用 `scripts/stage-plugin-contract.mjs` 把 `dist/` 落到 `gateway/node_modules`
（`plugin-package-e2e.test.ts` 钉住 files/postinstall/bundledPackages 与 staged 入口）。

## Legacy 附录（v6.x 插件内记忆路径，已废弃）

本文早期版本描述的插件内记忆栈——`HybridCompressor` 压缩管线、`T1ToT2Compressor`、
插件内 `ReviewScheduler`、`.mafw/memory/tier2|3|4.json` 分层存储——属于 v6.x 的
**插件内记忆路径**，现仅余 `gateway/src/core/plugin.ts` 的兼容壳，运行时写路径
全部收敛到 gateway（`/api/memory/add` + MCP + turnCompress worker，均经
`HarmonicUnitFileStore.write()`）。历史细节见 git 历史中的本文旧版
（`docs/architecture/plugin.md`，≤ 2026-09）。
## Phase 4 tooling metadata（2026-11-11）

- adapter 导出 `REGISTRATION`/dialect 描述符与 `getBridgeEventEntry`/`setBridgeEventEntry`（`entry-registry.ts`），dry-event/conformance 通过 gateway 的 provider seam 读取，不依赖 legacy bridge 实例。
- opencode 的 `discovery.roots()` 暴露 skills/instruction 根目录；插件/技能安装不再由 gateway 猜测厂商路径。

## Phase 6A trust surface（2026-11-14）

- 统一包 manifest 增加 apiVersion/kind/permissions/host/integrity/deprecated；缺省 apiVersion=1 的 legacy 包按 trusted 处理。
- 安装 v2 包需要 human/device principal 显式接受 permissions；v1 包、plugin-creator 草稿和 MCP 现有流程不变。
- 安装后记录内容指纹与文件 hash；manifest 声明 integrity 时安装前严格校验。
- 插件状态文件 v2 增加 safeMode/quarantine/installed/consecutiveFailures/pendingHealthCheck；文件损坏进入 safe mode。
- 审计写入 gateway.db 的 plugin_audit_events 表；detail 只保留 allowlist 字段。
- 新增 plugin doctor（12 项检查）、kill/resume、quarantine/unquarantine、audit 路由与 mafw plugins CLI。
- kill switch 只停统一插件包；resume/unquarantine/v2 install 必须 human/device。


## Phase 6B worker host（2026-11-14）

- untrusted 包只通过 child_process worker 执行，gateway 主进程从不 require 其入口。
- worker 启动参数：Node permission flag（--permission 或 --experimental-permission）、只读包根目录、无写/无 child-process/无 addon。
- v1 能力：actions / events / config.read / config.write；files / net / terminal / http / tools / observers / ui.web 全部拒绝。
- RPC 为 JSON-only，单条消息上限 1 MiB；config 走 host 回调。
- action 超时杀 child；崩溃按 0.5s/1s/2s 退避重启；3 次后由 safety quarantine。
- worker 启动失败或无 permission flag → 拒绝 untrusted，绝不 in-process fallback。
- net 仍是 defense-in-depth（Module._load + global stub），不是 OS 级 hermetic 隔离。


## Phase 6C compatible rollback（2026-11-14）

- 宿主只接受 apiVersion 1/2；apiVersion 3+ 只跳过该包，不进 safe mode。
- manifest host range 比较 MAFW 产品版本；不兼容只跳过该包。
- deprecated 只产生 doctor warn。
- 覆盖安装前把当前健康版本快照到 \.last-good/<name>/\；安装失败恢复，首次失败保留目录并 quarantine。
- 新版本 commit 后写 pendingHealthCheck；健康窗口（默认 5 分钟）通过才提升为 lastKnownGood。
- 进程在窗口内退出时，下次 boot 在激活前 reconcile：恢复 last-good 或 quarantine。
- 手动回滚 \POST /api/plugins/:name/rollback\（human only）；last-good 元数据 \GET /api/plugins/:name/last-good\。
- 10 个 drill 场景由 \
pm run drill:plugin-trust\ 固化。

## 插件插入点默认生效（2026-11-16）

- 统一包 tools / observers 两个插入点默认生效（无需 env）；`MAFW_KERNEL_V2_TOOLS=0` / `MAFW_KERNEL_V2_OBSERVERS=0` 是 kill switch，关闭时 `registerTool` / `registerObserver` 直接抛错而不是静默 no-op。
- `plugin.json` 的 `contributes.gateway` 是**注册面上界**：`actions` / `events` / `tools` / `observers` / `http` 每个声明的 plane 都是独立约束——`activate()` 注册的条目必须是声明集合的子集；未声明的 plane 完全不受约束，声明多于注册也合法。越界让整包激活失败。
- 没有 `plugin.json` 的包——单文件 `~/.mafw/plugins/*.js` 与缺 manifest 的目录包——继续加载、信任级别不变（仍是 trusted、主进程 require），但**不能贡献** `tools` / `observers` / `http`：它们没有 `contributes`、没有声明式权限、没有安装时授权，这三个面由此变成不可审查的扩面。判据是 **manifest 缺失**而不是文件形态，所以两种形态同样受限；违规整包激活失败，文案 `packages without plugin.json cannot contribute <planes>; ship a directory package with plugin.json`（plane 按 `tools` / `observers` / `http` 顺序），`ui` / `actions` / `events` / legacy 不受影响；plugin doctor 的 `manifest` 检查只对单文件（`.js`）形态提示这三个面被拒（warn），缺 manifest 的目录包更早就在同一项上以 `plugin.json not found` 失败——而宿主在激活时对这两种形态同样拒绝这三个面。
- 诊断顺序：`contributes.gateway` 里 `actions` / `events` / `tools` / `observers` 四个 plane 的上界由 `enforceDeclared` 在形状 / 身份校验之后检查——包存在形状 / 身份错误时只报这些错误，修好后才会报越界（判决不变，都是激活失败），派生的「未声明」错误不会掩盖第一个原因。`contributes.gateway.http === false` 的检查在派生贡献构建之前执行，不受这个顺序约束。
- `contributes.gateway.http: false` 时，任何一次 `ctx.http.route()` / `ctx.http.ws()` 都让激活失败（即使 `activate()` 正常返回）。
- `apiVersion 2` 下 `contributes` 非法 → 激活失败；`apiVersion 1` 下非法块只产生 warning 且不构成约束，但**合法**的 v1 块与 v2 一样构成约束。
- plugin doctor 把 `parsePackageManifest` 的 warnings（`legacy-permissions` / `legacy-contributes`）暴露成独立的 `manifest-warnings` 检查（status `warn`，多种 warning 以 `; ` 连接）；`report.ok` 只由 `fail` 派生，warn 不翻转它。
- 面向 agent 的**规范正文**在 `docs/guides/plugin-standard.md`（§0-§11：60 秒路径、`plugin.json` 字段表、五个 plane 的逐字错误文案与上限、声明上界、trusted/untrusted、`check --strict --json`、人类安装、失败修法、版本分工）；`mafw plugin init/check/schema` 与 `examples/plugins/` 是它的可执行部分。

## `plugin check` 的 untrusted dry-run（2026-11-18）

- `gateway/src/cli/plugin-check-local.ts` 现在给 `PluginHost` 传 `workerAvailable: () => permissionFlagFor(process.execPath) !== null` 与 `workerHostFactory`（镜像 `boot.ts`，去掉 kernel / safety / persistence）：`check` 对 `untrusted` 包走**和网关同一条 worker 路径、同一套 Node 权限旗标**，没有弱化（无 in-process fallback）也没有加强（无额外旗标）。
- `untrusted` 仍是 manifest 属性而非 CLI 选项：没有 `--allow-worker`，worker 检查始终开启；本机 Node 无权限模型时唯一结果是 `worker_unavailable`（`evaluated: false`）。
- CLI 侧没有持久化插件配置：worker 的 `config.get()` 返回 `{}`，`config.update(patch)` 抛 `config.update is not available in this host`。
- 收尾：worker 由 candidate bag 的 `worker.stop('dispose')` 关闭（`checkPackage` 的 `finally` 必然 dispose 该 bag）；正常路径与网关同一套升级序列（`shutdown` 消息 → 2 s → `SIGTERM` → 2 s → `SIGKILL`）。
- `exit` 钩子是**尽力而为的最后兜底**，只在 `exit` 事件上运行：它同步 `SIGKILL` 每个被跟踪 worker 的**活着的 child 句柄**（`exitCode` / `signalCode` 为空），不按 `health()` 判断——ready 握手期间 host 处于 `starting`、`health()` 报 `stopped` 而 child 已 fork，按 `health()` 判断会让钩子恰好在唯一需要它的窗口变成 no-op；崩溃后被回收的 pid 也不会在重启退避期被再次发信号。单次 `SIGTERM` 可被包代码 `process.on('SIGTERM', () => {})` 忽略，所以兜底只用 SIGKILL。
- 兜底覆盖不到 CLI 自己被 SIGKILL / TerminateProcess 的情况（不会触发 `exit`），与网关 subprocess ledger 同一残余缺口；Ctrl+C 的默认处理与未捕获异常会走到 `exit`，因此在这条路径上有覆盖。
- `check` 依旧不是沙箱：`trusted` 包在主进程真实执行；`untrusted` 包的边界是 worker 的 Node 权限模型 + bootstrap 拦截，`check` 只复用该路径，不额外隔离副作用。

