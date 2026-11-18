# 记忆回执 / 过程时间线 / 用户元信息 — 设计

- **日期**：2026-11-18
- **状态**：待人类确认（视觉已迭代到 v11，交互方向已定）
- **范围**：桌面聊天流 + gateway recall 回执 + 每轮用户上下文
- **非范围**：检索/排序算法、memory 存储结构、Tech Lead 迁移、移动端专属布局

---

## 1. 背景与意图

### 1.1 为什么做

三件事同时缺失，导致聊天“像工具，不像一个记得你的人”：

1. **recall 不可见**：边界 recall 每轮都在跑，但 `<recall>` 块只存在于模型请求的 `output.messages` 里。桌面 `/api/sessions/:id/messages` 只返回原始用户文本，synthetic part 不落库、也不发 SSE。用户看不到“它想起了什么”，也无法纠正。
2. **过程淹没正文**：一轮里 5 次 `read` / `grep` 就是 5 张带边框的工具卡，答案被推到下面；思考、搜索、阅读、输出没有一条连续的时间线。
3. **模型不知道“今天/这里”**：不注入日期时，“今天发布了什么”会被理解成训练/缓存里的某一天，搜索直接跑偏。

### 1.2 目标

- 让记忆**可见、可展开、可纠正**，但默认不打断阅读。
- 把只读的查资料动作收进**过程时间线**，写操作与审批仍然保留卡片。
- 给模型每轮一份**最小上下文**（日期、时区、语言；城市可选），并让用户看得见、改得了。
- 折叠是**无损**的：任何输出、工具入参/输出、失败原因都可以展开看到。

### 1.3 成功标准

- 一轮带 recall 的回答下方出现回执药丸；hover 300ms 能看到记忆与摘要；原文不可用时降级为纯摘要，不出现死链。
- 刷新/重开会话后，历史回执仍在（持久化）。
- 5 次只读工具从 5 张卡变成 1–2 条过程段；正文里的中间输出与最终输出一段不少。
- 用户元信息 chip 显示正确的星期/时间/城市/语言；“今天”类问题不再跑偏。
- recall 边界路径 p100 仍在 100ms 内；回执生成/持久化不进入热路径。

---

## 2. 目标 / 非目标 / 反目标

### 2.1 目标

- 记忆回执：药丸 + hover 卡 + 历史回填 + 摘要降级。
- 过程时间线：按“过程段”折叠；输出永远可见；工具详情二级展开。
- 用户元信息：composer chip + popover + 每轮隐藏注入。

### 2.2 非目标

- 不做 memory citation（不让模型在正文里写 `[mem:...]`）。
- 不做 note-board 进入回执（v1 只做记忆 + T1 摘要）。
- 不做事件溯源式的回执；回执是展示快照，不是事实源。
- 不改 recall 的检索、排序、FOK、neighbor 逻辑。
- 不改 `goal_state` / `domain_events` / Tech Lead。
- 不做移动端专属 bottom sheet；先复用现有响应式布局。

### 2.3 反目标

- 折叠时隐藏中间输出。
- 把记忆同时放进时间线和回执，造成重复。
- 在主动线显示 `semantic` / `procedural` / `E:7.3` / `#mem-xxxxxx`。
- hover 时实时请求原文；原文拿不到就空白或报错。
- 为了“像在回忆”伪造延迟。
- 把 `latest-reminder` 写成一条可见的聊天消息。

---

## 3. 已定决策

### 3.1 记忆回执（人类已确认）

- **位置**：回答下方，药丸（A）。
- **形状**：对齐 `.mafw-pending-pill`：`height 28px`、`border-radius 999px`、`background var(--bg-float)`、`border 1px var(--border-subtle)`、`font-size 12px`。
- **内容密度**：选择“记忆 + 摘要”（v6 的 2 号），不显示便签。
- **药丸文案**：`想起了 N 件事` + 分隔线 + `M 段摘要`；没有 T1 时只显示前半段。
- **展开**：hover / focus 300ms 打开卡片；卡片分组“记忆 / 摘要”；类型标签 **v1 只用类型**：`semantic → 事实`、`procedural → 做法`、`global → 通用`、`episodic → 往事`（legacy）；更细的“偏好 / 约定 / 教训”等记忆系统新增 subtype 后再做（见 §14）。
- **摘要优先**：回执是快照，摘要随回执持久化；原文只是可选链接。
- **降级**：
  - 原文可取：`打开原对话 →`
  - 原文不可用：`原文已不可用`（灰，无链接）
  - v1 **不显示**“已被更新 · 查看新版”：recall 检索已过滤 superseded，回执生成时不会遇到；快照也不会事后获得该状态（见 §13）。
