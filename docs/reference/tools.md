# MAFW Tool 清单

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。

## Tools 清单（2026-11-10：42 个 Gateway MCP 工具 + 14 个插件侧工具）

### Gateway MCP 工具（42 个，`gateway/src/mcp/tool-registry.ts`）

| Tool | 用途 |
|---|---|
| `mafw_search_hybrid` | 谐波记忆检索（BM25×energy×salience 默认；`retriever:'token'` 回退子串计数；支持迭代图扩展） |
| `mafw_get_deltas` | 获取参数化约束（L3） |
| `mafw_update_state` | 更新状态文件 |
| `mafw_load_state` | 读取状态文件 |
| `mafw_ask_user` | 非阻塞向用户提问 |
| `mafw_record_feedback` | 记录用户点赞/点踩 |
| `mafw_get_model_route` | 动态模型选择（基于预算） |
| `mafw_add_memory` | 写入记忆单元（`supersedes` 显式取代旧条目——HTTP 表单串 / MCP 收数组，仅 create 后标记；`pinned` 披露层；`sticky`/`stickyDays` 便签板；`cueAnchors` 多跳线索；`authority` 权威标签） |
| `mafw_get_memory` | 按 id 取记忆全文（支持 `<recall>` 指针尾 6 位；superseded 自动附 supersede 链最新版） |
| `mafw_supersede_memory` | 标记已有记忆为 superseded（不写新条目，仅降能+惩罚检索排序） |
| `mafw_pin_memory` | pin/unpin 披露层（`<user-profile>` 每轮注入）；`sticky`/`stickyDays` 上板/续期/下架便签板 |
| `mafw_commit_heuristic` | 提交 L5 启发式 |
| `mafw_get_axioms` | 获取 L5 公理 |
| `mafw_merge_memory` | ★ 跨 worktree 记忆融合 |
| `mafw_resolve_merge` | 解决记忆融合冲突 |
| `mafw_create_goal` | 创建 Goal（Lead 专用；`handoff` / `sourceRef` / `contextSummary` / `topicId`；`contextSummary` 由 Lead 选择来源上下文，替代自动 current-topic 快照） |
| `mafw_lead_goal_status` | Lead 的 Goal 状态投影（阶段 / 进度 / 阻塞 / 待处理 attention）；只读，不读 Tech Lead 原始 transcript |
| `mafw_pod_goal_direction` | Tech Lead 方向裁定（`clear` / `needs_user` / `decided`；`goalMode` 选 quick/standard） |
| `mafw_pod_goal_context` | Lead 为 Goal 选择上下文（可选文件 / 跨 Goal allowlist） |
| `mafw_pod_review_respond` | Tech Lead 回应人类的评审项（只能标记「已回应」；解决/重开是人类专属） |
| `mafw_decision_draft` | 起草决定记录（仅 draft；确认/搁置/重开由人在 UI 完成，Agent 不能自决） |
| `mafw_set_goal` | 设置活跃 Goal |
| `mafw_get_goal_status` | 查询 Goal 状态 |
| `mafw_list_goals` | 列出 Goal |
| `mafw_get_evidence` | 获取 Goal 证据 |
| `mafw_cancel_goal` | 取消 Goal |
| `mafw_list_pending_questions` | 列出待决问题 |
| `mafw_list_automation_rules` | 列出自动化规则 |
| `mafw_get_automation_rule` | 查询自动化规则 |
| `mafw_get_automation_history` | 自动化历史 |
| `mafw_run_automation` | 手动运行自动化 |
| `mafw_validate_rule` | 校验规则 |
| `mafw_list_triage_items` | 列出 triage 项 |
| `mafw_get_triage_item` | 查询 triage 项 |
| `mafw_propose_triage_decision` | 提议 triage 决策 |
| `mafw_draft_automation_rule` | 起草自动化规则 |
| `mafw_desktop_screenshot` | 桌面截图 |
| `mafw_desktop_navigate` | 桌面导航 |
| `mafw_desktop_get_ui_state` | 桌面 UI 状态 |
| `mafw_desktop_click` | 桌面点击 |
| `mafw_desktop_type` | 桌面输入 |
| `mafw_desktop_scroll` | 桌面滚动 |
| `mafw_restart_agent` | 重启 gateway 拥有的 agent 进程（opencode serve sidecar）；external/进程内 runtime 不可用 |

> **2026-11-13（E7 review）**：`mafw_answer_question` 已从 MCP 删除（human-only；回答只走
> human-token HTTP / UI）。表内计数是 2026-11-10 迁移快照，不再追踪增删。

