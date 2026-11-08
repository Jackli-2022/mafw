# 文件历史 UI 业界调研（2026-10-31）

目的：为 MAFW 工作台补上「文件级历史」的桌面入口（查看 / 对比 / 恢复）建立行为基线，
避免把 agent 检查点（整回合回滚）和 IDE 本地文件历史（按文件版本）混成一层。

范围：VS Code Timeline / Local History、JetBrains Local History、Cursor Checkpoints、
Claude Code Checkpoints、Cline Checkpoints、Windsurf（Devin Desktop Cascade）、Zed（对照）。

口径：只看官方文档与可验证的产品行为；营销描述不作为事实。社区 issue 用于验证失败模式。

## 0. 结论先行

1. 业界存在**两条独立机制**，解决的问题不同：
   - **IDE 本地文件历史**：按保存/按版本记录单文件全文，独立于 Git，覆盖未跟踪文件、二进制、非 git 目录。
     代表：VS Code Timeline / JetBrains Local History。
   - **Agent 检查点**：按回合或按工具调用快照整个工作区，恢复时通常「文件 + 对话」可选。
     代表：Cursor / Claude Code / Cline / Windsurf。
2. MAFW 两层数据都已存在：
   - `CheckpointService`：turn 级、依赖 opencode git snapshot，已有时间线 UI（`CheckpointOverlay`）。
   - `FileHistoryService`：写前快照、内容寻址、按 session + 文件、覆盖非 git/二进制/Office；**缺 UI**。
3. 文件级历史的成熟 UI 范式是**「版本列表 + 差异」双栏**：
   - JetBrains：模态对话框，左列表右 diff（对比当前版本）。
   - VS Code：Timeline 列表 + 独立 diff editor；支持「对比当前 / 对比上一版本」。
4. 「恢复前先预览」「恢复可反悔」是高频诉求；Windsurf 明确警告 revert 不可逆，是反面案例。
5. AI 编辑器普遍只做**整工作区回滚**（Cursor/Claude/Cline/Windsurf），文件粒度弱；
   MAFW 的文件级历史（尤其 Office/二进制/非 git）是差异化能力，值得单独做入口。

## 1. VS Code — Timeline / Local History

来源：VS Code 官方文档（User Interface → Timeline view；1.66 release notes）。

- **触发**：每次保存生成一条本地历史（不是每次按键）。默认开启。
- **内容**：每条包含当时完整文件内容；某些场景附带语义信息（如重构）。
- **入口**：Explorer 底部可折叠的 Timeline；按天分组；可过滤 Git / Local History 来源。
- **动作**（条目右键/工具栏）：
  - Compare with File（与当前文件对比）
  - Compare with Previous（与上一版本对比）
  - Select for Compare（选两条互相比）
  - Restore Contents（恢复）
  - Rename / Delete（条目可命名、可删）
- **删除文件恢复**：`Local History: Find Entry to Restore` 全局 Quick Pick，可按文件名找回已删除文件。
- **保留/成本参数**（默认值，2026 仍在用）：
  - `workbench.localHistory.enabled` = true
  - `workbench.localHistory.maxFileSize` = 256 KB
  - `workbench.localHistory.maxFileEntries` = 50 / 文件
  - `workbench.localHistory.mergeWindow` = 10s（窗口内连续保存合并进上一条）
  - `workbench.localHistory.exclude`：glob 排除
- **关键 UX**：列表是常驻面板（不是 hover 才出现）；点击条目直接打开 diff；恢复是一等按钮。

## 2. JetBrains — Local History

来源：IntelliJ IDEA 官方文档（Local History，2026.2）。

- **触发**：自动记录「有意义的变更」，包括 IDE 内编辑、运行测试/部署/提交、**外部工具改动**。
- **入口**：`File | Local History | Show History`，或文件/目录/项目右键。
- **形态**：对话框；左侧版本列表（时间戳 + 事件标签），右侧 diff viewer（选中的 revision vs 当前文件）。
- **恢复**：
  - 整文件：`Revert Selected and Later Changes`（回退到该版本，并丢弃其后版本）或工具栏 Revert。
  - 片段：在 diff 里用 chevron 把某段从历史侧复制回当前文件。
  - 支持目录/项目/多文件选择；也能恢复被删除的文件。
