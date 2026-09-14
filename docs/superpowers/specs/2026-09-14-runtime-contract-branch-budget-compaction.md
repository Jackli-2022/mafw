# Runtime 契约 P0：分支原语、回合结果信封与预算、Compaction 切面

- 日期：2026-09-14
- 状态：待批准（设计）
- 动机：五家 agent 接口对比（Claude Code Agent SDK / Codex app-server / OpenCode / Hermes / Pi）确认 MAFW runtime 契约两处结构性落后：**无分支模型**（fork/revert/steering 全缺席，其余四家都有）与**回合结果不可编程**（prompt 无 usage/finish 信封、无 maxTurns/maxBudget、无 compaction 钩子）。本 spec 覆盖 P0 三项：分支原语、回合信封+预算、compaction 切面。

## 背景

对比结论（详见记忆 mem_1789351146979）：我们的契约在"会话 CRUD + 注入 + 审批 + 配置"主线已对齐第一梯队，但：

1. **分支原语缺席** —— Claude `fork_session`、Codex `thread/fork`+`thread/revert`、Pi 树形分支，全部有；我们只有 create/delete。**关键事实：opencode SDK 本身就有这三个端点，契约只是没接**：
   - `POST /session/{id}/fork {messageID?}` → 返回新 `Session`（`SessionForkData`，types.gen.d.ts:2040）
   - `POST /session/{id}/revert {messageID, partID?}`（`SessionRevertData`，types.gen.d.ts:2451）
   - `POST /session/{id}/unrevert`（types.gen.d.ts:2482）
   - Pi 侧同样有原生支撑：`SessionManager.branch(branchFromId)`（原地分支）、`createBranchedSession(leafId)` → 新会话文件、`getTree()`（session-manager.d.ts:289-312）。
   - MAFW 消费场景：Goal 编排失败换路线时保留上下文分叉重试（不再新开空白会话）；RSI 演化提议的平行分支实验前置条件。

2. **回合结果信封缺席** —— `session.prompt()` 现返回 `{ parts: any[] }` 裸类型；opencode `AssistantMessage` 本来就带 `cost: number`、`tokens{input,output,reasoning,cache}`、`finish`、`error`（types.gen.d.ts AssistantMessage），全部丢弃。Goal 成本记账只能靠 trajectory 事件旁路推算，**预算硬停（Claude `maxBudgetUsd`/`maxTurns` 同款）做不到**。

3. **Compaction 不可见** —— opencode 事件流有 `session.compacted`（`EventSessionCompacted`，types.gen.d.ts:419）；pi 有 `SessionBeforeCompactEvent`（压缩**前**）与 `SessionCompactEvent`（压缩后）。MAFW 的记忆源是 obs capture 独立于 runtime 转录，所以压缩不直接丢记忆，但**压缩信号触发 pending 回合 flush** 可保证长期记忆反映完整会话（worker compaction 目前盲压）。

### 明确排除

- **P1 项**（permissionReply 三值化 + question 通道、promptAsync delivery 语义 steer/followup、completion structured output）：独立 spec，不在本期。
- **pi runtime session 媒体附件**（promptAsync 拍平 parts 丢 file part 的疑似 bug）：便签板独立议题，正交。
- **桌面 fork/revert UI 接线**：session-ui 已有 `actions.fork/revert` 组件位（message-part.tsx:179），本期只到 HTTP/SDK 层，UI 后续。
- **第三方 runtime 插件**的实现义务：不实现即不声明能力，零破坏。
- pi 的 `unrevert`：无原生对应物（branch 不可逆但 entry 保留在文件，可凭 id branch 回去——语义不等价），**不实现**，契约中标记 opencode-only。

## 设计

### 1. sessionBranchApi：fork / revert / unrevert

**契约**（`gateway/src/runtime/contract.ts`）：

```ts
// RuntimeCapabilities 新增（可选）
/** runtime 提供会话分支原语（fork/revert；unrevert 视实现可选） */
sessionBranchApi?: boolean;

// RuntimeClient.session 新增可选方法
/** 分叉为新会话：原会话不动，新会话携带截至 messageID（缺省=当前末尾）的历史 */
fork?(opts: { sessionID: string; messageID?: string }): Promise<{ id: string }>;
/** 消息级回退（opencode：撤回该点之后的消息并回滚文件改动，可 unrevert 恢复；
 *  pi：映射为 SessionManager.branch() 原地移动 leaf——不回滚文件、不可逆，语义弱于 opencode） */
revert?(opts: { sessionID: string; messageID: string; partID?: string }): Promise<void>;
/** 撤销 revert（仅 opencode；pi 不实现） */
unrevert?(opts: { sessionID: string }): Promise<void>;
```

