# Session / Topic 业界调研（Claude · DSH · Codex）

> 2026-11-10 · 用于回答「如何让用户少感知 session，把话题作为一等对象」。
> 方法：官方文档 + 源码 + release notes + issue，三路并行调研。
> 标注：**[C]** 官方文档/源码确认；**[I]** 推断；**[U]** 未验证/二手。

## TL;DR

1. 三家都在把 **frame（session / thread）降级为可丢弃的缓存**，把连续性放到外部：append-only log、memory、notes、repo。
2. 但没人真正把 frame 完全藏起来：Claude Code / Codex 暴露 session 是为了 resume；Claude.ai 藏了但不可恢复；DSH 隐藏 subagent，但仍保留 session 列表。
3. 最接近「Lead = router」的是 **DSH SuperAgent**：Router 只跟人对话和分派，Worker 才是隔离 session + worktree；一个人只跟踪 3–5 个活跃 session。
4. 对 MAFW 的直接结论：**Lead router 不该有 topic / resume**；topic / frame 模型下沉到 Tech Lead / Builder 数据平面。
5. 最值得抄的两个底层原语：
   - DSH 的 **append-only event log + `surfaceOp: replace`**：压缩 = 遮蔽一段 range，原始日志永远在。
   - DSH 的 **Workspace**：session 之上的稳定容器，模型不可见，成员关系由人显式维护。

---

## 1. Claude

### 1.1 Claude Code：session 是「可恢复句柄」

| 维度 | 机制 |
|---|---|
| 工作单元 | Session = 绑定项目目录的对话 **[C]** |
| 上下文存储 | `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`；另有 auto-memory 目录 **[C]** |
| 边界 | 新启动、`/clear`、`/branch`、`--fork-session`、worktree **[C]** |
| 恢复 | `--continue`、`--resume <id\|name>`、`/resume`、`--from-pr`；恢复 model / agent / permission mode / goal **[C]** |
| 压缩 | `/compact [focus]`、接近上限时自动压缩、`/autocompact N`、空闲时压缩 **[C]** |
| 隔离 | subagent = 新窗口 + 自己的 prompt/tools/transcript；fork = 完整历史 **[C]** |

关键行为：

- `/clear`、`/branch` **从不销毁旧 transcript**，旧 session 留在磁盘且可恢复；`/clear` 之后 rewind 菜单还提供「previous session」入口 **[C]**。
- 压缩保留原始消息，但 **resume 后不会重新加载 summary 之前的消息** **[C]**。
- resume 恢复「承诺」：model、agent、permission mode、goal、未过期任务；**不重放中断的 tool call**，未完成的后台工作以 note 形式提示模型 **[C]**。
- 失败模式：两个终端 resume 同一 session 会交错写同一份 transcript；rewind 快照过期后无法恢复文件；长空闲 resume 触发成本对话框；subagent 名字不跨压缩/重启 **[C]**。

用户可见：resume picker（标题、摘要、空闲时间、branch、大小）、`/context` 分解、`Conversation compacted` / `Summarized conversation` 标记 **[C]**。

### 1.2 Claude.ai / Desktop：chat / project，没有 session 概念

- 用户面对的单位是 **chat** 和 **project**（project 有自己的 chats、knowledge、instructions、memory）**[C]**。
- memory 以「topic」为单位边聊边存，而不是会话结束后总结；per-chat memory 在第一条消息时绑定，之后不可改；project memory 默认隔离 **[C]**。
- chat search 按容器做 RAG：全部非 project chat，或单个 project 内的 chat **[C]**。
- 最新 Projects beta **反转了层级**：「一个 project 就是一个 conversation」，下面按 task 开 thread，每个 thread 从 project 的 files / repos / instructions / memory 起步 **[C]**。
- 即：**topic 形状的对象吸收了 session 形状的对象**。

### 1.3 Agent SDK / API：session 是库的职责

- SDK：`continue`、`resume: id`、`forkSession`、`persistSession: false`、`sessionStore`（跨主机）、`renameSession` / `tagSession` **[C]**。
- API 的 compaction 是**内容块**而不是 session 操作：响应带 signed `compaction` block，调用方必须回传，API 丢弃它之前的所有内容；`pause_after_compaction` 返回 `stop_reason: "compaction"` **[C]**。
- context editing 是**清除**而不是总结（`clear_tool_uses`、`clear_thinking`）；memory tool 是客户端在 `/memories` 上执行的文件工具 **[C]**。