- **不显示**：raw id、energy、type enum、内部字段。
- **纠正入口**：卡片底部 `记错了？` → 打开记忆编辑（v1 先跳到 Memory 页对应条目；行内编辑可后置）。

### 3.2 过程时间线（人类已确认）

- **替代范围**：`reasoning`、`read`、`list`、`glob`、`grep`、`websearch`、`webfetch`。
- **保留卡片**：`edit`、`write`、`apply_patch`、`bash`、`question`、`task`、审批 / diff / 权限。
- **折叠单位**：过程段，不是整轮。一个过程段 = 连续的一段“思考 + 只读工具”，后面跟着它的输出。
- **输出永远可见**：中间输出与最终输出同一套排版，不加“中间 / 输出 / 回答”标签。
- **序列**：`[已思考 5s · 工具 3]` → 输出 1 → `[已思考 2s · 工具 1]` → 输出 2。
- **默认状态**：生成中当前段展开，之前段自动折叠；完成后全部折叠。手动展开优先，直到本轮结束。
- **三级展开**：
  1. 段头一行（用时 + 工具次数）
  2. 段体（思考 + 工具行）
  3. 单个工具详情（入参 / 结果 / 完整输出 / 错误）
- **无损**：折叠只改可见性，不删 part、不截断数据；大输出在渲染层做“展开全部”/虚拟化，数据层保留全量。
- **记忆不进时间线**：回执属于整轮，固定在回答末尾。

### 3.3 用户元信息（A 已确认）

- **位置**：composer 上方一行 ghost（A）；不是胶囊、不是消息。B（回合头部）与 C（仅设置）不进入 v1。
- **内容**：`◐ 周三 14:32 · 上海`；未设置城市时 `◐ 周三 14:32`。语言只显示在 popover 里；不显示“随消息发送”。
- **交互**：10.5px、无边框；hover 才出现淡底和 `›`；点击打开 popover。
- **Popover**：
  - 时间：系统时间，自动，只读。
  - 地点：手动输入城市；默认关闭；只发城市名，不发坐标。
  - 语言：跟随界面语言，只读。
- **注入**：每轮发送时附带一条 `synthetic: true` 的隐藏 text part：
  `<latest-reminder>2026-11-18 周三 14:32 · Asia/Shanghai · 上海 · 中文</latest-reminder>`
- **展示**：`stripInjectedUserText` 增加对 `<latest-reminder>` 的剥离；聊天流里永远看不到这条。
- **默认**：时间 + 时区 + 语言开启；城市关闭。
- **不写入记忆**：这是一轮上下文，不是事实。

---

## 4. 数据与架构

### 4.1 回执数据流（关键）

现状（已实测）：

```
opencode host hook (`src/hooks/session-recall.ts`)
  → GET /api/recall/context?sessionID&query
  → 拿到 pointers 字符串
  → 追加到 output.messages 的最后一条 user message（synthetic: true）
  → 只存在于模型请求；不落库；不发 SSE
```

因此**不能靠前端解析消息**。正确路径：

```
/api/recall/context
  → 已有 memories / fokStatus / neighbors / topicState / snapshot.t1Hits / noteBoard / goalSnap
  → 纯函数 buildMemoryReceipt(...) 生成结构化回执（同步、无 I/O）
  → res.end(pointers) 成功后：
      setImmediate:
        - upsert memory_receipts(session_id, anchor_key, payload)
        - broadcast { type: 'memory.recalled', sessionID, properties: { anchorKey, receipt } }
```

**100ms 契约**：

- `buildMemoryReceipt` 必须是纯同步函数，不读 DB、不调用 `getMemory`、不请求原文。
- 持久化与广播都在 `res.end` 之后；失败只记日志，不影响响应。
- 如果客户端在 100ms 时 abort，`res` 未正常结束 → **不发送回执**。模型没看到 recall，UI 不能声称“想起了”。
- 持久化失败不回滚、不重试到热路径；最多丢一条回执。

### 4.2 回执 payload