- **标签**：测试运行、部署、提交等事件会自动给 revision 打标签，便于在时间戳里定位。
- **保留**：`localHistory.daysToKeep` 可配（JVM option），默认按 IDE 策略。
- **关键 UX**：左列表 + 右 diff 的**同屏**布局；恢复动作在工具栏恒定可见；支持片段级恢复。

## 3. Cursor — Checkpoints

来源：Cursor Docs（Checkpoints）。

- **触发**：agent 每个请求/回合自动快照；只跟踪 agent 改动，不跟踪手工编辑。
- **存储**：本地，独立于 Git；自动清理。官方明确「不是版本控制」。
- **预览/恢复**：
  - 聊天时间线里点任意 checkpoint → 预览该时刻的文件状态；
  - `Restore Checkpoint`（输入框上一条请求的按钮 / 消息 hover 的 +）→ **只回滚文件，不删除消息**。
- **粒度**：工作区级（整批文件），没有单文件版本列表。
- **失败模式（社区，2026-08）**：checkpoint 数据在磁盘上，但 Restore 控件间歇性不显示，
  用户被迫回到 Local History / git。教训：**恢复入口不能依赖 hover 或偶发状态**。

## 4. Claude Code — Checkpointing / Rewind

来源：Claude Code Docs（Checkpointing；Agent SDK file-checkpointing）。

- **触发**：每个「开始回合」的 prompt 前快照；跟踪 Write/Edit/NotebookEdit 修改的文件。
- **入口**：`/rewind`（别名 `/checkpoint` `/undo`），或输入框为空时连按 Esc 两次。
- **恢复选项**：
  - Restore code and conversation（文件 + 对话）
  - Restore conversation（只回对话，保留当前代码）
  - Restore code（只回文件，保留对话）
  - Summarize from here（压缩后续对话）
- **保留**：约 30 天清理；最近 100 个 checkpoint 保留文件快照。
- **边界**：Bash 的 rm/mv/cp 不跟踪；symlink/hardlink 跳过并警告；不是 VCS 替代。
- **关键 UX**：恢复范围明确三选一；菜单里直接显示「哪些选项可用」；失败有明确原因（No files were restored）。

## 5. Cline — Checkpoints

来源：Cline Docs（Checkpoints）。

- **机制**：shadow Git 仓库（独立于项目 Git）；每次工具调用后提交一次，包含未跟踪文件。
- **入口**：每个 step 的 Compare / Restore。
- **恢复选项**：
  - Restore Files（只回文件，保留对话）
  - Restore Task Only（只回对话，保留文件）
  - Restore Files & Task（两者都回）
- **预览**：Compare 打开 step diff。
- **持久化**：跨编辑器会话保留。
- **历史问题**：checkpoint 目录曾无限增长（120GB+）；后期版本在恢复前用 stash 捕获当前工作区（可反悔）。
  教训：**保留上限 + 恢复前快照是必需项**。

## 6. Windsurf / Devin Desktop — Cascade Reverts

来源：Windsurf Docs（Cascade → Named Checkpoints and Reverts）。

- **入口**：hover 原始 prompt 的 revert 箭头，或 table of contents；也可创建命名 checkpoint。
- **粒度**：工作区级，回滚到该 step 的全部代码状态。
- **明确警告**：Reverts are currently irreversible（不可撤销）。
- **教训**：不可逆回滚是显著风险；文件级、可反悔的恢复更安全。

## 7. Zed（对照）

- 2025-11 起提供 Commit & File History 视图，但属于 **Git 历史**，没有独立于 Git 的本地文件历史。
- 说明「本地文件历史」并非所有编辑器都有；对 agent 直接落盘的工作台，它是补足非 git 场景的关键层。

## 8. 横向对比

| 产品 | 触发/机制 | 粒度 | 预览 | 恢复范围 | 保留策略 | 恢复可逆 |
|---|---|---|---|---|---|---|
| VS Code | 每次保存；本地全文 | 单文件版本 | diff vs 当前/上一版 | 单文件（含删除文件找回） | 50/文件，256KB，10s 合并 | 恢复后仍进历史 |
| JetBrains | 有意义变更（含外部） | 单文件/目录/项目 | 左列表 + 右 diff | 整文件、片段、多文件 | daysToKeep 可配 | 回退会丢弃后续版本 |
| Cursor | 每个 agent 请求 | 工作区 | checkpoint 预览 | 文件（不动对话） | 自动清理 | 未承诺 |
| Claude Code | 每个 prompt | 被编辑文件 | /rewind 列表 | 文件/对话/两者 | ~30 天，最近 100 | 对话可再 rewind |
| Cline | 每次工具调用（shadow git） | 工作区（含未跟踪） | step diff | 文件/任务/两者 | 需清理（历史问题） | 新版恢复前 stash |
| Windsurf | 每个 prompt | 工作区 | 无明显预览 | 全部代码 | 未公开 | **不可逆** |
| MAFW 现状 | 每次写前（插件 hook） | 单文件 | 无 UI | 单文件（已有 pre-restore） | 20/文件，500/会话 | **可反悔** |

