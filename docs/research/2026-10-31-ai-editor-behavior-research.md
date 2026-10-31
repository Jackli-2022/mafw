# AI 编辑器行为调研（2026-10-31）

目的：为 MAFW 工作台编辑器钉住“agent 改动如何呈现/验收/回退”的业界行为基线，并核对我们的现状。
前作：`docs/research/2026-10-22-ai-editor-interaction-survey.md`（一期交互语义，仍有效）；本文补 2026-10 最新产品行为、我们 10-23 之后的变化（激活重读、文件树监听、Office 预览批注、per-turn diff 等）与差距。

范围：Cursor / Zed / Windsurf（Devin Desktop）/ VS Code Copilot / Claude Code / Codex，附 Kimi / Grok / Meta Muse 的文档编辑形态。
口径：只看编辑器和 agent 的协作行为，不评价模型能力；产品文档与社区 issue 交叉验证，营销描述不作为事实。

## 1. 我们的现状（2026-10-31 代码核对）

### 1.1 agent 改动的落地与验收
- **直接落盘**：agent 通过 write/edit/bash 改真实文件，没有 pending/Keep 双态；这与 Cursor / Claude Code / Codex / VS Code harness 会话一致。
- **事后审阅**：
  - 每回合 diff：`session-turn-diffs.ts` + `turn-diffs.ts`（busy 时排除在飞回合，失败可重试，请求 key 上限 50）。
  - 审阅面：`ChangesDock`（工作台 › 审阅）+ `EditorDock` 内嵌 `DiffReviewPanel`（`mode() === "diff"`，按当前文件打开）。
  - 粒度：**逐 hunk 勾选 → 回退选中**（`revertDiff`：gateway 反转 patch → `git apply` 落工作区）；行级评论回喂 agent；行/hunk 可加入批注草稿。
  - 不可完整反转的 patch（新增/删除、二进制、mode 变更）不给回退按钮（`isFileRevertible`）。
- **没有**：pre-apply 的 pending 审阅、单文件 inline keep/undo 装饰、Backspace 式逐字符 accept。

### 1.2 回退 / 时间线
- `CheckpointOverlay`（时间线）：自动检查点 per turn（gateway `CheckpointService`，tree = 本回合首条 assistant 的 snapshot.start），三种 restore：**仅对话 / 仅代码 / 代码+对话**（`session` / `files` / `both`）。
- 已知边界：opencode 2.1 的 revert 会删除 anchor 消息本身；manual 检查点只支持 `files`；在飞回合不可回滚；依赖 git snapshot（`~/.local/share/opencode/snapshot/...`），**非 git/二进制文件（含 Office）没有文件级历史**。
- 与业界相比：我们的“代码+对话”二选一已对齐 VS Code/Claude Code 的 checkpoint；缺“先预览再恢复”。

### 1.3 人类编辑与并发
- 显式保存（Ctrl+S）+ dirty 指示；保存带 `ifMtimeMs` 前置校验（防 watch 防抖窗口内静默覆盖）。
- 外部改动：活动文件 fs.watch → 干净静默 reload；dirty → 冲突横幅（保留我的/重新加载），绝不覆盖。
- 激活重读：切回后台 tab 时按 mtime 重新读盘（2026-10-31 新增）；文件树监听目录变更自动刷新（同日新增）。
- 二进制/超大/非 UTF-8 → 只读提示；「在外部编辑器打开」逃生口（`openExternal`）。
- 并行 agent：会话/goal 有 worktree 隔离；同文件并发仍靠 mtime 校验 + 冲突横幅兜底。

### 1.4 批注 / 选区 / 反馈
- 预览批注覆盖 md/docx 引文、json 路径、csv/xlsx 单元格、图片/SVG 区域、pptx 页码+坐标图钉；源码选区可批注。
- diff 行级评论 → agent；发送后的反馈标记（待回应/已回应）按回合闭合。
- 这是相对 Codex artifact viewer / Kimi Slides 的同型能力，且我们覆盖的文件类型更多。

### 1.5 没有做的（与业界 AI-first 编辑器对比）
- 无 inline completion / next-edit prediction（Tab 补全、跨文件跳转）。
- 无 pre-apply 审阅（业界主流也在放弃，见 §2）。
- 无“编辑上一条 prompt 并回滚后续 + 重发”。
- 无编辑器内 inline diff 装饰（我们用的是独立审阅面板/抽屉）。
- 无文件级历史快照（非 git / 二进制）。

## 2. 业界 2026 行为

### 2.1 Cursor
- Agent 边工作边落盘；review 在 diff view 里“拒绝不想要的”，没有全量 pending 门。
- **Checkpoints**：每个 agent 回合前快照；点消息上的 Restore Checkpoint **只回滚文件，不删消息**；要缩短对话用 fork chat。
- **Cmd+K 内联改写已被取消**：现在的 Cmd+K / Cmd+L 是“把选区带进 Agent”；即 Cursor 自己从“编辑器内嵌独立 LLM 调用”收敛到“选区 → 会话”。
- **Tab**：next-edit prediction（多行、跨文件、跳转到下一个编辑点，逐词接受）；这是 AI-first 编辑器的补全层。
- Agent Review / Bugbot：对本地改动做独立 review（自动或 `/agent-review`）。
- 队列/steer：忙时 Enter 排队、Tab 排到回合后；steer 在下一个工具调用边界注入。