```ts
type MemoryReceiptStatus = 'inject' | 'low-confidence' | 'no-memory'

interface MemoryReceipt {
  version: 1
  status: MemoryReceiptStatus
  tookMs: number
  /** 第一次 recall 的时间；同一轮多次 recall 取最早。 */
  createdAt: string
  /** 最后一次 recall 的时间。 */
  updatedAt: string
  topic: { title: string; hasRelated: boolean } | null
  memories: Array<{
    id: string
    type: 'semantic' | 'procedural' | 'global' | 'episodic'
    abstraction: string        // primary_abstraction / memory_value 的短摘要
    date: string | null        // created_at
    energy?: number            // 只用于排序/调试，不在主动线显示
    pinned?: boolean
    available: boolean         // 当前索引里还能取到
    /** R6 `↳` 邻居：只作为锚点行的补充，不计入“想起了 N 件事”。 */
    neighborOf?: string | null
  }>
  t1: Array<{
    traceId: string | null
    excerpt: string            // 召回时拿到的摘要，原样存储
    available: boolean         // 当时能定位到 trace
    sessionId?: string
    turnId?: number
    /** T1 行的来源；用于过滤工具输出 / 子代理提示词。 */
    source?: 'user' | 'assistant' | 'tool' | 'system' | 'unknown'
  }>
  /** 被过滤掉的非对话 T1 数量（工具输出 / 子代理提示词等），用于透明展示。 */
  filteredT1?: number
  counts: { memories: number; t1: number }
}
```

约束：

- 最多 5 条记忆、5 条 T1（与 recall block 的预算一致）。
- **T1 资格**：只展示 `source` 为 `user` / `assistant` 且像自然语言的摘要。`tool` / `system` / 子代理提示词（如 `You are a subagent...`）/ 含 `<path>`、`[object Object]`、`ok | packages\...` 的行一律过滤；过滤数量记入 `filteredT1`。
- `abstraction` / `excerpt` 已经过 recall 的截断/清洗；不超过 240 字符。
- 不包含 `memory_value` 全文、不包含工具输出、不包含 `#mem-` 指针。
- `available` 是**快照时**的判断；之后原文被清理时，点击链接可能 404，前端 toast “原文已不可用”，不回写回执。
- **发送规则**：只有 `memories.length + t1.length > 0` 才发回执。0/0 且模型没有收到明确的 `no-memory` 块时，不发，避免每轮都出现“想起了 0 件事”。
- **状态语义**：`status` 是回执内容状态，不是原始 FOK 值。
  - `inject`：有内容，且 FOK 未判定为低置信。
  - `low-confidence`：有内容，且 FOK 明确为低置信。
  - `no-memory`：0 内容，且这次 recall 确实渲染了 `status="no-reliable-memory"` 块（模型看到了这句话）。
  - FOK 关闭时只会出现 `inject`；不要伪造另外两态。

### 4.3 合并规则（同一轮多次 recall）

同一个 `(session_id, anchor_key)` 可能被调用多次（agentic loop 的每个 LLM step）。合并：

- `memories` 按 id 去重，保留首次出现的顺序。
- `t1` 按 `traceId` 去重；无 traceId 时按 `sessionId:turnId:excerpt` 去重。
- `status`：合并后有内容时，只有全部来源都是 `low-confidence` 才保持 `low-confidence`，否则 `inject`；**有内容永远不会是 `no-memory`**。合并后 0 内容时，只有来源里出现过 `no-memory` 才发 `no-memory`，否则不发。
- `createdAt` 取最早，`updatedAt` 取最新，`tookMs` 取最大。
- 持久化 upsert 合并后的 payload；SSE 发合并后的完整 receipt（不是 delta），桌面幂等替换。

### 4.4 持久化

新表（gateway DB，additive migration）：

```sql
CREATE TABLE IF NOT EXISTS memory_receipts (
  session_id TEXT NOT NULL,
  anchor_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, anchor_key)
);
CREATE INDEX IF NOT EXISTS idx_memory_receipts_session
  ON memory_receipts(session_id, updated_at DESC);
```

- **写入**：`INSERT ... ON CONFLICT DO UPDATE`，合并逻辑在 TS 层做，SQL 只存 JSON。
- **保留**：每会话最多 200 条；写入后按 `updated_at` 删除超出部分。不做全局 TTL（避免历史突然消失）。
- **读取**：`GET /api/sessions/:id/memory-receipts?before=&limit=` → `{ items: [{ anchorKey, receipt }] }`。
- **SDK**：新增 `sessions.memoryReceipts(id, opts)`；不塞进 `MafwMessage`，避免改 flat 契约。

