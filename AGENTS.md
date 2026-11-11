# MAFW Gateway & Plugin 架构

> 这是 **agent / 维护者的入口索引**：项目地图、硬不变量、命令门禁、文档索引。
> 子系统细节在 `docs/architecture/*`，运维在 `docs/guides/*`，变更史在 `docs/releases/*`。
>
> **维护规则**：AGENTS.md 不再记录功能清单与发布记录。
> 功能/行为变更写对应 `docs/architecture/<子系统>.md` 的「现状」段；
> 带日期 / commit 的交付记录写 `docs/releases/`。新增内容前先在下表找归属。

## 0. 项目地图

| 路径 | 职责 |
|---|---|
| `gateway/` | 常驻进程：HTTP :3000 / MCP / SSE / 自动化 / Goal+Pod 编排 / 谐波记忆 / 媒体 / Python 内核 / TTS / 插件中心 |
| `packages/desktop/` | Electron + SolidJS 桌面（工作台、chat、编辑器、终端、文件预览、语音、批注） |
| `packages/ui/` | UI 组件库（v1 + v2：`ButtonV2`/`TextInputV2`/`SwitchV2`/`TooltipV2`/`LoaderV2`/`ToastV2`…） |
| `packages/session-ui/` | 会话渲染（消息、markdown、工具卡、diff 面板） |
| `packages/gateway-sdk/` | `@mafw/sdk` 客户端 + 契约产物（openapi / runtime-contract / experience） |
| `packages/tui/` | 终端 UI（pi-tui） |
| `packages/runtime-kit` `runtime-contract` `runtime-core` | runtime 插件作者工具链 / 契约 / 内核 |
| `packages/plugin-contract/` | 统一插件包契约 |
| `adapters/claude/` | claude runtime 适配器（示例实现） |
| `src/` | opencode 宿主插件（注入面 + 观察捕获 + 原生工具 + MCP 自接线） |
| `mobile/` | Orcalore Flutter app（Android） |
| `skills/` | 随包 agent 技能（含 `office-editing`） |
| `evaluation/` | LongMemEval 记忆基准 |
| `docs/` | `architecture/` `guides/` `reference/` `releases/` `research/` `superpowers/{specs,plans}/` |

## 1. 硬不变量（违反即事故）

### 数据与记忆
- 数据根固定 **`~/.mafw`**（与启动 cwd 解耦）；统一数据层 `~/.mafw/memory/gateway.db`。
- 记忆用 **soft supersede**（`superseded_by`），不物理删除；检索出口单点撤销 superseded。
- `pinned`（每轮 `<user-profile>`）、`sticky`（`<note-board>`，到期下架不删本体）、`distinct_from` 双向禁止合并。
- **worker 输出永不回流 T1**；边界 recall 有 **100ms 硬契约**（fail-open）；日衰减必须批量写（禁止逐条 `save()` + 广播）。
- 去重三层：写时 exact-hash（仅 HTTP）/ 读时近重折叠 / 巩固层语义合并；MinHash 写路径合并已退役。

### Runtime 契约
- 业务核心只经 `RuntimeAccess` / runtime facade；原生事件与历史只存在于 adapter 闭包，未知/非法事件 fail-closed。
- 客户端只消费 **MAFW View DTO + Experience Action**；不得出现 runtime 名 / 能力位（Config 诊断页是唯一例外）。
- 历史出口只有 flat：`{ data: MafwMessage[], nextCursor }`；adapter 必须直接交付 flat。
- `SessionCreateOpts.directory` **必填绝对路径**；runtime 用 `requireSessionDir`，不静默兜底。
- 缺失能力返回中性 503（文案不含 runtime 名与 capability flag 名）。

