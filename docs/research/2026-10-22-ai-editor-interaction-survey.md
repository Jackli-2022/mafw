# AI 编辑器交互调研（agent workbench 一期 · editor 行为）

2026-10-22 · 目的：为协同编辑器（`docs/superpowers/plans/2026-10-22-agent-workbench-phase1.md`）的交互语义钉业界参照。对象：Cursor / Windsurf / Zed / VSCode Copilot / 新兴 agent 控制面板（Paseo、Aura、Nimbalyst）+ Claude Code 并发编辑事故。

## 1. 选区 → agent：业界收敛为两个不同动作

| 动作 | Cursor | Zed | VSCode | 本质 |
|---|---|---|---|---|
| **送进会话**（上下文+指令） | Cmd+Shift+L「Add to Chat」；Cmd+L 带选区开 Agent | Agent Panel 引用选区 | 选区 hint → inline chat / chat | 选区作为**对话输入**，agent 在会话里处理 |
| **内联改写**（Cmd+K 式） | Cmd+K：选区+指令→**就地**生成 diff→Enter 接受/Esc 拒绝 | ctrl+enter Inline Assistant：选区发给 LLM **直接替换** | inline chat：选区作用域 prompt → 内联 diff Keep/Undo | 编辑器内嵌一条**独立 LLM 调用**，不经过会话 |

**对 MAFW 的裁定**：我们的标注直发 = 「Add to Chat」家族（选区+批注 → 当前会话 `promptAsync`）。**不做 Cmd+K 式内联改写**——它需要编辑器内嵌独立 LLM 通路，与"agent = 会话"（同一实例原则）冲突，且绕开记忆/审批/轨迹管线。Cursor 自己的分层也佐证这个分工：Chat=问、Cmd+K=单文件快改、Composer=多文件——我们的会话 agent 覆盖的是 Chat+Composer 两层，Cmd+K 那层本来就不是我们的形态。

**交互细节借用**：选区上浮动小按钮（Cursor「Edit / Add to Chat」affordance）→ 我们的「批注」浮钮同形态；零宽选区不出按钮（各家一致）。

## 2. agent 改动的验收：先落盘、后审，Git 是安全网

- **VSCode**：agent 编辑**直接保存到磁盘** + 标 pending（Keep/Undo，粒度=单 hunk/单文件/全部；`chat.editing.autoAcceptDelay` 可自动 Keep；checkpoint 可整体回退）。社区明确批评 Keep/Undo 双态困惑（issue #262495），新 harness（Copilot/Claude/Codex sessions）已改为**直接落盘 + Git/checkpoint 回退**，不再要 Keep。
- **Zed**：multibuffer 统一 diff 审阅 + hunk 级 keep/reject；`agent.single_file_review` 内联模式。
- **Windsurf**：hunk/文件/全部三级 accept/reject + 会话内 checkpoint 回退（Alt+j/k 导航 diff）。
- **Nimbalyst**（agent 控制面板类）：Monaco 内联 diff，**审阅期间编辑器只读**，Accept/Reject All。

**对 MAFW 的裁定**：我们的模式（agent 直接改真文件 → session.diff 事后审 + hunk 级 revertDiff + 行级评论回喂）**正是业界收敛方向**，且不引入 VSCode 被批评的 Keep/Undo 双态。DiffReviewPanel 复用不变。「审阅期间只读」（Nimbalyst）在 diff 模式下天然成立（diff 视图本身不可编辑）。

## 3. 人机并发编辑同一文件：业界的坑与三种防线

**Claude Code issue #87056**（2026-08，closed as not planned）：agent 的 Edit 与用户编辑器 autosave 互踩——**无冲突检测，用户陈旧缓冲区静默覆盖 agent 改动**，反向亦成立。这正是我们 Review Focus #3，且说明连头部产品都没解决好。

业界三种防线（按强度）：

1. **watch + 冲突横幅**（Nimbalyst）：文件被外部改动 → 无未保存编辑则自动重载，有未保存编辑则横幅「加载磁盘版 / 保留我的」。Paseo 的 MVP 清单逐字相同（dirty 态 + Ctrl+S + 磁盘改动警告 + 二进制/大文件只读 + 「在外部编辑器打开」逃生口）。
2. **保存时版本校验**（Aura / Paseo expected_revision）：写入前比对 expected mtime/revision，不匹配 → 拒绝并弹「重开提示」，**杜绝 watch 事件延迟窗口内的静默覆盖**。
3. **OT/CRDT 合并**（#87056 的长远诉求）：Google Docs 级协同——本期不做。

**对 MAFW 的裁定**：我们 plan 已有 ①（fs.watch + 状态机冲突横幅，与 Nimbalyst/Paseo 逐字对齐）。**调研新增 ②：保存时 mtime 前置校验**——`writeTextFile` 带 `ifMtimeMs`，不匹配返回 conflict，编辑器弹「磁盘已被改动（可能被 agent 修改）：覆盖 / 重新加载」。成本极低（readFile 时记下 mtime，save 时带回），把 watch 防抖窗口（300ms+事件延迟）内的漏检补死。③ 留远期。

## 4. 保存语义：业界混合，显式保存不落后

- Zed：autosave 默认 **off**（off / on_focus_change / after_delay 可选）。
- Nimbalyst：2s 无操作 autosave + Cmd+S 立即保存。
- VSCode agent 模式：agent 编辑**总是自动保存**（与用户 autosave 设置无关）。
- Paseo MVP：debounce autosave + Ctrl+S + dirty 指示。

**对 MAFW 的裁定**：一期维持**显式 Ctrl+S + dirty 指示**（spec Q4 已拍）。理由：我们的 dirty 窗口正是冲突横幅的触发域，autosave 会把「人没编完」的中间态写进 agent 正在读的真文件——显式保存让"写盘"成为用户的显式动作，与 A1（爆炸半径意识）一致。autosave 作为二期可选设置。

## 5. 编辑器身份：两种产品形态

- **AI-first 编辑器**（Cursor/Windsurf/Zed）：编辑器是本体，AI 是住民。
- **agent 控制面板 + 轻量编辑**（Paseo/Aura/Nimbalyst）：agent 会话是本体，编辑器是验收/微调界面——Paseo issue #1295 的 MVP 清单与我们一期范围几乎逐字重合，且明确「不做完整 IDE，保留外部编辑器逃生口」。

**对 MAFW 的裁定**：我们是后者。**新增「在外部编辑器打开」逃生口**（shell.openPath，一行 IPC）——用户真要重度编辑时一键回 VSCode，我们不追全功能 IDE。

## 6. 其余零散但值得记的

- Windsurf 教训：两个 Cascade 同时改一个文件会 race → 我们的场景同构（两个子代理/两个会话改同一文件）——保存时校验 + 冲突横幅同样兜住。
- Zed 选区引用：`cmd->` 把选区以 fenced code block 插入会话——与我们的 buildAnnotationPrompt 同构（路径+行号+代码块）。
- VSCode pending 态**重启后恢复**——我们不需要（无 pending 双态）。

## 7. 对一期 plan 的修订清单

1. **Task 1**：`writeTextFile` 增 `ifMtimeMs` 前置校验（conflict 返回）；`readTextFile` 返回 `mtimeMs`；`FsIO` 增 `stat`。
2. **Task 5**：save 流程带 mtime 校验 → conflict 横幅（覆盖/重新加载）；新增「在外部编辑器打开」按钮（Task 2 IPC 面加 `shell-open-path`）。
3. 其余不变（标注直发、diff 复用、显式保存均获业界佐证）。
