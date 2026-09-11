# MAFW TUI 设计（mafw tui）

日期：2026-09-11
状态：已批准（方案 A）

## 1. 背景与目标

Gateway 现有 UI 面：Web Dashboard（gateway/src/dashboard）、系统托盘（tray.ps1）、Electron Desktop（packages/desktop）、`mafw` CLI。**缺终端 TUI**。本设计新增一个纯客户端 TUI：对话（Chat）与运维管理（Goals / Memory / Triage）合一，多 tab 界面。

约束与前提：
- 运行时中立：只走 gateway HTTP/SSE（`@mafw/sdk`），不 import gateway 内部类
- TUI 不负责 spawn/管理 gateway 进程；gateway 未运行时给出明确提示并退出
- 技术栈：`@earendil-works/pi-tui`（已在依赖树经 pi-coding-agent 验证）
- SDK 面已齐备，**无需新增 gateway 端点**

## 2. 交付与启动

- 新包 `packages/tui`（npm workspaces `packages/*` 自动纳入）
  - `package.json` name `@mafw/tui`，bin `mafw-tui`
  - deps：`@earendil-works/pi-tui`、`@mafw/sdk`（workspace:*）
- 根 `mafw` CLI 新增 `tui` 子命令：
  1. 探测 gateway `/health`（端口顺序 `MAFW_SERVER_API_PORT` → `3000`）
  2. 不通 → 打印"gateway 未运行，请先 `mafw daemon`"并以非零码退出
  3. 通 → 启动 TUI 进程

## 3. 界面骨架（pi-tui 能力映射）

渲染器：`TuiAltScreen` + `setLayoutRoot()`（显式分区布局；退出时完整文档刷回主屏 scrollback）。

```
TuiAltScreen
└─ VStack (layoutRoot)
   ├─ TabStrip    (basis: auto, 1 行)  Chat │ Goals │ Memory │ Triage · 右侧 gateway 连接徽标
   ├─ 内容区       (grow: 1，各 tab 自己的组件树)
   │   Chat:   ScrollView(transcript, follow:"end", primary) + Editor(固定底部)
   │   Goals:  ScrollView(goal 列表)
   │   Memory: Input(搜索) + ScrollView(结果 + 便签板区块)
   │   Triage: ScrollView(approvals 区块 + triage 列表)
   └─ StatusBar   (basis: auto, 1 行)  project · session · 连接状态 · 快捷键提示
```

- Tab 切换：`1-4` 数字键；`Ctrl+C` / `q`（非输入态）退出
- Overlay（`tui.showOverlay()`，anchor 定位）：goal 详情、记忆全文、审批/问答弹窗、help
- 轮询（切走即停）：Goals 10s / Triage 10s / Memory 便签板 15s
- **中文 IME**：自定义容器嵌 Editor/Input 时必须实现 `Focusable` 并传播 `focused`（pi-tui CURSOR_MARKER 机制），否则中文候选窗错位
- 差分渲染 + CSI 2026 同步输出，流式不闪屏

分层：`ui/`（pi-tui 组件）→ `store/`（轮询/SSE/状态机，纯 TS 不依赖 pi-tui）→ `@mafw/sdk`（唯一数据出口）。

## 4. Chat 面板数据流

**会话定位**：`manager.session(projectDir)` 取当前项目 manager session（对齐 desktop 主会话）；`/new` → `manager.rotate()`。

**发送与流式**：
```
Editor.onSubmit → sessions.promptAsync({ parts:[{type:'text',text}] })
SSE: events.subscribeToSession(sessionID)
  message.part.updated → store 按 partID 累积 text/reasoning/tool 片段
  session.idle         → 回合结束，finalize Markdown 块
```
- 渲染节流：SSE delta 进 store 缓冲，`requestRender()` ~50ms 节流
- Tool 调用：v1 一行摘要（`▸ bash: npm test ✓`）；聚焦后 `Enter` 展开 overlay 看完整输出。running 期间只渲染一行状态，completed 才填充（对应"terminal state 才渲染完整卡"的教训）
- 中止：流式期间 `Esc` → `sessions.abort()`

**历史加载**：打开拉最近 50 条（`sessions.messages({limit:50})`，cursor 分页）；滚动到顶自动 loadOlder（+50）。与 desktop "首屏 20 + 分页"同一模式。

**Slash 命令**（Editor 自带 `CombinedAutocompleteProvider` 补全，v1 四条）：
- `/new` 新话题 · `/btw <问题>` 支线问答（`mafwCommands.run`）· `/older` 手动加载更早 · `/help` 快捷键 overlay

**断线**：SSE 断开 → statusbar 红显 reconnecting，指数退避 1s→2s→5s→15s 封顶；重连后重拉最新消息补洞。断线期禁发送，Editor 边框变红。

**审批穿插**：SSE `permission.asked` → overlay（SelectList：once/always/reject）→ `permissions.reply()`。与 Triage tab 互补：permission 是当前会话即时阻断，Triage 是后台待确认项。

## 5. Goals / Memory / Triage 面板

**Goals**：`goals.list()` 轮询 10s；行格式 `[状态] title · phase · loop n/m`；`Enter` overlay 详情（`goals.get`）；`x` 取消（二次确认）；有 pending question 的行标 `?`，`Enter` 进 `questions.reply()` 问答 overlay。排序：活跃在前，priority → updated。

**Memory**：顶部 Input 搜索 → `memory.search`（默认 bm25，对齐生产；`--hybrid` 启动 flag 切换）；结果 SelectList，`Enter` overlay 全文（Markdown 渲染）；下方常驻便签板（`memory.listSticky()`，预算徽标 `📝 n/10`），`u` 下架（`setSticky(id,false)`）。轮询 15s 只刷便签板。

**Triage**：`triage.list()` 轮询 10s；`Enter` overlay 详情+建议；`c` confirm / `r` reject / `d` dismiss。`approvals.list()` 非会话项并入此 tab 顶部区块，`a`/`r` 审批。

## 6. 错误处理

| 场景 | 行为 |
|---|---|
| gateway 未运行 | 启动即提示 + 退出（非零码） |
| 运行中断线 | statusbar 红显 + 退避重连；发送禁用；重连后补拉 |
| API 错误 | statusbar 短暂错误条 + 面板内联错误行，不崩 UI |
| overlay 操作失败 | overlay 内显示错误，不关窗 |
| render 行宽超限 | 所有自定义组件经 `truncateToWidth()` 兜底 |

## 7. 测试策略（TDD 先行）

- `store/` 纯 TS 单测：mock `@mafw/sdk`，覆盖轮询状态机、SSE 重连退避、消息累积/finalize、cursor 分页
- `ui/` 用 pi-tui `VirtualTerminal`（@xterm/headless）渲染断言：tab 切换、overlay、流式追加、行宽契约
- 集成：`mafw tui` 无 gateway 提示路径 / 有 gateway 启动路径各一例

## 8. 显式不做（v1 YAGNI）

- 图片内联渲染（Kitty/iTerm2）
- Config 面板（SettingsList 留 v2）
- 远程 gateway（仅 loopback）
- Usage/Quota 面板
- goal 创建/编辑（v1 只读 + 取消 + 问答）
