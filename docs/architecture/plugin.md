# MAFW Plugin 架构

> opencode 插件（`src/`）：**注入点 + 观察捕获 + 原生工具 + MCP 自接线**。
> 记忆的存储、检索与维护都在 Gateway 侧——本文只描述插件作为"宿主接入层"的职责。
>
> 时效：2026-09-14 对照源码重写。权威细节见根 `AGENTS.md`；
> Gateway 侧架构见 `docs/architecture/gateway.md`。

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

## 命令与 Gateway 联动

斜杠命令（`/btw` 支线问答、`/new-topic` 开新话题）由插件捕获后转发
`POST /api/mafw-commands/run`——**UI/用户指令驱动**，刻意不暴露为 MCP 工具给 agent。
`/merge-memory`（跨 worktree 记忆融合）走 `POST /api/merge-memory`（复用 MCP handler）。

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
| Goal 编排 | Gateway LangGraph（manager agent 经 MCP 驱动） |
| opencode 权限/agent 定义安装 | Gateway `runtime.agents.install`（agentConfigApi） |

## Legacy 附录（v6.x 插件内记忆路径，已废弃）

本文早期版本描述的插件内记忆栈——`HybridCompressor` 压缩管线、`T1ToT2Compressor`、
插件内 `ReviewScheduler`、`.mafw/memory/tier2|3|4.json` 分层存储——属于 v6.x 的
**插件内记忆路径**，现仅余 `gateway/src/core/plugin.ts` 的兼容壳，运行时写路径
全部收敛到 gateway（`/api/memory/add` + MCP + turnCompress worker，均经
`HarmonicUnitFileStore.write()`）。历史细节见 git 历史中的本文旧版
（`docs/architecture/plugin.md`，≤ 2026-09）。
