# 后台任务面板（Background Tasks）设计 —— P0-3

> 日期：2026-10-22 · 状态：待用户确认
> 前置调研：`docs/research/2026-10-22-background-task-ui-placement.md`（六方放置调研）
> 前置实证：opencode v2.1.0 源码（tag `60c68d14`，与本机所装一致）逐文件核实
> 同构先例：P0-1 子代理生命周期面板（`2026-10-21-subagent-lifecycle-panel-design.md`）——本设计复用其 tracker/store/notify/dock 模式

## 1. 意图与为什么

opencode v2.1.0 runtime **已有一等后台能力**（用户实证 + 源码核实）：

- `shell` 工具 `background?: boolean`——后台命令**默认无超时**、立即返回 `{shellID, status:"running"}`、输出流式落盘、完成时 runtime 向父会话注入 **synthetic 完成消息**并自动唤醒模型
- `subagent` 工具 `background?: boolean`——同上语义（子会话面已由 P0-1 面板覆盖）
- REST：`GET /api/shell`（运行中列表）/ `GET /api/shell/:id`（含退出后状态与 exit code）/ `GET /api/shell/:id/output`（字节游标分页）/ `DELETE /api/shell/:id`（终止）
- `POST /api/session/:sessionID/background`——把该会话全部 blocking 工具转后台（TUI Ctrl+B 的等价物）

**MAFW 的缺口是纯显示层**：

1. 后台 shell 任务**零可见性**（无会话实体，只有 part 元数据 + `/api/shell`）
2. 完成消息**今天被静默吞掉**——`sse/handlers/chat-stream.ts:43` 的 `if (!info?.id || !info?.role) return true` 把无 role 的 synthetic 消息直接消费丢弃，用户与面板都无从知晓
3. 没有存在感层（业界聊天形态共识：composer 上方 work bar）
4. 没有「前台转后台」入口（长命令跑起来才发现该后台化，只能干等或中断）

用户场景（真实痛点）：长命令被 shell 超时整批杀掉、输出全丢（look 项目跑批事故）；agent 起 dev server 后用户不知道它在跑什么。

## 2. 目标 / 非目标 / 反目标

**目标**
- G1 **work bar 存在感层**：composer 上方常驻窄条，显示当前会话后台任务计数 + 最近任务，完成时变色提醒
- G2 **RightDock「后台」tab 详情层**：任务列表 + shell 输出预览（按需拉取）+ 终止 + 子代理跳转
- G3 **完成通知**：toast 恒发 + OS 通知（窗口隐藏时），复用 P0-1 的 10s 全局限频门（用户已确认）
- G4 **「转后台」入口**：blocking（前台运行中）任务可一键转后台（用户已确认）
- G5 全部从**既有事件与 REST 面推导**——零 gateway 改动、零 runtime 改动、零 canonical 词汇改动

**非目标**
- pi runtime 支持（pi 无后台能力；面板在 pi 下恒空是合法状态，同 P0-1 裁定）
- TUI 端（desktop-only；TUI 后续可复用同一推导逻辑）
- 输出实时流式 tail（v1 输出按需手动刷新拉取，不自动轮播）
- Kimi 式 bar 内联展开列表（v1 点击 bar = 打开 dock tab）
- 子代理会话列表本身（P0-1 已交付；本设计只在 background 语义下引用子会话）

**反目标**（做对了也算失败）
- 引入新 canonical 事件词汇或 gateway 路由
- 轮询洪泛（无活动时零**周期**轮询；mount/会话切换的一次性 bootstrap 拉取不在此列）
- 打扰式通知（cancelled/对账收敛静默；OS 走限频门）
- 动 composer 内部布局（小窗口 inputbar 坑在附近——bar 挂在 composer 容器**外侧上方**，不进 `.mafw-composer-toolbar` 的容器查询区）

## 3. 形态决策（用户已确认）

**方案 C：work bar + RightDock 详情（Kimi 双层）**。依据：聊天形态产品（Kimi/opencode）收敛于此；MAFW 的 RightDock 已有 P0-1 子代理 tab 天然充当详情层；Codex 侧栏路线（D）被自家 issue #33730 实证存在感不足，且 MAFW Rail 按会话组织、跨会话聚合需新抽象，不取。

