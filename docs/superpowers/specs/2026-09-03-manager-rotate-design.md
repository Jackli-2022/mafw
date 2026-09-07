# Manager Rotate-on-Demand + /btw 支线问答 — 设计文档

日期：2026-09-03
状态：已批准（待实现）

## 1. 背景与问题

Manager session 当前是 per-project 单例（`gateway.db` kv_store，`scope='manager-session'`、key=projectDir），一旦创建永久复用（pinned + exemptFromTrim/Evict/Archive）。所有用户↔manager 对话累积在同一 session，话题混在一个上下文里，长期存在上下文污染与 compaction 有损丢失的隐患。

关键前提：manager 的状态权威不在 session 里——goal 状态在 state.json/goal_outcomes，待决问题在 question ledger，长期记忆在谐波记忆系统。session 只是对话载体，换 session 的代价低。

**业界调研结论**（详见附录 A）：主流系统（ChatGPT/Claude/LangGraph）= 显式多会话 + 独立记忆层兜底连续性；Letta 官方立场"何时开新会话是用户偏好，长线程本身不是理由"；学术与工程共识反对自动话题分割硬路由。本设计采用"rotate-on-demand + 记忆兜底"，与业界交集一致。

**代码调研结论**（详见附录 B）：pending question 三条通道全部 session 无关，rotate 安全；真实障碍为桌面端 metadata 残留 fallback、wake-handlers 既有断链、新 session 身份注入需复跑。

## 2. 目标与非目标

**目标：**
- 用户可显式"开新话题"：创建新 manager session 替换 kv 中的活跃 id，旧 session 沉底为普通历史会话
- manager 可通过 MCP 工具在用户要求时触发 rotate
- **manager 常驻目标感知**：每条用户消息携带活跃 goal 快照（每轮刷新，compaction 无损）；goal 阶段跃迁时推送免回复通知
- `/btw` 支线问答原语：一次性 session 回答支线问题，答完即弃
- 修复 rotate 正确性的直接依赖 bug（metadata 降级、handleNewGoal fallback、wake-handlers 断链）

**非目标：**
- 自动话题分割 / agent 主动提议开新话题（业界共识反对硬切；提议式留待后续）
- 多并行话题 thread（模型 C，伪需求）
- 桌面端"历史话题"专用 UI（旧 session 复用现有历史列表）
- /btw 结果自动写入谐波记忆（由 manager 按 memory-guide 自主判断）

## 3. 设计

### 3.1 Gateway —— Rotate API

新增 `POST /api/manager/session/rotate`，请求体 `{ projectDir, reason? }`：

1. 查 kv 当前 sessionId；若无 → 直接走 `ensureManagerSession`（等价初始化），返回新 id
2. **降级旧 session metadata**：把旧 session 的 `role: 'manager'` 改为 `role: 'manager-archived'`，并**移除 pinned / exemptFromTrim / exemptFromEvict / exemptFromArchive 标记**——旧 session 回归普通会话生命周期，可被正常 trim/archive/清理
3. 创建新 opencode session（directory=projectDir）→ kv 替换为新 id → `registerInternalSession(id, 'manager')`
4. **重跑 `MANAGER_IDENTITY_SYSTEM_PROMPT` 注入**（复用 index.ts ~5491 的现有逻辑，抽取为共用函数）
5. kv 结构不变（单值=当前活跃）；历史不单独入 kv——旧 session 存于 opencode session 存储，role 降级后经现有 session 列表逻辑自然出现

**`SdkSessionResource` 新增 `updateMetadata(sessionId, patch)`**：目前只有 create/registerExternal/delete；rotate 需要就地修改已注册 session 的 metadata（落盘 `<mafwDir>/sessions/<id>.json`）。

新增 MCP 工具 `mafw_new_topic { reason? }`：manager 在用户明确要求开新话题时自主调用，复用同一 HTTP handler 逻辑。工具描述注明"仅在用户明确要求时调用，不主动提议"。