### 1.4 Anthropic 的公开设计声明

- **context rot**：上下文是有限资源，边际收益递减；目标是「smallest possible set of high-signal tokens」**[C]**。
- 长任务三件套：compaction、structured note-taking（agentic memory）、sub-agent 架构 **[C]**。
- subagent 的本质是「用自己的窗口做压缩」；多 agent 研究系统在内部 eval 上比单 agent 高 90.2%，但 token 约 15×；lead 需要把计划写进 memory，因为 >200K 会被截断 **[C]**。
- 一个反转：Claude Code 当前最佳实践已把「用 subagent 保护上下文」列进「窗口到 1M、压缩自动化后可以不再遵循」的建议 **[C]**。

**Claude 的教训**：

1. frame 暴露是因为 resume 需要一个可选的句柄；topic 拥有名字，frame 拥有 ID。
2. 切换必须 **demote，不 delete**；旧 transcript 永远可寻址。
3. 压缩首先是 **provenance** 问题：哪些内容从磁盘重新注入、哪些按路径懒加载、哪些被总结、哪些丢弃，要按来源声明规则。
4. resume 恢复义务和环境，并**承认未知**（不重放 tool call、未完成工作标注）。

---

## 2. DSH（DeepSeek Harness）

> DSH 是 developer preview（MIT，Cordis microkernel）。以下以官方文档 / master README 为准。

### 2.1 核心模型：session = append-only event log

- 一个 session 就是一条 **append-only typed `SessionEvent` 日志**，是唯一事实源；模型历史是**派生**的，不单独存储 **[C]**。
- 事件：`turn/start|end`、`step/start|end`、`user/message`、`system/message`、`assistant/message`、`tool/call|result`、`request/header`、`request/context` **[C]**。
- `seq = log.length`，连续；未知且不可忽略的事件 fail-closed；session 有 cwd、agentPreset、可选 `parentSession`、`delegationDepth` **[C]**。
- 持久化：JSONL + checksummed Zstandard frames；`append`（best-effort）vs `flush`（durability barrier）；跨进程 **single-writer lease**（`SessionAlreadyOwnedError`）**[C]**。
- 崩溃修复：留下 open turn，resume 时追加 synthetic closers + `turn/end{interrupted}` **[C]**。

### 2.2 边界不是 session，而是 surface

- 只有 `SurfaceEventType` 事件产生消息；每个事件声明 `surfaceOp: 'append'` 或 `{op:'replace', startSeq, endSeq}` **[C]**。
- `deriveMessages()` 折叠 surface；`replace` 从模型历史里删掉被遮蔽的节点，但**原始日志保留** **[C]**。
- `session-query` 把每个事件分类为 `current` / `shadowed` / `log-only` **[C]**。
- 这是调研里最干净的「frame 常驻集 vs backing store」分离。

### 2.3 压缩：遮蔽一段 range，系统提示永不遮蔽

- `dsh-compaction` 能力 seam + `dsh-compaction-basic` provider + `/compact` consumer **[C]**。
- 触发阈值 `floor(min(W×0.8, W−O−65536))`；保留 `W−O` 最新的 16% 原文 **[C]**。
- 用一条带 `<compacted-summary>` 的 `user/message` + `surfaceOp: replace` 替换**最老的平衡 span**；摘要调用逐字节重放 node-0 system prompt + active tools + shadowed messages（warm prefix）**[C]**。
- `compaction/start|summary|end` 是 **log-only** 事件，形成持久锁；崩溃留下可检测的 orphan，不会假装完成；失败分类 `busy/cancelled/changed/summary/commit/persistence` **[C]**。
- shrink validation：摘要没有缩小源内容就拒绝；range 永远从第一个非 `system/message` 节点开始，**node-0 系统提示永不被遮蔽** **[C]**。

### 2.4 Resume / subagent / workspace