## 4. 数据契约（opencode v2.1.0 实证，引用精确到源码）

### 4.1 后台任务的出现信号（工具 part 元数据）

后台化的工具调用，其 part 经两条路径到达 desktop——**live**（`part.updated` SSE）与**历史水合**（`loadSessionHistory` 拉回的 messages+parts）；`applyPartUpsert` / 历史写入均全量保留 `state`：

```
part.type === "tool"
part.tool === "shell" | "subagent"        // opencode 原生名，小写
part.state.status === "completed"          // 工具调用本身立即"完成"
part.state.metadata.status === "running"   // ← 后台任务的判别位
part.state.metadata.shellID                // shell 类
part.state.metadata.sessionID              // subagent 类（= 子会话 id）
part.state.input.command / .description    // label 来源
```

（依据：`packages/core/src/tool/plugin/shell.ts` 的 `backgroundResult()` 与 `toolResult()`；`subagent.ts` 的 `backgroundResult()`；官方 app `packages/app/src/session/requests/background.ts` 的同款推导。）

**前台转后台**（Ctrl+B/`backgroundAll`）后该 part 会再次 `part.updated` 为同一形状——同一检测点天然覆盖，无需单独事件。

### 4.2 完成信号（synthetic 消息）

任务终态时 runtime 向父会话注入 synthetic 消息（`packages/schema/src/session-message.ts`：`type: "synthetic"` 判别标签，带 `text`/`description`；shell 完成经 `ShellResult.notification(...)` 构造，含 jobID/shellID/command/state(text)/output）：

```
message.type === "synthetic"
message.metadata.source === "shell" | "subagent"
message.metadata.shellID / .jobID          // shell 消项键（两键都可能出现）
message.metadata.childID                   // subagent 消项键
```

官方 app 用它把任务从列表消项。**线上 wire 形状的精确字段（`type` vs 缺 `role`、metadata 键集）列入 plan 第 0 步实证**（对 scratch 会话跑一次后台 `sleep`，抓 SSE 帧钉死）——desktop 检测写成「`type === "synthetic"` 或（缺 `role` 且 `metadata.source` 存在）」的宽容判定。

### 4.3 REST 面（经 gateway 兜底反代零改动可达）

- `GET /api/shell` → 运行中 shell 列表（`Shell.Info`：`id/command/status/metadata.sessionID`；location-scoped，location 参数形状列实证项）
- `GET /api/shell/:id` → 单个含终态（exited + exit code）——对账探针
- `GET /api/shell/:id/output?offset=` → 输出分页（字节游标）
- `DELETE /api/shell/:id` → 终止 + 移除
- `POST /api/session/:id/background` → 该会话全部 blocking 工具转后台（无单选粒度）

gateway 无同名自有路由（`/api/shell*` 无注册；MAFW 会话路由是复数 `/api/sessions/`），落兜底反代（`gateway/src/index.ts` ~6511）。**反代对这两个前缀的可达性列实证项。**

### 4.4 与 P0-1 子代理面板的关系

后台 subagent 同时活在两处：**P0-1 子代理 tab**（会话面：该行计时/跳子会话，不变）与**本设计的后台语义**（work bar 计数 + 完成通知）。两个 tracker 各自从同一事件流独立推导，互不改写；完成通知通道合并（§7）。

## 5. 架构

全部落在 `packages/desktop/src/renderer/mafw/`，分层与 P0-1 完全同构：

```
SSE 事件流（既有）                历史水合（loadSessionHistory 后）   REST（经 gateway 反代）
   │ part.updated                     │ 扫描 parts+messages 产出          │ GET /api/shell（快照）
   │ message.updated(synthetic)       │ bg-observed / bg-terminal         │ GET /api/shell/:id（探针）
   │ turn.*（subagent 行终态兜底）     │                                   │
   ▼                                  ▼                                   ▼
sse/handlers/background.ts      hydration 摄取点（MafwShell 接线）   background-reconcile.ts
   │ TrackerEvent                     │ TrackerEvent                      │ （fetch 注入可测）
   ▼                                  ▼                                   ▼
                        background-tracker.ts（纯 reducer，无 Solid，幂等去重）
                                         │
                        background-store.ts（Solid 单例 + 终态回调）
                                         │
                        ┌────────────────┼─────────────────┐
                        ▼                ▼                 ▼
                 BackgroundWorkBar   BackgroundDock     通知（toast + OS，
                 （composer 上方）   （RightDock tab）   P0-1 共享限频门）
```