### 3.2 既有 bug 修复（纳入本次）

| Bug | 位置 | 修复 |
|---|---|---|
| 三条 `manager-report-*` 自动化规则整体失效（读已删除的 legacy 文件 + `goal.failed`/`goal.awaiting_user` 事件无人 emit + `reportedAt` 无写路径） | `core/manager/wake-handlers.ts`、`system-rule-templates.ts:14-33` | **退役三条死规则**，由 §3.4② 新建的阶段跃迁推送机制替代 |
| 自更新完成通知读已删除的 legacy 文件 | `gateway/src/index.ts:636-640` `notifyUpdateComplete` | 改读 kv：`kvGet('manager-session', projectDir)` |
| handleNewGoal 裸用 role fallback | `opencode-dev/packages/desktop/.../MafwShell.tsx:218-221` | 改为与 `handleOpenManager` 一致：优先权威 `managerSessionId`，fallback 保留但仅在权威 id 缺失时 |

### 3.3 桌面端

- **Manager tab 头部加"新话题"按钮**：`ButtonV2`（项目 UI 约定禁止裸 button），点击 `confirm()` 二次确认 → 调 rotate API → 刷新 manager session 状态 → `ToastV2` 提示成功
- 旧 session 沉底为普通历史会话：**零新 UI**。Rail history 过滤仅排除 `role==='manager'`（Rail.tsx ~104），降级后旧 session 自动出现；WelcomeHome recent 列表同理（其排除条件同为 role==='manager'）
- SDK（`@mafw/sdk`）：`manager` 命名空间新增 `rotate(projectDir, reason?)`

### 3.4 Manager 常驻目标感知（Goal Awareness）

manager 是 goal 的管理者和发起者，其身份不随会话轮换而改变。goal 感知设计为**每轮刷新的常驻机制**，而非 rotate 时的交接补丁——因此对所有 manager session（首次创建或 rotate 后）一致生效，且天然免疫 compaction 丢失。

**① 每轮 goal 快照注入**

- 注入点：复用边界 recall 管道——插件 `messages.transform` 每次 LLM 调用前调 `GET /api/recall/context`；gateway 识别"该 session 是其项目的活跃 manager session"（internal-session 注册表 + kv 比对）后，在 recall 块尾部追加 `<goal-snapshot>`
- 内容：从 goal state **确定性聚合**（无 LLM），仅活跃 goal，字段：goalId、标题、阶段（planning/executing/review）、轮次、pending question 数、最近进展时间
- 预算：≤10 条 goal / ~500 字符，超出按最近进展时间截断
- 位置：消息尾部，不破坏前缀缓存；快照随 goal 进展变化属预期（变化本身携带信息）
- 仅 manager session 生效；非 manager session 的 recall 路径不变
- 非活跃 manager（已被 rotate 替换的旧 session）不再收到快照——kv 比对自然保证

**② goal 阶段跃迁 → 免回复推送**

代码调研确认：现有 wake 链路整体失效（`goal.failed`/`goal.awaiting_user` 事件无人 emit、`reportedAt` 无写路径、`resolveManagerSession` 读已删除的 legacy 文件），本机制为**新建**，旧三条 `manager-report-*` 自动化规则退役。

- **事件源**（不侵入 langgraph 节点）：
  - plan 完成进入执行、review 出 verdict、提问：`eventBus.on("phase_transition")`（`syncToFile` 包装层 index.ts:5154 已统一 emit，载荷含 goalId/phase/loop/projectDir）；review verdict 需扩展载荷带 `reviewVerdict`（或监听时读 state 文件）
  - completed / failed / cancelled：挂 `archiveGoal()`（index.ts:4773）——所有终结路径（图终点×3 + ABORT×2）的唯一汇合点，天然只执行一次
  - 执行中的每个 round **不推**（噪音与成本控制）