语义约束（写入契约注释）：

- fork 的 `messageID` 缺省 = 整体分叉；返回值是新会话 id。
- revert/unrevert 的文件回滚语义是 **opencode 特有**；pi 实现只移动对话 leaf，契约注释明确标注差异，调用方不得假设文件回滚。
- 繁忙会话上调用 fork/revert 的行为由 runtime 决定（opencode 允许；pi 对 busy 会话 branch 前需等 idle——pi 实现侧先 abort 或拒绝，实施时按 pi 行为实测选择，记录于实现注释）。

**opencode 实现**（`opencode-runtime.ts`）：`capabilities.sessionBranchApi = true`，三方法直连 SDK `client.session.fork/revert/unrevert`（endpoint/key 复用现有 client）。

**pi 实现**（`plugins/pi-runtime.ts` + `pi/pi-session.ts`）：
- fork：`SessionManager.createBranchedSession(leafId)`（messageID→entry id 直映射）得新文件路径 → `PiSessionRegistry` 用该文件创建新 `AgentSession` 并注册 → 返回新 sessionID。
- revert：`SessionManager.branch(branchFromId)`。
- unrevert：不实现（方法缺席 = 调用方 503）。
- `capabilities.sessionBranchApi = true`。

**gateway 消费面**（薄代理，能力门 503，风格同现有 session 代理端点；路由收敛在新文件 `gateway/src/routes/session-branch.ts`，deps 注入可单测）：

```
POST /api/sessions/:id/fork      {messageID?}            → 200 {session} | 503
POST /api/sessions/:id/revert    {messageID, partID?}    → 200 {} | 503
POST /api/sessions/:id/unrevert  {}                      → 200 {} | 503
```

SDK：`packages/gateway-sdk` 的 session 命名空间加 `fork/revert/unrevert` 三个方法（DTO 与上面对齐）。桌面 UI 接线不在本期。

### 2. 回合结果信封 + 预算参数

**契约**：

```ts
// RuntimeCapabilities 新增（可选）
/** runtime 原生强制执行 maxTurns/maxCostUsd（声明后 gateway 不再挂 BudgetGuard） */
turnBudgetApi?: boolean;

// SessionPromptOpts 新增
/** 回合数上限（一次 prompt 内的 agentic loop 步数）；超出即中止 */
maxTurns?: number;
/** 本次 prompt 的美元成本上限；超出即中止 */
maxCostUsd?: number;

// session.prompt() 返回类型扩展（超集，非破坏——现有消费方不受影响）
export interface PromptResultEnvelope {
  parts: any[];
  /** runtime 原生 finish reason（opencode AssistantMessage.finish） */
  finish?: string;
  /** undefined = runtime 未回传；消费方据此跳过记账（与 completionApi 语义一致） */
  usage?: {
    input: number;
    output: number;
    cached?: number;
    reasoning?: number;
    costUsd?: number;
  };
  /** 回合级错误（opencode AssistantMessage.error；abort 也经此通道表达） */
  error?: { name: string; message: string };
}
```

`session.prompt()` 签名改为 `Promise<PromptResultEnvelope & { [k: string]: any }>`——旧字段全部保留（超集），现有消费方零改动。

**opencode 实现**：prompt 响应 `info`（AssistantMessage）→ 信封映射（`cost→costUsd`、`tokens.cache.read→cached`、`finish`、`error`）。`maxTurns/maxCostUsd` opencode 无原生支持 → `turnBudgetApi` 不声明，由 BudgetGuard 兜底。

**pi 实现**：`AgentSession.prompt()` 结果 + `getLastAssistantUsage()` 映射；错误从 session 状态取。同样不声明 `turnBudgetApi`。

**BudgetGuard**（`gateway/src/core/budget-guard.ts`，新文件，deps 注入可单测）：

```
attachBudgetGuard({ sessionID, maxTurns?, maxCostUsd?, runtime, onAbort? })
  ├─ 订阅事件流 EventFacets：step 切面计数 turns；成本从 TrajectoryStore 按 sessionID 现查
  ├─ 超限 → runtime.session.abort(sessionID) + promptAsync(noReply) 注入
  │        "[MAFW] 预算上限已触发（maxTurns/maxCostUsd），会话已中止"
  └─ detach() 由调用方在 prompt 结算后调用（防泄漏）
```