**双摄取点（builder check 补全）**：tracker 有两个喂入点——①dispatcher handler（live 事件）；②`loadSessionHistory` 完成后对水合的 messages/parts 做一次性扫描（parts 里的 background 元数据 → `bg-observed`；synthetic 消息 → `bg-terminal`，按时间序回放，幂等）。重启存活场景（dev server 还在跑、desktop 重开）靠②+对账恢复，不靠 live 运气。

- `background-tracker.ts`——纯 reducer：`BackgroundRow { id, kind: "shell"|"subagent", sessionID, label, status: "running"|"completed"|"failed"|"cancelled", startedAt, endedAt?, partID? }` + `applyBackgroundEvent(rows, ev, now)` + `collectNewTerminals`（同 P0-1 语义：只有 live running→终态转换产出通知源）
- `background-store.ts`——Solid 单例 + `onBackgroundTerminal(cb)` + `resetBackgroundStore()`（模式同 subagent-store）
- `sse/handlers/background.ts`——`SidHandler`，EXTRA_HANDLERS 链中**置于 chat-stream 之前、恒 `return false`**（观察不消费，链路语义不变）；从 `part.updated` 产 `bg-observed`，从 `message.updated` 产 `bg-terminal`；dispatcher 加 `background: { onEvent }` deps 组（P0-1 subagents 组先例）
- `sse/handlers/background.ts`——`SidHandler`，EXTRA_HANDLERS 链中**置于 chat-stream 之前、恒 `return false`**（观察不消费，链路语义不变）；从 `part.updated` 产 `bg-observed`，从 `message.updated` 产 `bg-terminal`，另把 `turn.completed/failed/aborted` 转发为 subagent 行的终态兜底信号（行 id = 子会话 id 匹配才生效——与 P0-1 各自观察同一事件流，不共享状态）；dispatcher 加 `background: { onEvent }` deps 组（P0-1 subagents 组先例）
- `background-reconcile.ts`——fetch 注入的对账编排（模式同 subagent-reconcile）：`/api/shell` 快照补/校准 running 行（按 `metadata.sessionID` 归会话）+ 快照中消失的 running 行经 `shell.get` 探针收敛（exited→completed/failed by exit code；404→cancelled）；**对账收敛的终态不触发通知**（snapshot 语义，同 P0-1）。**触发时机（builder check 补全）**：mount 与 `activeSessionId` 切换时一次性 bootstrap（防零行死锁——否则重启后永远发现不了活着的 shell）+ 15s 轮询门（「后台」tab 开着 OR 存在 running 行才跑，同 P0-1 的实际轮询条件）
- `BackgroundWorkBar.tsx`——ChatPane 内 composer 容器正上方（外侧，不进容器查询区）
- `BackgroundDock.tsx`——RightDock 新 tab；`dock-tab.ts` 加 `"background"`（契约测试 mini-TDD 同 P0-1）
- preload/SDK：`shells.list()/output(id,offset?)/remove(id)` + `sessions.background(id)`（renderer 只走 `window.api`，desktop AGENTS 约束）

### 5.1 行生命周期规则

| 事件 | 规则 |
|---|---|
| `bg-observed`（part 元数据） | 无行 → 建 running 行（幂等：同 id 不回退）；startedAt = now（实测时间不可得，可接受） |
| `bg-terminal`（synthetic 消息，或 subagent 行的 turn 终态兜底） | running 行 → completed/failed（失败判定：metadata/text 指示 error——实证后钉死判定字段）；cancelled/aborted → cancelled；**行不存在也建终态行**（重启后首见即完成态，保历史可见） |
| 用户点「终止」 | DELETE 成功后本地 → cancelled（静默，不等事件） |
| 对账快照 | 只校准已追踪行 + 补「运行中但从未见过 part」的行（serve 重启后工具 part 不可考但 shell 还活着）；未知态一律 running（与 P0-1 snapshot 的 completed 假设相反——因为 `/api/shell` 只返回运行中，状态是确知的） |
| 探针收敛 | 快照消失的行：`shell.get` exited → completed/failed；404 → cancelled；均静默 |
| 前台转后台 | 用户点「全部转后台」→ POST → **不乐观改态**，等 part.updated 到来自然迁移（防假态） |