### Pod / Goal
- Lead 是项目唯一入口；Lead / Tech Lead / Builder / Reviewer / Probe 会话隐藏，不回流 rail。
- 验收（accept）是 **人类专属**：请求带 `actorSessionID` → 403；不提供 MCP 验收工具。
- 计划批准绑定 `planHash` / `evalHash`；计划被编辑会自动作废旧批准。
- Review 必须逐 task + 逐必需 Goal 条件给结果与证据；漏项 / 证据空 → FAIL，绝不 PASS。
- 每个 Goal revision 一个 worktree/branch；PASS 不自动合并，人工验收才 merge。
- 身份权限：`deny` / `allowlist` 先于 internal blanket；内部会话 auto-deny 最高优先。

### Desktop
- 右主工作台 + chat 指挥列；左侧 rail 负责导航与团队状态。
- 编辑器默认 **Monaco**（`localStorage['mafw-editor-engine']='codemirror'` 回退；Monaco 挂载失败自动回退 CodeMirror）。
- 桌面包默认 **managed gateway**；dev checkout 发现 3000 已有健康 gateway 会直接采纳（`MAFW_DEV_ADOPT=0` 强制自起）；打包版对未登记进程一律 conflict。
- **不要并发**跑 `electron-vite build` 与打包（会产出 header/数据不一致的 asar，app 秒退）。
- 预览类文件（md / json / csv / office / pdf / svg）默认预览、源码一键切换；批注走锚点（选区 / JSON 路径 / 单元格 / 区域 / 页码）。

### UI
- 禁止新增裸 `<button>` / `<input>` / 裸 `title`；一律 `@mafw/ui` v2 组件。
- Tooltip `openDelay: 300`；toast 走 `toastStore`；图标必须用**已注册**名称（未注册会静默回退 `plus`）。
- 主题只有一套 token（`.mafw-shell, body` 三主题块键集一致）；禁止硬编码色值。

## 2. 命令与门禁

### 构建
```bash
npm run build                                      # contracts + runtime + claude + gateway + sdk + tui
cd packages/desktop && npx electron-vite build     # 桌面；发布用 OPENCODE_CHANNEL=prod
```

### 测试
```bash
npm test                       # gateway（jest --runInBand）
npm run test:desktop           # desktop（node --test + @mafw/test-shim）
npm run test:tui               # TUI
npm run test:kit               # runtime-kit
npm run test:contract          # runtime-contract
npm run test:core              # runtime-core
npm run test:plugin-contract
npm run verify:plugin-contract
```
- 手工跑 desktop 单文件也要带 `--conditions=browser`（否则 solid 的 effect 是 no-op，回归假绿）。
- gateway 全量测试可能被 zeromq 句柄拖住不退出：加 `--forceExit`。
- 类型门禁：desktop `npx tsgo --noEmit -p tsconfig.json`；gateway `npx tsc --noEmit -p tsconfig.json`。**不带 `-p` 是假绿**。

### 运行 / 重启 / 日志
```bash
mafw status | start | daemon | stop | restart | restart-agent
mafw logs | mafw health | mafw stats
node bin/mafw.js daemon            # 仓库内 CLI
```
- 日志：`~/.mafw/logs/mafw.log`（5MB 轮转）；desktop 日志在 `%APPDATA%/<appId>/logs`。
- 自更新：写 `~/.mafw/pending-restart.json`（`{ target: "gateway", action: "update" | "restart" }`）；桌面 managed 下以退出码 75 退出，由 desktop supervisor 拉起新 payload。

### 打包 / 安装包冒烟
```bash
cd packages/desktop
OPENCODE_CHANNEL=prod npx electron-vite build      # 必须先重建 out/
OPENCODE_CHANNEL=prod npm run package:win          # 需要签名：MAFW_WIN_SELF_SIGN=1
npm run smoke:packaged-gateway -- --app-root dist/win-unpacked
```
- `package:*` **不会**重建 `out/`；CI 顺序见 `.github/workflows/desktop-release.yml`。
- smoke 校验 gateway payload（按 manifest 逐文件存在性 + 大小）与 managed health。