- **幂等**：langgraph 节点副作用在 checkpoint 落盘前，崩溃恢复会重放事件——持久化去重键 `milestone-notified/{goalId}:{phase}:{stateVersion}` 到 gateway.db kv_store（stateVersion 读 goal state 文件；不用进程内 Set）
- **风暴控制**：per-project 合并队列——同项目短时间多里程碑合并为一条消息注入；参照 StepInject 的 idle drain 模式
- **推送方式**：`promptAsync(noReply: true)` **硬免回复**——消息只落 manager session 历史、不触发 LLM 运行，零成本；opencode 已支持（线上二进制实证）且 gateway 链路全程透传，本机制首次启用该能力。manager 经下一轮 goal 快照 + 会话历史自然知晓
- **已知限制**：pi runtime 的 busy 分支（followUp）会丢 noReply 语义（`pi-session.ts:66-68`）——接受并在文档注明，后续按需修
- **manager session 定位**：`kvGet('manager-session', projectDir)`（载荷自带 projectDir，天然支持多项目路由）
- **busy 安全**：opencode promptAsync 对 busy session 为 steer 语义（排队下轮拾取，不打断不拒绝；线上 1.17.9 反编译实证），`promptWhileBusy` 为 Tier 0 基线能力
- 推送失败 fail-open：记 warn 日志，不影响 goal 流程

### 3.5 /btw 支线问答

新增 MCP 工具 `mafw_btw { question }`：

1. spawn 一次性 opencode session（同 projectDir），注入精简身份 prompt + question
2. prompt 一次拿回答
3. **session 即弃**：不注册 sdkSession metadata、不进任何列表；仅 `registerInternalSession(id, 'btw')` 使其输出不回流 T1（内部会话白名单机制天然覆盖）
4. 答案作为 tool result 返回 manager（自然进入 manager 上下文）
5. **是否写入谐波记忆由 manager 按 memory-guide 自主判断**（复用现有主动引导，不加自动写入逻辑）

精简身份 prompt 内容：manager 身份简述 + "这是一次性支线问答，回答简洁，不涉及主线 goal 编排"。

### 3.6 数据流总览

```
桌面"新话题"按钮 / mafw_new_topic
  → POST /api/manager/session/rotate
    → 旧 session: updateMetadata(role→manager-archived, 去 pinned/exempt)
    → 新 session: create + kv 替换 + registerInternalSession + 身份注入
    → 旧 session 经现有列表逻辑自动出现在 Rail 历史

每次 LLM 调用（manager session）
  → 插件 messages.transform → GET /api/recall/context
    → gateway 识别 manager session → recall 块尾部追加 <goal-snapshot>

goal 阶段跃迁（plan→executing / review verdict / 提问）
  → eventBus "phase_transition" 监听；completed/failed/cancelled → archiveGoal() hook
  → 持久化去重（goalId:phase:stateVersion）→ per-project 合并队列
  → promptAsync(noReply: true) 落 manager session 历史（不触发 LLM）
  → manager 经下一轮 goal 快照 + 历史自然知晓

manager 遇支线问题 → mafw_btw(question)
  → spawn 一次性 session → prompt → 回答返回 manager
  → session 即弃（internal，不回流 T1）
  → manager 自主决定是否 mafw_add_memory
```

## 4. 错误处理

- rotate 时旧 metadata 降级失败：warn 日志，**继续** rotate（旧 session 残留 role 只影响桌面 fallback，已由 handleNewGoal 修复兜底）
- 新 session 创建失败：kv 不动，旧 session 保持活跃，返回 500 + 错误信息
- /btw session 创建/prompt 失败：显式错误文本返回 manager，不抛异常不崩会话；无重试
- goal 快照聚合失败：fail-open，该轮不附加快照（recall 路径保持原有 fail-open 语义），记 warn 日志
- 阶段跃迁推送失败：fail-open，记 warn 日志，不影响 goal 流程
- rotate 并发：复用 `managerSessionInflight` join 模式，rotate 与 ensureManagerSession 互斥（rotate 持锁期间 ensure 等待）