终态幂等（首帧终态生效不回退）、排序 startedAt 倒序——均同 P0-1。

### 5.2 作用域

tracker 全局（所有会话的行一张表）；**work bar 与 dock tab 按 `activeSessionId` 过滤显示**（session-scoped，对齐 Kimi/opencode 语义）；完成通知对**全量行**触发（后台会话的任务也通知——与 P0-1 裁定一致的不对称）。

### 5.3 blocking（前台可转后台）检测

当前会话最新一条无 `time.completed` 的 assistant 消息中，存在 `state.status === "running"` 且 `tool ∈ {shell, subagent}` 的 part → 存在 blocking 工作。官方 app `createSessionBackground` 的 `blocking` 同款推导。bar 在此时显示「前台运行中」行 +「全部转后台」按钮（无后台任务时此行也可单独出现）。

**runtime 门（builder check 补全）**：blocking 行与「全部转后台」按钮仅在当前 runtime 为 opencode 时显示（`GET /api/runtime` 结果缓存于 store；未知/非 opencode → 隐藏，fail-closed——pi 无 `session.background` 端点，死按钮比没有按钮更糟）。面板其余部分（bar 行、dock tab）不 gate：pi 下恒空是合法空态（同 P0-1 裁定）。

## 6. UI 细节

### 6.1 Work bar（折叠态一行，高约 26px）

- 空态：整条不渲染（零占位）
- 常态：`⏳ 后台 N`（accent 色）+ `·` + 最近 running 任务 label（ellipsis）+ 右侧 `›`
- blocking 行（无后台任务时也可见）：`⏳ 前台运行中：<label>` + `[全部转后台]` ghost 按钮（ButtonV2 ghost）
- 完成瞬间：该行变 `✅ <label>`（success 色），5s 后若无其他 running 行则整条淡出卸载（`createPresence` 模式，v7 动效 token `--dur-surface`）
- 点击 bar → `applyRightDock(true, "background")` 打开详情
- 样式全走主题 token（禁字面值）；reduced-motion 下无淡出动画

### 6.2 RightDock「后台」tab

- 行：`🐚/🤖` kind 图标 + label（单行 ellipsis，悬停原生 title 与仓内先例一致）+ 状态文案（运行中/完成/失败/已取消）+ 计时（running 行 1s 跳，复用 `formatDuration`）
- shell 行展开（点击）：输出预览区——`GET /api/shell/:id/output` 拉尾部（约最后 4KB）等宽字体渲染 + 「刷新」+「终止」（ButtonV2 outline，点击即终止 + toast 确认，v1 无二次确认——可逆性：进程终止不可逆，加 confirm 内联确认，对齐仓内 revert 确认模式）
- subagent 行：点击跳子会话（复用 P0-1 `openSubagentSession`）
- 完成行保留在列表中（不自动清；切换会话自然过滤掉）
- 空态：「本会话暂无后台任务」+ 引导文案（`shell 工具加 background 参数或点「全部转后台」`）

### 6.3 通知（复用 P0-1 通道，共享限频门；双响抑制）

- 触发：`collectNewTerminals` 产出的 live running→终态转换，**但仅 `kind === "shell"` 的行**——background subagent 的完成通知归 P0-1 通道（其子会话 `turn.*` 终态 → 「子代理完成：<title>」，语义更好）；同一事件流两 tracker 各自观察，通知职责按 kind 切分，**消除双响**（builder check 补全：否则后台子代理完成会同时触发 P0-1 toast 与本通道 toast）
- 文案：`后台任务完成：<label>` / `后台任务失败：<label>`；cancelled 与对账收敛静默
- toast 恒发（与 P0-1 一致，门不节流 toast）；OS 通知仅窗口隐藏时；**与子代理通知共享同一个 `createNotifyGate(10_000)` 实例**（两类 OS 通知合计 10s 一条，防 #11716 洪泛——共享门是刻意加强；P0-1 既有行为不变）