- 仅当 `runtime.capabilities.turnBudgetApi !== true` 时才挂（原生支持的不重复强制）。
- 消费点：goal 执行器创建 execute session 时按 goal state `policy.maxTurns/maxCostUsd` 挂 guard；goal 无预算字段则**不启用**（本期不动 goal 创建面，policy 字段由编排层后续接入）。
- promptAsync 路径同样适用（guard 挂的是会话不是 prompt 调用）。

### 3. Compaction 切面

**契约**（`normalize.ts`，EventFacets 增加字段，不加能力位——eventStream 子集，无该事件的 runtime 恒 null 自然降级）：

```ts
export interface EventFacets {
  // ...现有字段不变
  /** 会话压缩信号：'start'=压缩前（仅 pi 有），'end'=压缩完成 */
  compaction: 'start' | 'end' | null;
}
```

**映射**：
- opencode：`session.compacted` → `'end'`（无 start 事件）。
- pi：`SessionBeforeCompactEvent` → `'start'`，`SessionCompactEvent` → `'end'`（pi-events.ts 翻译层接入）。

**gateway 消费**（index.ts 事件分发，fail-open）：收到 `compaction === 'end'`（pi 下 'start' 到即提前 flush）→ 对该 sessionID 触发 pending T1 回合的 turnCompress flush（复用现聚合压缩 per-session worker pipeline；内部 worker 白名单豁免不变；pipeline 不可用只记 `[Recall] compaction flush failed` 日志不阻塞）。

### 4. 错误语义与能力门

- 未声明 `sessionBranchApi` 的 runtime 调 fork/revert → HTTP 503（与现有能力门一致）。
- `prompt()` 信封字段取不到 = `undefined`（不是错误）；opencode `AssistantMessage.error` 存在时填入 `error` 字段且 `parts` 原样返回（不抛异常，与现状一致）。
- BudgetGuard 的 abort 失败只记日志（幂等，会话可能已 idle）。
- pi revert 语义弱于 opencode（无文件回滚）——契约注释 + `GET /api/runtime` 能力详情不变（差异属语义层非能力层）。

### 5. 测试策略

- 契约：能力声明位 + `PromptResultEnvelope` 类型形状。
- opencode runtime：mock SDK client——fork/revert/unrevert 参数映射；信封映射（cost/tokens.cache.read/finish/error 四字段）。
- pi runtime：mock SessionManager——fork 走 `createBranchedSession` + registry 注册新 session；revert 走 `branch()`；unrevert 缺席。
- normalize：opencode `session.compacted` → `compaction:'end'`；pi 两事件 → start/end；其他事件 compaction 恒 null。
- BudgetGuard：fake facets 流注入 step 事件计数超限 → abort 被调 + 注入通知；无预算字段 → 不 attach；detach 后事件不再触发。
- HTTP 路由：能力门 503 + 正常代理转发。
- 回归门槛：全部现有测试保持绿（信封是超集、facets 新字段默认 null、能力位全部可选）。

## 影响面

| 文件 | 变更 |
|---|---|
| `gateway/src/runtime/contract.ts` | `sessionBranchApi`/`turnBudgetApi` 能力位、session fork/revert/unrevert、`PromptResultEnvelope`、`SessionPromptOpts.maxTurns/maxCostUsd` |
| `gateway/src/runtime/normalize.ts` | EventFacets.compaction 切面 + opencode 映射 |
| `gateway/src/runtime/opencode-runtime.ts` | 三分支方法接线 SDK；prompt 信封映射 |
| `gateway/src/runtime/plugins/pi-runtime.ts` + `pi/pi-session.ts` + `pi/pi-events.ts` | fork/revert（SessionManager）；prompt 信封；compaction 事件翻译 |
| `gateway/src/core/budget-guard.ts` | 新文件：BudgetGuard |
| `gateway/src/routes/session-branch.ts` | 新文件：fork/revert/unrevert 三个代理端点（deps 注入） |
| `gateway/src/index.ts` | 路由注册；compaction 切面消费（turnCompress flush）；goal 执行器挂 guard |
| `packages/gateway-sdk/src/` | session 命名空间 + fork/revert/unrevert |
| `tests/unit/gateway/*` | 上述各层测试 |
| `AGENTS.md` §5.19 | 契约面更新（能力位 + 分支语义差异 + 信封） |

## 后续（本 spec 不做）

- P1 spec：permissionReply 三值化 + questionReply 通道；promptAsync delivery 语义（steer/followup/expectReply，修 pi busy 丢 noReply 已知限制）；completion structured output。
- 桌面 ChatView fork/revert UI 接线（session-ui 组件位已存在）。
- Goal policy 预算字段接入 goal 创建面（`mafw_create_goal` / charter）。