## 9. 对 MAFW 的设计含义

1. **入口放在编辑器头部**（当前文件），不新做全局时间线：我们的历史是 session + 文件维度，
   全局列表价值低且会与 `CheckpointOverlay` 的回合时间线混淆。
2. **形态用「左版本列表 + 右 diff」**：复用现有 `DiffReviewPanel` 的 `embedded + previewOnly`
   （JetBrains 同屏范式，VS Code 列表 + diff 的等价物）。
3. **默认对比当前磁盘内容**；提供「对比上一版本」切换（VS Code 的 Compare with Previous）。
4. **恢复必须二次确认 + 恢复前自动快照**（`pre-restore` 已有）：恢复本身可再回退，
   直接优于 Windsurf 的不可逆 revert。
5. **二进制/Office 不强行做文本 diff**：显示版本元数据 + 恢复按钮；这是相对 AI 编辑器整包回滚的差异化。
6. **列表信息密度**：按天分组（今天/昨天/日期）；相对时间 + 绝对时间 tooltip；
   reason 徽标（Agent 写入前 / 恢复前 / 手动 / 其他）；文件大小。
7. **可发现性与可靠性**：按钮常显（有历史时），恢复按钮不做 hover-only（Cursor 2026 教训）；
   空态明确说明「agent 写入前自动保存」。
8. **保留策略对齐业界**：每文件上限从 20 提到 50（VS Code 默认），会话总上限保留；
   内容寻址已去重，成本可控。`maxFileBytes` 保持 50MB（Office 场景）。
9. **实时性**：编辑器已有 fs.watch；历史面板打开时监听文件变更并刷新（新版本/外部改动）。
10. **v1 非目标**：全局跨文件时间线、删除文件恢复选择器、新建文件 tombstone（回退「创建」）、
    云端同步、替代 Git。新建文件目前无历史版本（文件不存在时不快照），需在 UI 明示。

## 10. 我们现状与差距（代码核对）

- `gateway/src/core/file-history/file-history-service.ts`：写前快照、内容寻址、路径 jail、
  `pre-restore` 反悔、20/文件、500/会话、50MB 上限；`list()` 只返回元数据。
- `gateway/src/routes/file-history.ts`：snapshot / list / restore 三端点（loopback）。
- 插件 `tool.execute.before`：写前调用 `/api/file-history/snapshot`（`reason=tool:before`）。
- `packages/desktop/.../EditorDock.tsx`：头部动作区、`mode=edit|diff`、`DiffReviewPanel embedded`、
  内联 diff 装饰、`fs.watch` 版本号。
- 差距：
  - 无内容读取端点（UI 无法拿到历史版本内容做 diff）；
  - SDK / preload 未暴露 `fileHistory`；
  - 无历史面板与恢复入口；
  - 每文件上限 20（业界 50）；
  - 新建文件无版本（文件不存在时快照被跳过）。

## 11. 参考

- VS Code Timeline / Local History：<https://code.visualstudio.com/docs/editing/userinterface>
- VS Code 1.66 release notes：<https://code.visualstudio.com/updates/v1_66>
- JetBrains Local History：<https://www.jetbrains.com/help/idea/local-history.html>
- Cursor Checkpoints：<https://cursor.com/docs/agent/chat/checkpoints>
- Claude Code Checkpointing：<https://code.claude.com/docs/en/checkpointing>
- Claude Agent SDK file checkpointing：<https://code.claude.com/docs/en/agent-sdk/file-checkpointing>
- Cline Checkpoints：<https://docs.cline.bot/core-workflows/checkpoints>
- Windsurf Cascade（Named Checkpoints and Reverts）：<https://docs.windsurf.com/windsurf/cascade/cascade>
- Zed 2025 回顾（Commit & File History Views）：<https://zed.dev/2025>