## 7. 边界情况与风险

| 风险/边界 | 处置 |
|---|---|
| synthetic 消息 wire 形状与源码假设不符 | **plan 第 0 步实证**：scratch 会话跑后台 `sleep 2` 抓 SSE 帧 + `/api/shell` 响应，钉死字段后实现（检测写宽容判定兜底） |
| gateway 反代不覆盖某前缀（如单数 `/api/session/`） | 实证项；若被拦则在 gateway 加薄代理路由（唯一允许的 gateway 改动，需重新评估范围） |
| serve 重启丢 process-local job 注册表 | 重启后 `/api/shell` 空（进程随 serve 死）→ 行由对账探针收敛 cancelled，静默；可接受 |
| 合成消息唤醒父会话产生新 turn | 既有 turn 链路正常处理（这正是 runtime 的设计意图）；MAFW 侧无需特殊处理 |
| 后台 subagent 双重表示（P0-1 面板 + 本 bar） | 刻意：会话面 vs 任务面；通知合并防双响 |
| 小窗口 | bar 是单行 ellipsis，挂在 composer 外侧；不动 `.mafw-composer-toolbar` 容器查询区（AGENTS §5.5 小窗口护栏区） |
| pi runtime | 无 `/api/shell` 与 background 概念 → 恒空合法（反代 404/错误 fail-open） |
| `backgroundAll` 粒度是「该会话全部 blocking」 | 按钮文案写「全部转后台」如实反映；单选粒度 v1 不做 |
| `startedAt` 实测不可得（part 无后台化时刻字段） | 用首次观察到的时间（now）；计时从此起算，偏差可接受（标注为 builder 已知取舍） |

## 8. 测试策略（desktop 惯例：node --test + test-shim）

- `background-tracker.test.ts`：出现/终态三值/幂等/取消/对账快照/探针收敛/排序/作用域键/通知源只计 live 转换
- `background-reconcile.test.ts`：fetch 注入（快照补行/消失行探针 exited→completed、非零 exit→failed、404→cancelled/错误 fail-open）
- dispatcher：`part.updated`（shell background 元数据）与 synthetic `message.updated` → 转发断言；turn 终态 → subagent 行兜底断言；既有链路行为不变断言（P0-1 dispatcher 测试同款）
- 水合摄取：messages+parts 快照 → 正确产出 bg-observed/bg-terminal 且与 live 事件幂等去重（重启存活场景的核心回归）
- `dock-tab.test.ts`：契约加 `"background"`（mini-TDD）
- 通知：复用 P0-1 门的既有测试；新增「后台行终态触发回调」store 用例
- 门禁：desktop 全量 + `tsgo --noEmit` + `electron-vite build`

## 9. 留给 builder 的决策

- 具体 CSS token 选择、行高/内边距/图标字形的微调（须走 token，禁字面值）
- 输出预览的拉取字节数（建议 4KB 起步）与「刷新」交互细节
- toast 文案措辞与时长微调
- 对账轮询间隔（建议复用 15s，与 P0-1 一致）
- tracker 内部实现细节（在 §5.1 规则表语义内自由）

## 10. 实证清单（plan 第 0 步，先于一切实现）

对 live serve（scratch 会话，不触碰用户会话）：
1. 后台 shell（`sleep 2 && echo ok` 经工具或直接 `POST /api/shell`）→ 抓 `part.updated` 帧钉死 metadata 键集
2. 等其完成 → 抓 synthetic `message.updated` 帧钉死 `type`/`metadata.source`/消项键
3. `GET /api/shell` 响应形状 + location 参数要求
4. `POST /api/session/:id/background` 行为（blocking 中转后台后的 part 帧）
5. gateway 反代对 `/api/shell*` 与 `/api/session/:id/background` 的可达性（经 3000 端口转发验证）