- 三个入口：`ctx.agents.resume({resumeSessionId})`、ACP `session/list → session/resume → session/close`、SDK `resume_session(id)` / `run(prompt, session_id)` **[C]**。
- ACP `session/list` 只列 persisted **root** session（cwd 过滤；`origin: subagent` 排除；普通 fork 可列）；resume 恢复日志、重连 MCP 声明，**不 replay 旧 update** **[C]**。
- subagent 两种本地形态：**spawn**（全新 child）与 **fork**（用父的 completed-turn prefix 做 seed，带 `inheritedEventCount` 和 `session/end-seed` 切点）**[C]**。
- **Workspace**：canonical path 之上的稳定 uuid + 标题 + 有序 `sessionIds`；**对模型完全不可见**（无 tool、无 prompt、无 session event）**[C]**。
- 跨 session 引用：`@[label](dsh-session:…)` 把另一个 session 的 surface 快照进一次聚合 recall，带 `capturedThroughSeq`、`compacted`、省略消息/字节数、截断信息 **[C]**。
- DSH **没有内建跨 session memory**；官方建议默认关闭的第三方 MCP memory server **[C]**。

### 2.5 SuperAgent：Router / Worker

> 明确是研究原型（design essay 2026-10-31 + `deepseek-ai/dsh-superagent-prototype`），不是产品。

- **Router**：跟人对话，**只做路由**。
- **Worker**：隔离 session + 目录（常常一 ticket 一 worktree）。
- 流程：Trigger → Thread → Eval → Ticket → Mandate → Assignment → Report。
- 订阅了 thread 的人可以绕过 Router 直接跟进；假设一个人只跟踪 **~3–5 个活跃 session**。
- p95 15.7 vs 29.5 min 是二手、合成数据 **[U]**。

**DSH 的教训**：

1. topic 需要**自己的持久记录**（像 Workspace），不能从「最新 session」推导，否则 fork/压缩会悄悄改写身份。
2. log 是 truth，驱逐是**显式投影编辑**（`surfaceOp: replace`），不是第二份事实源。
3. 跨 frame 传递是 **copy-with-provenance**（fork seed 切点 / session reference 的 `capturedThroughSeq`），不是共享可变上下文。
4. frame 切换/压缩必须是**带括号的事务**（start…end + typed failure），崩溃可检测。
5. 按 **typed origin** 隐藏 frame（subagent 不进导航），只暴露注意力和连续性。

---

## 3. Codex

### 3.1 三层产品，三种词汇

同一个对象在 CLI 叫 **session**，API 叫 **thread**，App/Cloud 叫 **chat/task** **[C]**。

| 维度 | CLI | App / Desktop | Cloud |
|---|---|---|---|
| 工作单元 | session / thread（`thr_…`） | chat + project + section | task（1–4 attempts） |
| 上下文存储 | `$CODEX_HOME/sessions/YYYY/MM/DD/` rollout JSONL、`session_index.jsonl`、sqlite、`archived_sessions/` | 同一本地 store；thread attachments | environment snapshot + per-task VM；diff/PR artifact |
| 边界 | 新启动、`/new`、`/clear`、`/fork`、`codex fork`、`--ephemeral` | new chat、fork、worktree | start new task |
| 恢复 | `codex resume [ID]`、`--last`、`--all`、`--include-non-interactive`；SDK `resumeThread(id)` | 点击 chat；分页 resume picker；Local↔Worktree handoff | 同一 task 在 web/mobile/desktop 重开；`codex apply <TASK_ID>` |
| 压缩 | 接近 ~90% 自动压缩；`/compact [instruction]`；PreCompact/PostCompact hooks | 同引擎 | 服务端，不对用户暴露 |
| 隔离 | sandbox × approval；可选 per-thread worktree | `$CODEX_HOME/worktrees` + `codex-thread.json` | 每 task 全新 VM |

### 3.2 关键事实