### 4.4.1 快照路径的结构化数据（builder check 发现）

现状：`RecallSnapshot = { query, block, ids, builtAt, fokStatus, top1prob, t1Hits, episodes? }`，没有结构化 memories；`ids` 只有 topK=3，而 block 最多 5 条。快照路径跳过 `searchRecallMemories`，因此 `buildMemoryReceipt` 拿不到 `memories`，只能解析字符串——违反本设计的硬约束。

决议：

- 扩展 `RecallSnapshot`，additive 增加 `memories?: ReceiptMemory[]` 与 `t1Rendered?: boolean`；旧 kv 快照缺字段时降级为“无结构化数据 → 不生成回执”，不解析 block。
- 快照构建时把实际渲染进 block 的记忆摘要（≤5）写入 `memories`；`ids` 保留原语义。
- `t1Hits` 只在 block 真的渲染了 `[t1|...]` 时写入回执（episodes 分支可能取代 T1 行）；用 `t1Rendered` 明确标记。
- live 路径直接用 `memories` / `neighbors` / `fokStatus`；T1 仍只在快照路径出现。

### 4.5 SSE 事件

```ts
{
  type: 'memory.recalled',
  sessionID: string,
  properties: {
    anchorKey: string,
    receipt: MemoryReceipt
  }
}
```

- 桌面 `sse/handlers/memory-recall.ts`：按 `anchorKey` 存 `receiptByAnchor`，幂等替换。
- 会话打开/切换时：调用 `sessions.memoryReceipts` 回填；SSE 只负责实时增量。
- SSE 重连：回填是兜底；事件重复到达不会重复渲染（按 anchor + updatedAt 去重）。

### 4.6 锚点（主方案：隐藏 turn part）

Builder check 发现：桌面发送用本地 `user-<ts>`，runtime 真实 user message id 在 live 不一定拿得到。为了让 live 和 reload 都能挂上，主方案不依赖真实 id：

1. 桌面每次发送带一条 synthetic text part：`[[turn:<uuid>]]`（与 `voiceOrigin` 同一条通路）。
2. `src/hooks/session-recall.ts` 从最后一条真实 user message 的 parts 里提取这个 marker，作为 `anchorKey` 传给 gateway。
3. 回执按 `(session_id, anchor_key)` 存；桌面从同一条 user message 的 parts 里读同一个 marker，挂到对应回合。
4. marker 对用户不可见：`stripInjectedUserText` 增加 `[[turn:...]]` 剥离；模型看到也无害。

Spike 验证（Phase 0）：marker 是否随 parts 进入 `output.messages`、是否持久化到历史、reload 后是否还在。任一项失败 → 回退到“send 返回 `turnID`”方案；`anchorKey` 抽象不变。

- 如果 `lastUser` 不存在（assistant continuation / 无 user）或没有 marker → 不生成回执。
- 找不到锚点（历史裁剪 / 旧客户端）→ 回执丢弃，不猜“最近一轮”。

### 4.7 时间线数据模型

纯函数（`packages/session-ui/src/components/turn-transcript.ts`）：

```ts
type TurnEntry =
  | { key: string; type: 'segment'; process: ProcessStep[]; output: TextPart[] }
  | { key: string; type: 'card'; part: ToolPart }     // edit/write/bash/question/task...
  | { key: string; type: 'data'; part: MafwPart }     // 现有 data part 原样

type ProcessStep =
  | { key: string; type: 'thinking'; parts: ReasoningPart[] }
  | { key: string; type: 'tool'; part: ToolPart; tool: 'read'|'list'|'glob'|'grep'|'websearch'|'webfetch' }

function splitTurn(parts: MafwPart[], opts: { showReasoning: boolean }): TurnEntry[]
```

规则：

1. 遍历一个 turn 内所有 assistant message 的 parts（跨消息保持顺序）。
2. `reasoning` → 当前 segment 的 process step；相邻 reasoning 合并。
3. 只读工具 → 当前 segment 的 process step；相邻同类可合并（与现 `ContextToolGroup` 的语义一致）。
4. `text` → 当前 segment 的 output；如果当前没有 segment，创建一个只有 output 的 segment。
5. 写操作 / 审批 / 交互工具 → 结束当前 segment，产出一个 `card` entry；之后的 process 开新 segment。
6. data part / file part / 其他 → 结束当前 segment，产出 `data` entry。
7. 空 segment（无 process 且无 output）丢弃。
8. `showReasoning === false` 时跳过 thinking step；不影响 output/工具。