## 3. 子系统速览（细节见链接）

- **记忆**：谐波单位 + BM25/hybrid + pinned/sticky + 边界 recall + 巩固/衰减/反思/做梦等管线。→ `docs/architecture/memory.md`
- **Gateway 运行时**：HTTP / MCP / SSE、serve sidecar、自更新、managed payload、插件中心。→ `docs/architecture/gateway.md`
- **Runtime 契约**：能力自声明 + 事件映射 + HostAdapter + Experience / View DTO。→ `docs/architecture/runtime.md`
- **Goal / Pod**：NodeDriver 状态机、Plan Package / Goal Eval、worktree revision、事件与 presence。→ `docs/architecture/goal.md`、`docs/architecture/pod.md`；长效目标 → `docs/architecture/standing-goals.md`
- **Desktop**：右主工作台、会话 / 编辑 / 预览 / 终端 / 语音 / 批注、Monaco、主题与动效。→ `docs/architecture/desktop.md`
- **TUI**：pi-tui 布局、slash 命令、键位与鼠标交互。→ `docs/architecture/tui.md`
- **Media / Voice / Python**：A2A 多模态、流式 TTS 与打断、持久 Jupyter 内核。→ `docs/architecture/media.md`、`voice.md`、`python.md`
- **Mobile**：Orcalore Flutter、配对 / Tailscale、Pod 客户端。→ `docs/architecture/mobile.md`
- **插件**：统一插件包 / opencode 宿主插件 / runtime 插件。→ `docs/architecture/plugin.md`、`docs/guides/*plugin*`

## 4. 文档索引

| 主题 | 文档 |
|---|---|
| 架构 | `docs/architecture/{memory,gateway,runtime,pod,goal,standing-goals,desktop,tui,media,voice,python,mobile,plugin}.md` |
| 记忆代码级全路径 | `docs/architecture/memory-system-full-path.md` |
| 运维 | `docs/guides/operations.md` |
| 插件 | `docs/guides/{plugin-authoring,plugin-creator,runtime-plugin-authoring}.md` |
| 工具清单 | `docs/reference/tools.md` |
| 评测 | `docs/guides/evaluation.md`、`evaluation/README.md` |
| Usage 插件 | `docs/guides/usage-plugins.md` |
| 变更史 | `docs/releases/`（`2026-archive.md` 为 AGENTS.md 迁移归档） |
| 调研 / 设计 / 计划 | `docs/research/`、`docs/superpowers/specs/`、`docs/superpowers/plans/` |

## 5. Agent 工作约定

### 记忆
- 学到新知识 / 用户偏好 / 重要决定 / 踩坑 → `mafw_add_memory`（semantic / episodic / procedural），附 `cueAnchors`；
  **标识符原样**写进锚点（函数名 / 路径 / 命令 / 错误码 / 配置键）。
- 内容已被 repo 文件承载 → 记**指针**（路径 + 一句 gist），不复述全文；文件是真相源，记忆是索引。
- procedural 结尾带「→ 下次用：<skill/工具/命令>」。
- 用户说「记下来 / 别忘」→ `sticky: true`（默认 7 天）；身份 / 长期偏好 → `pinned: true`；事实变更用 `supersedes: 旧 id`。
- 新任务或不确定是否已知 → `mafw_search_hybrid`；依据 `<recall>` 指针行动前 → `mafw_get_memory`。
- **子代理不得调用** `mafw_add_memory` / `mafw_search_hybrid`，由父会话统一管理。

### 文档维护
- 功能 / 行为变更：更新对应 `docs/architecture/<子系统>.md` 的现状描述（保留决策理由）。
- 带日期 / commit 的交付记录：写 `docs/releases/`，**不要**回填 AGENTS.md。
- 新增文档后在 §4 索引登记；跨文档引用用相对路径。
- AGENTS.md 目标 **≤250 行**；超了说明内容该搬去 `docs/`。