- 所有边界在 UI 里都是**用户发起**（`/new`、`/fork`、New chat）；系统只负责反应（自动压缩、自动标题）**[C]**。
- 唯一例外是实验性的 `features.context_management.experimental_mode`：模型可调用 `new_context`，回复字面是「A new context window will start without summarizing conversation history.」——**模型决定的硬切，没有摘要** **[C]**。
- 该实验有真实事故：保存 notes 失败后 `new_context` 仍可能触发，任务状态被丢弃（issue #43194）**[C]**。
- 持久层在 frame 之外：`AGENTS.md`（global→project 链，32 KiB 上限）、`memories_v2/`（空闲 chat 的后台总结）、attachments、git diff **[C]**。
- 会话可丢弃，**repo + memory + notes 是 truth**。
- subagent：child thread，`max_threads=6`、`max_depth=1` 默认；共享 workspace、独立 context，文件冲突需 worktree **[I]**。

### 3.3 已记录的失败模式

- 接近阈值时 context drift，agent 回答上一个问题（#19116 / #17912）**[C]**。
- 超过窗口后无法压缩，直到本地 compaction 上线（#10823）**[C]**。
- 自动压缩阈值按 raw window 而不是 usable window 计算（#40095，94.7%）**[C]**。
- resume 短会话仍触发压缩（#29426）**[C]**。
- 超大图片 payload 导致 thread 死掉、`/compact` 失败 **[C]**。
- `resume --last` 只看当前目录；`exec` session 默认隐藏；换 `CODEX_HOME` 就看不见；归档要 `unarchive`（discussion #1076）**[C]**。

**Codex 的教训**：

1. 分段交给系统，但保留**可检查的边界日志**（为什么切、触发者、父 frame、artifacts），并提供 merge/split。
2. **compaction 和 boundary 是两种操作**：软折叠（summary + carried artifacts）用于漂移；硬切只在有显式、可验证的 handoff note 时使用。
3. 连续性必须活在 frame 之外；frame 只是 durable artifacts 的缓存。
4. **index 就是产品**：标题、section、pin、unread、resume picker、provenance 链回原始 transcript。
5. 把已知失败模式设计掉，而不是写进文档。

---

## 4. 横向对比

| | 用户可见单位 | frame | 连续性存储 | 边界由谁决定 | 恢复 | 压缩 |
|---|---|---|---|---|---|---|
| **Claude Code** | session（picker） | session | JSONL + CLAUDE.md + auto-memory | 用户 `/clear` `/branch` | `--resume` | summary；原文保留但 resume 不重载 |
| **Claude.ai** | chat / project | 隐藏 | 服务端历史 + memory topics | 用户 new chat/project | 重新打开 | 不对用户暴露 |
| **DSH** | session / workspace | session log | append-only log | 用户建 session；surface replace | ACP resume | 遮蔽 range；log 完整保留 |
| **Codex** | chat / task / thread | thread | rollout + AGENTS.md + memories + git | 用户 `/new` `/fork` | `resume` | summary / 实验性硬切 |
| **DSH SuperAgent** | thread / ticket | worker session | ticket / thread / report | Trigger→Ticket | worker resume | 未公开 |

---

## 5. 对 MAFW 的结论

### 5.1 Lead 是控制平面，不是数据平面

- Router 的工作集 = project charter + Goal 表 + Tech Lead 状态 + 待分派队列 + 向人报告。
- 它**不需要 topic / resume**：session 可丢弃，compaction 安全，identity 可从 store 重建。
- DSH SuperAgent 的 Router/Worker 分离直接验证了这一点：Router 只跟人对话和分派，Worker 才有隔离 session 和目录。
- 现状问题：我们把讨论放在 Lead 上，于是 router 的对话被当成工作记忆管理，才出现「新开 session 还是 compaction」的抉择。

### 5.2 数据平面：topic 是持久记录，session 是 frame

- **Topic**（类 DSH Workspace）：稳定 id、project、title、status、成员 sessionIds、open loops、artifacts、parent、createdAt/lastActiveAt。
- **Session**：执行 frame；原始 transcript 是 append-only log；compaction 是 **shadow range**，不是删除。
- **Resume**：激活已有 frame；恢复 obligations + environment；标注未知（不重放 tool call）。
- **Boundary log**：记录切分原因、触发者、父 topic、artifacts；支持 merge / split / undo。
- **Index 是产品**：标题、状态、artifacts、open loops、provenance。

### 5.3 三条硬规则