**最终输出**：最后一个 segment 的最后一段 output；不特殊标记。折叠时只隐藏 process，不隐藏任何 output。

### 4.8 用户元信息注入

- 桌面设置：`localStorage['mafw-context-prefs']`（时间自动、city 可选、language 跟随 i18n）。
- `use-send-message` 的所有发送路径（普通、排队、steer、重试）统一加一个 `composeLatestReminderPart()`。
- part 形状：
  ```ts
  { type: 'text', id: `prt_ctx_${ts}`, synthetic: true, text: '<latest-reminder>...</latest-reminder>' }
  ```
- `stripInjectedUserText` 增加 `LATEST_REMINDER` 正则，确保历史/实时都不显示。
- 不新增 gateway 路由；不需要 host plugin 读配置。
- 语言用 `i18n.locale()`；时区用 `Intl.DateTimeFormat().resolvedOptions().timeZone`；城市为空则省略。
- 时间格式：`YYYY-MM-DD 周X HH:mm`（本地时区），避免模型把“今天”理解错。

---

## 5. 交互与视觉

### 5.1 记忆回执

- 药丸在回答下方 12px，左对齐正文；hover/focus 打开卡片；点击空白处/Esc 关闭。
- 卡片宽 420px，`--r-xl` 12px，`--shadow-float`；分组标题带小圆点（记忆=accent，摘要=violet）。
- 类型标签用圆角 pill，颜色只做语义：
  - 偏好 = accent
  - 约定 = green
  - 教训 = amber
  - 摘要 = violet
- `no-memory` 状态：灰点 + “没找到相关记忆”，仍然可展开（显示主题/无结果说明）。
- `low-confidence`：黄点 + “有点印象，但不确定”。
- **T1 分组**只展示过滤后的 `user/assistant` 原话；`filteredT1 > 0` 时在分组底部显示一行灰字“已过滤 N 段工具/子代理输出”，不展开原始内容。
- 键盘：Tab 聚焦药丸，Enter/Space 打开，Esc 关闭；卡片内链接可 Tab。
- 移动端：药丸换行不溢出；卡片改为底部浮层（后置，不阻塞 v1）。

### 5.2 过程时间线

- 段头 28–30px；`✓ 已思考（用时 N 秒）· 工具 M 次`；chevron 右侧。
- **用时来源**：live 用段内首个/最后一个 part 的到达时间（客户端观测）；历史回放时 reasoning/text part 没有 time，退化为整条 message 的 `time.created/completed`，仍拿不到就省略“用时”。v1 不改 adapter 事件。
- 段体：左侧 1px 竖线 + 5px 圆点；思考小一号低对比；工具行 29px。
- 工具行：图标 + 人话动词 + 路径/查询 + 状态；点击展开详情。
- 详情：入参、结果、错误、完整输出；大输出“展开全部”。
- 失败：行内 warning 图标 + 人话（“读取失败”“搜索暂不可用”）；详情保留原始错误。
- 生成中：当前段段头 shimmer；新段开始时上一段自动折叠。
- 完成后：全部折叠；点击任一段展开。
- 不出现：工具 JSON、原始参数对象、模型内部字段。

### 5.3 用户元信息

- chip 高 26px，胶囊；`--bg-float` / `--border-subtle`；时间用 tabular-nums，避免跳动。
- 每分钟更新一次时间；不因更新改变宽度（固定位数）。
- popover 320px，三行（时间/地点/语言）+ 说明；地点输入用现有 `TextInputV2`，保存后下一轮生效。
- 关闭城市：只发时区 + 语言；chip 隐藏城市段。
- 不出现“定位”“坐标”“IP”字样。

---

## 6. 边界与失败姿态

- recall 超时/abort：不生成回执；不显示“想起了”。
- 回执 payload 过大：最多 5 + 5，单条 ≤240 字符；超出丢弃尾部。
- DB 写失败：日志 warn；不重试到热路径；下次 recall 会覆盖/合并。
- SSE 丢失：会话打开时用 GET 回填；实时事件只是加速。
- 历史消息被裁剪：锚点找不到 → 回执不显示，不猜。
- 时间线 part 缺失/未知：按现有 renderable 规则降级为普通 part，不丢消息。
- 大工具输出：数据全量保留；渲染默认折叠 + “展开全部”；超过 2000 行用虚拟化/分页。
- 主题：只用现有 token；不在组件里硬编码颜色。
- 移动端：先保证不溢出；底部浮层后置。