### 2.2 Zed
- 原生 agent：Review Changes 打开 **editable multibuffer**，可逐 hunk / 全部 keep 或 reject；`agent.single_file_review` 在单文件内联显示同一套 keep/reject。
- **外部 agent（ACP，如 Claude Code/Codex/OpenCode）的编辑是 final**：官方说明曾依赖 ACP 文件系统 API，因准确性问题/采用率低而不可用；社区仍在请求补 per-hunk 审阅（discussion #56048）。
- Edit Prediction（Zeta2）：tab 接受、逐词/逐行、LSP 补全共存；与 agent 编辑是两层。
- 并行 agent：worktree 隔离；Terminal Threads 并入 Agent Panel。

### 2.3 Windsurf / Devin Desktop
- Cascade/Devin Local：计划预览 → 多文件编辑 → diff 审阅；官方文档强调 **named checkpoints + revert**，并明确 revert **不可逆**；两 Cascade 同文件会 race，建议 worktree。
- 第三方评测描述“diff-staged、按文件/hunk 批准”，官方文档更强调 revert/checkpoint；以官方为准。
- 保存类：实时感知 + linter 自动修复（可关）。
- 2026-06 起产品并入 Devin Desktop，Cascade 逐步由 Devin Local 取代。

### 2.4 VS Code Copilot（含 Agents 窗口）
- **按 harness 分两种**：
  - Copilot / Claude / Codex harness 会话：**直接保存**，不进入 pending；用 checkpoints / Git / Source Control 回退。
  - Local/extension-host 会话：保存后标 **pending**，逐 change Keep / Undo（`chat.editing.autoAcceptDelay` 可自动 Keep）。
- 多文件 summary diff；checkpoint restore 会**移除后续请求**并恢复工作区；支持编辑上一条 request（回滚该请求及之后，再重发）。
- 已知坑：pending Keep/Undo 与用户手动编辑并发时可能静默覆盖（issue #263856）；他们用 auto-accept + checkpoint 缓解。

### 2.5 Claude Code
- `/rewind`（Esc Esc）：恢复 **code / conversation / both**；checkpoint 在每个 prompt 回合前拍文件。
- 跟踪边界（官方文档）：只跟踪 Edit/Write/NotebookEdit 触及的文件（之后 Bash 改同一文件也算），**只被 Bash 改过的文件不跟踪**；后台 subagent 的编辑不跟踪；目录创建/移动/删除不恢复；每会话最多 100 个，约 30 天清理。
- 明确“git 才是真正的 undo”；plan mode 先审方案不动文件。

### 2.6 Codex
- CLI：直接 apply patch；`/diff` 事后看 Git diff，`/review` 做独立 review；**没有原生 pre-apply 逐文件审阅**（issue #39939 仍在请求）。
- Codex app：线程内 review/评论 diff、可打开编辑器手改；worktrees 并行；cloud 结果 apply 回本地；artifacts viewer 预览文档/演示/表格/PDF 并支持批注。
- Apply Patch API：`needsApproval` 可选（宿主自己决定），不是默认交互。

### 2.7 Kimi / Grok / Meta Muse（文档编辑形态）
- Kimi Slides：自有编辑器 + PPTD 中间层 + 批注“指哪改哪” + 每轮版本快照；导出 PPTX/PNG。
- Grok：Office 加载项（活文档侧边栏）+ 原生文件生成；AutoSave + 前后对照。
- Meta Muse：通用 agent + `AGENTS.md`/skills，未检索到第一方 Office 编辑器；能力来自技能/工具。
- 结论：文档编辑器的产品化差异在“预览/批注/版本”，不在结构化 API。

## 3. 横向模式

| 维度 | 收敛结论 | 我们的位置 |
|---|---|---|
| 落地模型 | 自主 agent 主流**直接落盘 + 事后审**；pre-apply pending 主要存在于 VS Code local/extension 会话 | ✅ 一致 |
| 审阅粒度 | 头部产品都提供 **hunk/change 级 reject/keep**（Zed/Cursor/VS Code）；Claude 只有 turn 级；Codex 以 diff + 评论为主 | ✅ 我们 hunk 级回退 + 行评论 |
| 回退范围 | 文件 / 对话 / 两者；Cursor 文件 only、VS Code 两者、Claude 两者、Windsurf 文件 | ✅ 我们三选一 |
| 回退预览 | Cursor 点 checkpoint 预览文件；VS Code 显示 file changes | ❌ 我们只显示文件 chips |
| 非 git 文件历史 | Claude Code `~/.claude/file-history`；Cursor workspace snapshot | ❌ 我们依赖 git snapshot |
| 冲突检测 | 多数产品靠 checkpoint/git，仍会出现 Keep/Undo 与手改互踩 | ✅ 我们 mtime 前置校验 + 冲突横幅更强 |
| 内联 AI | AI-first 编辑器有 Tab 补全/next-edit；Cursor 已把 Cmd+K 内联改写并回会话 | ✅ 不做，符合 agent-panel 形态 |
| diff 呈现 | Zed/Copilot 可内联在编辑器；agent-panel 产品多在面板/抽屉 | ⚠️ 我们面板 + 编辑器 diff 模式，无 inline 装饰 |
| 运行时隔离 | worktree 并行是共识（Cursor/Zed/Codex/Windsurf） | ✅ 我们已有 |
| 批注 | Codex artifact viewer / Kimi 文档批注 | ✅ 我们覆盖更广（源码+多格式预览） |