## 5. 测试

**单测：**
- rotate handler（deps 注入）：无旧 session（等价初始化）/ metadata 降级字段正确 / 身份注入复跑 / kv 替换原子性
- `SdkSessionResource.updateMetadata`：patch 合并 + 落盘
- wake-handlers 退役 + notifyUpdateComplete 改读 kv 后能解析到 sessionId
- goal 快照注入：manager session 的 recall 响应含 `<goal-snapshot>` / 非 manager session 不含 / 旧（已替换）manager session 不含 / 超预算截断 / 聚合失败 fail-open
- 阶段跃迁推送：phase_transition 监听覆盖 plan→executing/review verdict/提问；archiveGoal hook 覆盖 completed/failed/cancelled；执行 round 不触发；去重键持久化（同键不重复推送，含崩溃重放场景）；多里程碑合并为一条；`noReply: true` 语义（消息落历史且不触发 LLM 运行）
- `mafw_btw`：一次性 session 创建 + 回答返回 + session 不残留 metadata

**集成：**
- rotate 后 `GET /api/manager/session?projectDir=` 返回新 id
- 旧 session 以普通身份出现在 session 列表（无 role=manager 标记）
- `mafw_btw` 端到端（mock runtime）

**桌面：**
- handleNewGoal 使用权威 managerSessionId 的回归（如桌面端有测试基建；无则人工验证）

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 用户 rotate 后想找旧话题细节 | 谐波记忆 `mafw_search_hybrid` 检索 + 旧 session 在历史列表可回看 |
| 频繁 rotate 导致历史 session 膨胀 | 旧 session 已回归普通生命周期，被正常 trim/archive |
| manager 滥用 mafw_new_topic | 工具描述限定"仅在用户明确要求时调用" |
| /btw 支线 session 产生成本 | 一次性短 prompt；不持久化；可按需后续加频率限制 |
| langgraph 崩溃恢复重放事件导致重复推送 | 持久化去重键 `goalId:phase:stateVersion`（gateway.db） |
| 多 goal 并发跃迁轰炸 manager 历史 | per-project 合并队列 + 硬 noReply 零 LLM 成本 |
| pi runtime busy 分支丢 noReply 语义 | 已知限制，文档注明，后续按需修 |

## 附录 A：业界调研摘要

| 系统 | 模式 | 启示 |
|---|---|---|
| ChatGPT | 多 chat + Project + 全局/project memory | 开新对话成本由记忆层压到近零 |
| Claude | 多 chat + project 独立记忆 + chat search 带出处 | 记忆随聊随存；检索带引用 |
| Letta/MemGPT | one agent many conversations + MemFS | "何时开新是用户偏好"；`/btw`、`/fork` 原语 |
| LangGraph | checkpointer（thread 内）+ store（跨 thread） | session=短期、记忆=长期的双层背书 |
| Copilot/Cursor | 纯多会话无记忆 | 公认缺陷，非设计优点 |

共识：会话边界交给用户显式动作，连续性由独立记忆层保证；反对自动话题分割硬路由。

## 附录 B：代码调研要点

- pending question 三条通道（user-questions 文件、langgraph checkpoint thread_id=goalId、question-ledger）均无 sessionId 字段，rotate 后照常可见可答
- goal 编排的 plan/execute/review 为每 goal 独立 session，与 manager session 零耦合
- `GET /api/manager/session` 形状天然兼容 rotate（kv 单值替换）
- 旧 session 的 internal-session 注册保留无副作用（输出永不回流 T1 仍成立）
- 桌面端 `GET /api/approvals` 轮询 session 无关
- 附带发现：`POST /api/approvals/{id}/respond` 为空桩（index.ts:3459-3464，返回 ok 不落盘）——既有问题，与本次无关，另行处理