---

## 7. 测试策略（TDD）

### 7.1 gateway

- `buildMemoryReceipt` 纯函数：
  - inject / low-confidence / no-memory 三态
  - 记忆 + T1 去重、上限、排序
  - 不含 `memory_value` 全文、不含 `#mem-`
  - `available` 标记；邻居 `neighborOf` 不计入 counts
  - 0/0 不发；有内容时永远不会是 `no-memory`
- 快照路径：
  - 结构化 `memories` 缺失（旧快照）→ 不生成回执，不解析 block
  - `t1Rendered=false` 时即使有 `t1Hits` 也不进回执
- T1 过滤：
  - `source=user/assistant` 的“元信息怎么展示”保留
  - `source=tool` 的 `ok | packages\desktop...Select-String...` 丢弃
  - `source=system` 的 `You are a subagent spawned...` 丢弃
  - `filteredT1` 计数正确；过滤后为 0 时不显示“原话”分组
- 路由：
  - `res.end` 之后才 emit（fake broadcaster 断言顺序）
  - 客户端 abort 时不 emit
  - 100ms 内不 await DB（fake DB 延迟，断言响应不等）
- 锚点：
  - `anchorKey` 透传；缺失时不生成
  - spike 结论落地后补 live/reload 两条用例
- 持久化：
  - upsert 合并、每会话 200 条裁剪
  - GET 分页/排序
- SSE payload 契约（schema / snapshot）。

### 7.2 desktop

- `memory-receipt-model`：类型→人话（前缀启发式 + 类型兜底）、相对时间、三态文案、降级链接。
- `sse/handlers/memory-recall`：按 anchor 幂等替换；乱序/重复事件。
- `MemoryReceipt` 组件：药丸/卡片渲染、键盘、无 raw id。
- 历史回填：GET → store → 渲染；找不到锚点丢弃。
- 用户元信息：
  - `composeLatestReminderPart` 城市开/关、语言、时区
  - 所有发送路径都带 part
  - `stripInjectedUserText` 剥离
  - chip 时间格式/宽度稳定

### 7.3 session-ui

- `splitTurn` fixtures：
  - 思考→工具→输出→思考→工具→输出
  - 只有输出（无时间线）
  - 只有过程（无输出）
  - 工具后输出、输出后工具
  - 写操作卡片打断 segment
  - 大输出不截断（数据层）
  - `showReasoning=false`
- 渲染：
  - 折叠只隐藏 process，output 数量/顺序不变
  - 段头用时/工具次数；live 用观测时长，history 用 message time 或省略
  - 工具详情展开
  - 与 `renderAfterPart` / flow-card 锚定兼容

### 7.4 手工验收

- 真机一轮带 recall 的对话：药丸出现、hover 三条、点击跳 Memory。
- 刷新后回执仍在。
- 一轮 5 次 read/grep：折叠后正文不被推走；展开后入参/输出都在。
- “今天 DeepSeek 发布了什么”不再答错日期。
- 暗/亮/第三主题各看一次。

---

## 8. 发布 / 回滚

- 新增表 additive；无破坏性 migration。
- 建议 kill switch：
  - `MAFW_MEMORY_RECEIPT=0` 关闭回执（不 emit、不渲染）。
  - `MAFW_PROCESS_TIMELINE=0` 回退到现有工具卡渲染。
  - `MAFW_LATEST_REMINDER=0` 不注入元信息。
- 回滚代码不删表；表可以留着，后续版本再清。
- 先本机 main 验证，不 push/merge（遵循仓库约定）。

---

## 9. 风险