## 4. 差距与建议（按性价比排序）

1. **文件级历史快照（P0，和 Office 编辑同一批）**
   - 现状：checkpoint 只覆盖 git snapshot；Office/二进制/非 git 目录没有可回退版本。
   - 业界：Claude Code 在 `~/.claude/file-history/` 为 Edit/Write 触及的文件做副本；Cursor 做 workspace checkpoint。
   - 建议：gateway 增加 `FileHistoryService`（写入前 copy-on-write 到 `~/.mafw/file-history/<session>/<seq>/<rel>`，保留 N 天/每会话上限；记录 mtime/hash；支持按文件/按回合恢复；与时间线合并）。office-editing 技能在保存前调用同一服务。
2. **Checkpoint 预览（P1）**
   - 时间线点某回合先看“将恢复的 diff”（复用 `session-turn-diffs`），再确认 restore；避免“先恢复再发现不对”。
3. **编辑器内联 diff 装饰 + 改动导航（P1/P2）**
   - 方案：在 CodeMirror 里给 agent 变更画只读绿/红装饰 + 上一处/下一处（不引入 keep/undo 双态，拒绝仍走 `revertDiff`）；`ChangesDock`/diff 面板保留全量审阅。
   - 业界参照：Zed `agent.single_file_review`、VS Code inline working set；但不要做 pending 状态。
4. **审阅导航（P2）**
   - 批量审阅时“下一个有改动的文件/下一个 hunk”、已处理标记（VS Code resolve 后自动跳下一个）；成本低。
5. **编辑上一条 prompt 并重发（P2/P3）**
   - VS Code 的 edit request：回滚该请求及之后 + 重发；我们目前只能 checkpoint 回滚后手动重发。可评估。
6. **不要做（明确非目标）**
   - inline completion / next-edit prediction（AI-first 编辑器层，和“agent = 会话”冲突；Cursor 自己也在收缩内联改写）。
   - pre-apply pending 全量审阅（主流自主 agent 已放弃；我们的直接落盘 + 事后 hunk 回退更符合）。
   - 全功能 IDE（保持外部编辑器逃生口）。

## 5. 结论

- 我们的编辑行为处在业界主流：直接落盘 + 事后 hunk 级回退 + 行评论 + checkpoint（文件/对话/两者）+ mtime 冲突防线；预览批注覆盖度高于多数产品。
- 真正的缺口是 **非 git/二进制文件的文件级历史**（Office 编辑的前置条件）、**checkpoint 预览**、**内联 diff 导航**。
- Kimi/Grok 的“自有编辑器 + 版本 + 批注”和 Codex 的“artifact viewer + 技能 + 渲染 QA”都指向同一结论：产品化价值在预览/批注/回退，不在固定编辑 API。

## 6. 参考

- Cursor Agent / Checkpoints / Tab：https://cursor.com/docs/agent/overview · https://cursor.com/help/ai-features/agent · https://cursor.com/help/ai-features/tab
- Zed Agent Panel / Review Changes / Edit Prediction：https://zed.dev/docs/ai/agent-panel · https://zed.dev/docs/ai/edit-prediction
- Zed 外部 agent 审阅讨论：https://github.com/zed-industries/zed/discussions/56048
- Windsurf/Devin Cascade 文档：https://docs.windsurf.com/windsurf/cascade/cascade
- VS Code Review and revert agent changes：https://code.visualstudio.com/docs/agents/run/review-code-edits · 冲突 issue：https://github.com/microsoft/vscode/issues/263856
- Claude Code Checkpointing：https://code.claude.com/docs/en/checkpointing · /rewind 限制：https://www.matthewswong.com/en/learn/claude-code-tips/claude-code-rewind-plan-mode-safe-changes
- Codex CLI 命令 / diff：https://developers.openai.com/codex/cli/reference · pre-apply 审阅 issue：https://github.com/openai/codex/issues/39939
- Codex app / artifact viewer：https://openai.com/index/introducing-the-codex-app · https://developers.openai.com/codex/artifacts-viewer
- Kimi Slides / Grok PowerPoint / Muse Code：见 `docs/research/2026-10-31-office-agent-editing-research.md` §3.5