1. **不删除**：切话题只 demote；raw log 永远是 truth。
2. **压缩是投影**：summary 遮蔽一段 range，原始消息仍可回溯。
3. **恢复承诺，不猜未知**：resume 恢复 goal / permission / model / open loops；未完成工作标注，不重放副作用。

### 5.4 反模式

- 让用户决定边界（Codex）→ 用户猜错，resume 找不到。
- 压缩不可逆（Codex 多个 issue）→ 状态丢失。
- 把 session id 当主 UI（Claude Code）→ 用户被迫管理 frame。
- 词汇过载（session / thread / chat / task）→ 认知负担。
- **Router 持有工作上下文（我们的现状）** → router 被当工作记忆管理。

### 5.5 建议落地顺序

- **P0 · Lead router**：无状态控制平面；状态外置到 Pod/Goal store；讨论从 Lead 移走；不做 topic UI。
- **P1 · 数据平面 topic/frame**：topic 记录 + frame + shadow compaction + resume + boundary log。
- **P2 · 自动边界**：信号 + 边界日志 + merge/split；先观察自由讨论，不急着自动判断。
- **P3 · 跨 topic recall**：topic 索引 + 记忆系统缺页。

---

## 6. 未验证 / 待调研

- Claude.ai 是否有真正的 conversation branch/tree UI（官方文档沉默）**[U]**。
- Codex Cloud VM 状态保留 7 天的说法（第三方）**[U]**。
- DSH SuperAgent 的 p95 数据（二手、合成）**[U]**。
- **自由讨论的自动边界检测**：三家都没有做好；需要实地观察信号（显式措辞、语义漂移、空闲、任务闭合）再定。

## 7. Sources

### Claude
- Claude Code sessions: https://code.claude.com/docs/en/sessions
- Subagents: https://code.claude.com/docs/en/sub-agents
- Checkpointing: https://code.claude.com/docs/en/checkpointing
- Best practices: https://code.claude.com/docs/en/best-practices
- Context window: https://code.claude.com/docs/en/context-window
- Memory: https://code.claude.com/docs/en/memory
- Projects: https://support.claude.com/en/articles/9517075-what-are-projects
- Chat search & memory: https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context
- Agent SDK sessions: https://code.claude.com/docs/en/agent-sdk/sessions
- Compaction threshold: https://platform.claude.com/docs/en/build-with-claude/compaction-threshold
- Compaction on demand: https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand
- Context editing: https://platform.claude.com/docs/en/build-with-claude/context-editing
- Effective context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system

### DSH
- Architecture: https://deepseek-harness.github.io/deepseek-harness/reference/
- Session log: https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session
- Persistence: https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/persistence
- Session query: https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session-query
- Compaction: https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/compaction
- Compaction basic: https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/compaction/compaction-basic/README.md
- Subagents: https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/subagent
- ACP contract: https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/acp/acp/README.md
- Workspaces: https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/workspace.md
- Session reference: https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session-reference
- SuperAgent prototype: https://github.com/deepseek-ai/dsh-superagent-prototype

### Codex
- Developer commands: https://learn.chatgpt.com/docs/developer-commands
- CLI: https://developers.openai.com/codex/cli
- Best practices: https://developers.openai.com/codex/learn/best-practices
- Projects & chats: https://learn.chatgpt.com/docs/projects
- Worktrees & handoff: https://learn.chatgpt.com/docs/environments/git-worktrees
- Codex Cloud: https://learn.chatgpt.com/docs/cloud
- Memories: https://learn.chatgpt.com/docs/customization/memories
- Subagents: https://learn.chatgpt.com/docs/agent-configuration/subagents
- AGENTS.md: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- App Server: https://developers.openai.com/codex/app-server
- Compaction guide: https://developers.openai.com/api/docs/guides/compaction
- Issue #10823: https://github.com/openai/codex/issues/10823
- Issue #19116: https://github.com/openai/codex/issues/19116
- Issue #40095: https://github.com/openai/codex/issues/40095
- Issue #29426: https://github.com/openai/codex/issues/29426
- Issue #43194: https://github.com/openai/codex/issues/43194
- Discussion #1076: https://github.com/openai/codex/discussions/1076