1. **100ms 契约**：任何同步 DB/IO 都会破坏边界 recall。回执必须纯同步构建 + 响应后异步落库。
2. **SSE 与历史不一致**：实时事件与 GET 回填可能重复/乱序；必须按 `(anchor, updatedAt)` 幂等。
3. **时间线重构触碰 flow-card / 权限内联**：`renderAfterPart` 依赖顶层 part 顺序；segment 化后要保证权限卡仍锚在发起它的工具后。
4. **大输出 DOM**：全量保留 + 默认折叠；展开时限制初始渲染行数。
5. **用户元信息隐私**：城市默认关闭、只发城市名；不做 IP 定位。
6. **历史回执膨胀**：每会话 200 条上限；payload 小（≤5+5 条摘要）。
7. **视觉过度**：药丸/卡片只用现有 token；不引入新色板。
8. **live 锚点未验证**：本地 `user-<ts>` 与 runtime 真实 id 不一致；plan 必须先 spike，否则实时药丸可能永远不出现。
9. **快照缺结构化数据**：`RecallSnapshot` 只有 ids/block；必须 additive 扩展，否则快照路径只能解析字符串（禁止）。

---

## 10. 留给 builder 的决定

- `memory_receipts` 的清理频率（写入时裁剪 vs 每日任务）：写入时裁剪足够，若性能有问题再改。
- 时间线 segment 的 key 生成（首 part id 足够）。
- 大输出的首屏行数（建议 20 行 / 8KB，先到先得）。
- 工具详情默认展开与否（建议默认折叠；仅当前运行中的工具自动展开）。
- `latest-reminder` 的文本模板细节（只要包含日期、星期、时区、可选城市、语言）。
- 移动端回执卡片的具体形态（v1 可先复用桌面卡片 + 最大宽度）。

---

## 11. 文件地图

### gateway

- `gateway/src/recall/receipt.ts`（新）：`buildMemoryReceipt` 纯函数 + 类型。
- `gateway/src/routes/recall.ts`：捕获 memories/topic/t1Hits；响应后 enqueue 持久化 + broadcast；不阻塞。
- `gateway/src/recall/snapshot-builder.ts` / `recall-snapshot.ts`：additive 扩展结构化 `memories` 与 `t1Rendered`。
- `gateway/src/memory/gateway-db.ts`：`memory_receipts` 表 + upsert/list/prune。
- `gateway/src/routes/sessions-read.ts`（或新文件）：`GET /api/sessions/:id/memory-receipts`。
- `gateway/src/kernel.ts`：把 broadcaster 注入 recall deps（若当前 deps 没有）。
- `gateway/tests/unit/recall/memory-receipt*.test.ts`（新）。

### 发送锚点（spike 后二选一）

- `gateway/src/routes/chat*.ts` / `packages/gateway-sdk`：send 返回 `turnID`（方案 1）。
- `packages/desktop/src/renderer/mafw/chat/use-send-message.ts` + `src/hooks/session-recall.ts`：隐藏 `[[turn:<uuid>]]` part 透传（方案 2）。

### host hook

- `src/hooks/session-recall.ts`：从最后一条 user message 的 parts 提取 `[[turn:<uuid>]]`，作为 `anchorKey` 查询参数。
- `src/plugin.ts`：无需改（hook 已在）。

### desktop

- `packages/desktop/src/renderer/mafw/memory-receipt.ts`（新）：纯投影模型。
- `packages/desktop/src/renderer/mafw/components/MemoryReceipt.tsx`（新）：药丸 + 卡片。
- `packages/desktop/src/renderer/mafw/sse/handlers/memory-recall.ts`（新）+ `dispatcher.ts` 接线。
- `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`：渲染回执；元信息 chip。
- `packages/desktop/src/renderer/mafw/chat/use-send-message.ts`：`composeLatestReminderPart` + `composeTurnMarkerPart`（每次发送带 `[[turn:<uuid>]]`）。
- `packages/desktop/src/renderer/mafw/ingest/messages.ts`：剥离 `<latest-reminder>` 与 `[[turn:...]]`。
- `packages/desktop/src/renderer/mafw/mafw.css`：药丸/卡片/chip 样式（token）。
- `packages/gateway-sdk/src/{client,types}.ts`：`sessions.memoryReceipts` + DTO。

### session-ui

- `packages/session-ui/src/components/turn-transcript.ts`（新）：`splitTurn` 纯函数 + 类型。
- `packages/session-ui/src/components/process-timeline.tsx`（新）：段头/段体/工具详情。
- `packages/session-ui/src/components/session-turn.tsx` / `message-part.tsx`：用 `TurnTranscript` 替换 `AssistantParts` 的上下文分组路径；保留顶层卡片与 `renderAfterPart`。
- `packages/session-ui/src/components/parts-rules.ts`：新增 `TIMELINE_TOOLS` 集合；`CONTEXT_GROUP_TOOLS` 逐步退役/复用。
- 测试：`turn-transcript.test.ts`、`process-timeline.test.ts`、`session-turn-timeline.test.ts`。