> **接线要求（2026-09-08 修复）**：以上 42 个工具经 gateway MCP 暴露（`http://127.0.0.1:3000/mcp`），opencode 侧需在配置中有 `"mcp": { "mafw": { "type": "remote", "url": "http://127.0.0.1:3000/mcp", "enabled": true, "oauth": false } }` 才可用。接线有两条路径：①插件**激活时自接线**（`src/utils/self-wiring.ts` 的 `ensureMcpWiring()`——检测全局 `~/.config/opencode/opencode.jsonc` 缺 `"mcp"` 段则幂等补写，带 `.bak-mafw-<ts>` 备份，fail-open）；②手动写全局或项目级 opencode 配置。**排错关键**：旧键 `mcpServers`（v4.1 时代 `opencode.json.example`）已被 opencode 1.x 废弃并**静默忽略**，接线缺失无任何报错、工具直接消失；验证用 `opencode mcp list` 应显示 `mafw connected`。插件原生工具（6 个，§4.2）不经 MCP，独立可用。
>
> **双传输端点（2026-09-09，commit 1fa8c304）**：`/mcp` 同时承载两种传输，客户端按形态自动分流——`POST /mcp`（无 sessionId）→ **无状态 StreamableHTTP**（官方 transport，`sessionIdGenerator: undefined` + `enableJsonResponse`，响应随 POST 内联返回；opencode 客户端优先此路径）；`POST /mcp?sessionId=` → legacy SSE 消息通道；`GET /mcp`（带 `mcp-protocol-version` 头）→ 405（无独立流，StreamableHTTP 客户端视为预期）；`GET /mcp`（无该头）→ legacy SSE 会话建立。**每条 SSE 连接独立 `Server` 实例**（SDK Protocol 单传输，共享会导致响应路由到"最后连接"的客户端——2026-09-09 间歇性 -32001 超时事故根因，回归测试 `gateway/tests/unit/mcp-sse-multi-client.test.ts`）+ 15s `: ping` 心跳（防 ~305s 客户端 idle-abort 重连轮转）+ 会话生命周期日志（`[MCP]` 前缀）。SDK `@modelcontextprotocol/sdk@^1.30`。

### 插件侧工具（14 个，`src/tools/`）

| Tool | 用途 |
|---|---|
| `mafw_media_ask` | 分析/追问图片/视频/音频（经 Media Agent A2A；支持 taskID 多轮追问或 mediaPath 自动上传） |
| `mafw_media_upload` | 上传本地媒体文件到 Media Agent 并返回引用指针 |
| `mafw_media_speak` | 文本合成语音（TTS；带 djb2 hash 标记供桌面端去重播放） |
| `mafw_python` | 持久 Python 内核执行（变量/导入跨调用保持；matplotlib 图表返回图片附件） |
| `mafw_python_restart` | 重启 Python 内核（内核崩溃或内存泄漏时调用） |
| `mafw_add_memory` | 写入记忆单元（HTTP 直连 `/api/memory/add`——serve 派生的 worker 会话无 MCP 连接，故不走 MCP 通道） |
| `mafw_submit_result` | Batch 1：结构化交卷（JSON Schema 校验/重试） |
| `mafw_spawn_subagent` | Batch 3：派生 gateway 追踪的子代理（parentID/depth） |
| `mafw_message_subagent` | Batch 3：给子代理续聊 |
| `mafw_subagent_result` | Batch 3：读取子代理结果（structured 优先） |
| `mafw_task_submit` | Batch 4：提交持久任务（shell 后台命令 / subagent） |
| `mafw_task_list` | Batch 4：列出当前会话的持久任务（五态过滤） |
| `mafw_task_cancel` | Batch 4：取消持久任务（幂等） |
| `mafw_task_message` | Batch 4：给持久子代理任务续聊（terminal 任务会回到 working） |

> **插件 dev loop**：本仓库内 opencode 经 `.opencode/plugins/mafw-plugin.ts` shim 直连 `../../src/plugin`（原生加载 TS，无需 tsc；插件 import 必须按文件相对路径解析——opencode v2.2.5 起 Bun 严格文件相对解析，2026-11-03 修复 `../src/plugin` 只解析到不存在的 `.opencode/src/plugin`、插件加载必败并静默回退全局安装的 bug，server log ref err_0d1a5d0f，回归测试 `tests/plugin-shim-resolution.test.ts`）；改动生效 = `mafw restart-agent`。仓库外项目靠全局 `file:<npm-prefix>/node_modules/@jack200714/mafw` 加载 `dist/plugin.js`（发布后 `npm install -g jack200714-mafw-<ver>.tgz` 更新）。包入口字段：`main` + `opencode.plugin` = `dist/plugin.js`（2026-10-05 修复：此前 tarball 不含 `dist/` 且全局配置指向旧包名路径，仓库外项目冻结在 v4.5.1）。
