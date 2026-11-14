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