---

## 12. 需要人类确认的开放问题

## 12. 已确认的决定

1. **类型标签：B（只用类型）**。`semantic → 事实`、`procedural → 做法`、`global → 通用`、`episodic → 往事`；不做前缀启发式，不猜“偏好 / 约定 / 教训”。等记忆系统新增 subtype/kind 后再升级（见 §14）。
2. **用户元信息位置：A（composer 上方）**。B（回合头部）/ C（仅设置）不作为 v1 选项，保留为后续可配置项。
3. 回执保留：每会话 200 条，不做全局 TTL。
4. `mafw_search_hybrid`：保留卡片，不进时间线（避免和自动 recall 回执混淆）。
5. T1 链接：有 trace 时给“打开原对话”，否则灰字“原文已不可用”。
6. 时间线默认：完成后折叠；输出永远可见，所以不会错过正文。

---

## 13. Builder check 决议（2026-11-18）

| # | Builder 问题 | 决议 |
|---|---|---|
| 1 | live 回执如何找到回合（本地 id vs 真实 id） | 主方案：隐藏 `[[turn:<uuid>]]` part；hook 与桌面读同一个 marker。Phase 0 只验证 marker 的透传与持久化；失败回退 send 返回 `turnID`。见 §4.6。 |
| 2 | 快照路径没有结构化 memories | additive 扩展 `RecallSnapshot`（`memories?` / `t1Rendered?`）；旧快照缺字段则不生成回执，不解析 block。见 §4.4.1。 |
| 3 | snapshot / FOK / neighbors 默认关闭 | 不改变现有配置；关闭时优雅降级：无 T1 摘要、只有 `inject` 态、邻居不显示。不为了 UI 打开检索特性。 |
| 4 | 0 结果时是否发回执 | 0/0 不发；`no-memory` 只在模型真的收到 `no-reliable-memory` 块时发。见 §4.2。 |
| 5 | “用时 N 秒”数据来源 | live 用 part 到达时间；history 用 message time 或省略；v1 不改 adapter。见 §5.2。 |
| 6 | 类型→偏好/约定/教训的映射 | 缺 schema；v1 选 B：只用类型（事实 / 做法 / 通用 / 往事）。等记忆系统新增 subtype 后再升级，不做启发式。见 §12 / §14。 |
| 7 | “已被更新”分支永远不会触发 | v1 删除该分支与 `supersededBy` 字段；recall 已过滤 superseded。 |
| 8 | `↳` 邻居是否算回执记忆 | 计入 payload 但标 `neighborOf`，显示为锚点行的补充，不增加“想起了 N 件事”的计数。 |
| 9 | T1 可能是工具输出 / 子代理提示词，不像人话 | 按 `source` 过滤 `tool/system`；未知来源用内容黑名单（`You are a subagent`、`[object Object]`、`<path>`、`ok \| ...`）；`filteredT1` 透明计数。见 §4.2 / §7.1。 |

---

## 14. 后续（不在本次范围）

- 记忆系统新增 `kind` / `subtype`（偏好、约定、教训、事实…）后，回执标签从“类型”升级为“语义标签”；同时补 `mafw_add_memory` 的写入参数与迁移。
- 回执卡片支持行内“记错了”编辑（v1 只跳 Memory 页）。
- 便签 / note-board 进入回执（v1 只做记忆 + T1 摘要）。
- 回执的移动端底部浮层。

---

## 附录 A：真实 recall block 的四种形状

```
<topic-recall>主题：... 相关记忆：见下方</topic-recall>

<recall>
[联想线索 ...]
[semantic]
  - #mem-xxxxxx [2026-... semantic] "..." (E:0.7)
    ↳ #mem-yyyyyy ...
[procedural]
  - #mem-zzzzzz ...
[知识更新 ...]
</recall>

[t1|t1t_...] 原话摘要……

<note-board>
- [11-20] 本周先别动事件层 schema（剩 4 天）
</note-board>
```

- 回执只消费 `<recall>` 的记忆与 `[t1|...]` 的摘要。
- `<topic-recall>` 只取主题与 hasRelated。
- `<note-board>` v1 不进入回执。
- 不解析字符串：gateway 在生成这些块的同时，把结构化的 `memories` / `t1Hits` / `topicState` 传给 `buildMemoryReceipt`。
