# Runtime 契约 P1 批次：Approval 三值化、Delivery 语义、Structured Output、桌面分支 UI、Goal 预算面、Session 媒体附件

- 日期：2026-09-14
- 状态：待批准（设计）
- 动机：P0 spec（2026-09-14-runtime-contract-branch-budget-compaction.md）"后续"清单的全部六项 + note-board 已确认合并的 session 媒体附件议题。本 spec 为总纲式设计，六节相互独立，实施按节拆 plan（建议顺序：A+B+C+F 契约层一批 → E 小批 → D 桌面批）。

## 背景

五家 agent 接口对比（mem_1789351146979）确认的中价值缺口 + P0 实施后暴露的接线点。关键现状事实（已核实）：

1. **Permission 双链**：桌面 AskCard/PermissionCard 走**原生代理链**（`/api/permissions/:id/reply` 经 `proxyNativeWorkspaces` 直透 opencode `{reply:'once'|'always'|'reject', message?}`，三值已可用，opencode-only）；runtime 契约的 `permissionReply(sessionID, requestId, approved: boolean)` 是 pi ApprovalBridge 用的另一条链（`routes/permission.ts` 只认 `{approved}`）。缺口 = 契约表达力 + pi 侧三值。
2. **pi 无原生 noReply**：pi `PromptOptions` 只有 `streamingBehavior?: 'steer'|'followUp'` 与 `images?`——`noReply` 在 pi **全路径**无效（不只 busy 分支）。milestone push 等消费方在 pi 下本就降级。
3. **pi 无顶层 structured output**：pi-ai 的 `json_schema` 仅用于 tool constrained sampling；`ModelRuntime.complete` 无 response format。
4. **Goal 预算闭环只差参数面**：P0 的 `attachBudgetGuardForGoal` 已读 goal state `policySnapshot.{maxTurns,maxCostUsd}`；`onGoalCreated` 已写 policySnapshot——缺 `mafw_create_goal`/`mafw_set_goal` 的参数透传。
5. **媒体附件**：pi `partsToPromptInput` 已把 image file part 转 ImageContent（pi-runtime.ts:33-51）——note-board 记忆（mem_1788891049274）指向的 :93-96 拍平代码与现状不符，**疑似已部分修复，实施时探针核实**；video/audio 的 session 路径 wire 改写确实缺失。

### 已拍板决策

- `permissionReply` **直接改签名**（无 V2 兼容层）——仓库内两实现同步改，编译器兜底。
- pi `expectReply=false` **接受降级 + 每会话一次警告日志**（不建 idle 重试队列）。

### 明确排除

- 桌面 AskCard/PermissionCard 的渲染与轮询逻辑（原生代理链零改动）。
- 事件切面新增 `question`（桌面已有 10s 轮询，YAGNI）。
- structured output 的消费方接线（index-scan judge 等后续按需）。
- opencode 侧 `delivery` 映射（无原生概念，声明忽略）。
- 媒体单次 complete 路径（`MediaRuntimeExecutor` 的 video/audio fallback 分支不动）。

## 设计

### A. Permission 三值化 + Question 通道

**契约**（`contract.ts`）：

```ts
// 签名变更（破坏性，编译器兜底两实现）
permissionReply(
  sessionID: string,
  requestId: string,
  reply: 'once' | 'always' | 'reject',
  message?: string,
): Promise<boolean>;

// Question 通道（可选能力；仅 opencode 实现）
questionApi?: boolean;

session.question?: {
  list(opts?: { directory?: string }): Promise<any[]>;
  reply(opts: { requestID: string; answers: string[][] }): Promise<void>;
  reject(opts: { requestID: string }): Promise<void>;
};
```

**pi 实现**（`pi-approval-bridge.ts` + `pi-approval-extension.ts`）：

- Bridge 的 pending map 存 resolver + 一个 `DecisionSink`；`reply(requestId, decision, message?)`：
  - `'reject'` → resolve(false)；`message` 作为 block reason 透出（`{ block: true, reason: message ?? 'rejected by user' }`）
  - `'once'` → resolve(true)
  - `'always'` → resolve(true) 并记 decision 到 bridge（带 toolName）
- Extension 在 `bridge.request` 返回后：若 decision 为 `'always'`，`policy.autoApprove.push(toolName)`——`ApprovalPolicy` 是构造时共享引用，后续 tool_call 即时免审（**session 级动态 allowlist**，不落盘；registry.disposeAll 后自然失效）。
- `permission.replied` 事件保持 `approved: boolean` 形状（opencode 归一化兼容），可选附加 `decision` 字段透传。
- opencode 实现：`once/always/reject` + message 直透原生 permission reply API（adapter 新增对应 SDK 调用）。

**HTTP**（`routes/permission.ts`）：body 优先读 `{reply, message?}`（三值校验），兼容读旧 `{approved: boolean}`（`true→'once'`、`false→'reject'`）；透传给 `runtime.session.permissionReply`。

**能力门**：`questionApi` 未声明 → `/api/questions*` 现有 `capGuard('nativeApprovals')` 改为按 `questionApi ?? nativeApprovals` 判（向后兼容：opencode fullCapabilities 两项都 true）。

### B. Delivery 语义

**契约**（`SessionPromptOpts`）：

```ts
/** busy 会话的消息投递时机：'steer'=当前工具批后送达（纠偏），'followup'=全部完成后。opencode 无原生概念（忽略）。 */
delivery?: 'steer' | 'followup';
/** 期望本条消息触发 LLM 回复。false = 落历史免回复（opencode noReply 语义）。pi 无原生等价——全路径降级为普通消息（busy 时 followUp），每会话 warn 一次。 */
expectReply?: boolean;
/** @deprecated 用 expectReply: false 替代；一个迁移周期后删除 */
noReply?: boolean;
```

- opencode adapter：`noReply: opts.noReply ?? (opts.expectReply === false ? true : undefined)`；`delivery` 忽略。
- pi registry：非 busy `s.prompt(text, { ...piOpts, streamingBehavior: delivery === 'steer' ? 'steer' : 'followUp' })`（仅 busy 时 pi 真正消费 streamingBehavior——非 busy 传也无害）；busy 分支 `sendUserMessage(content, { deliverAs: delivery === 'steer' ? 'steer' : 'followUp' })`；`expectReply === false || noReply` → registry 内 `warnedNoReply` Set 每会话 warn 一次，消息照发（降级）。
- gateway 内部消费方迁移：`milestone-push.ts`、`step-inject`（`sendStepInjection`）、BudgetGuard notify 把 `noReply: true` 改为 `expectReply: false`；`noReply` 字段本体保留至迁移完成后的下一个清理批次。

### C. Completion structured output

**契约**（`CompletionRequest`）：

```ts
/** 约束输出为 JSON Schema。实现方映射到自己 provider 的机制（OpenAI response_format）；
 *  映射不了则忽略（fail-open）——结果仍可能非 JSON，消费方自解析兜底。 */
responseFormat?: {
  type: 'json_schema';
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};
```

- opencode（`completion-http.ts`）：映射 `response_format: { type: 'json_schema', json_schema: { name, schema, strict } }`（DashScope/OpenAI-compatible 通用）。
- pi（`pi-runtime.ts` complete）：**忽略**（ModelRuntime 无顶层支持）；契约注释声明。
- 本期无消费方变化。

### D. 桌面 ChatView fork/revert 接线

- **接线点**：桌面 renderer 消息操作区（ChatPane 的消息上下文操作，经 session-ui `message-part.tsx` 已有的 `actions.fork/revert: SessionAction` 位）。
- **数据流**：UI 回调 → SDK `session.fork({path:{id}, body:{messageID}})` / `revert` → gateway 代理端点（P0 已有）→ runtime。
- **交互**：
  - fork 成功 → toast + 打开/切换到新会话 tab（复用 Rail/TabStrip 现有会话打开路径）。
  - revert → 确认对话框（文案明确 opencode 语义："撤回该消息之后的所有消息并回滚文件改动"）；成功后刷新消息列表。
  - 会话处于 reverted 态（session info 含 revert 标记时）显示 unrevert 入口。
- pi runtime 下 revert 可用（无文件回滚——确认对话框文案按 runtime 能力区分为 stretch，v1 统一 opencode 文案 + 能力探测降级隐藏 unrevert）。

### E. Goal 预算创建面

- `mafw_create_goal` / `mafw_set_goal`（`handlers/create-goal.ts`、`handlers/manager-set-goal.ts`）args 加：

```ts
budget?: { maxTurns?: number; maxCostUsd?: number };
```

- 写入 request.json 顶层 `budget` 字段；`onGoalCreated`（index.ts）写 policySnapshot 时合并：`policySnapshot = { ...policy, ...(request.budget ?? {}) }`——`attachBudgetGuardForGoal`（P0）零改动闭环。
- triage-confirm 创建路径（index.ts triage confirm handler）同样透传（proposedGoal 可选 budget）。
- 工具 schema（tool-registry DEFINITIONS）同步加参数描述。

### F. Session 媒体附件

**契约语义**（`SessionPromptOpts.parts` 注释）：`{ type: 'file', url, mime?, filename? }` 为一等媒体附件载体——`url` 可为 dataURL 或 runtime 工件引用；`mime` 决定模态（image/*、video/*、audio/*）。runtime 应把它作为对应模态的多模态输入递给模型，而非文本拍平。

**实现**：

- opencode：原生 file part 透传（现状已工作，零改动）。
- pi image：`partsToPromptInput` 现状已转 ImageContent——**探针**：核实 note-board 记忆指的 promptAsync 拍平路径是否仍存在于其他调用点（`registry.promptAsync` 的 message 兜底 `text = opts.message ?? converted.text ?? ''` 语义正确，无丢失）；若探针证实已修复，本节 image 部分缩为回归测试固化。
- pi video/audio：**session 路径 wire 改写**——注入 extension 监听 `BeforeProviderRequestEvent`（pi extension 事件，可改写 provider payload），对 `video/*`/`audio/*` 内容应用 `fixMediaPayload`（复用 `media/pi-adapter.ts` 现有导出）；`partsToPromptInput` 扩展：video/audio file part 不再静默丢弃，收集为 `mediaAttachments` 传入 registry，经 session 上下文注入 provider 请求。
- `MediaRuntimeExecutor` 的 image session 分支行为不变；video/audio 继续走单次 complete 路径（本节只解决"session 内用户消息带媒体"场景，两路径并存）。

## 测试策略

- **A**：bridge 三值决策（once/always/reject）+ always 后 policy.autoApprove 增长（第二次 tool_call 免审）；opencode adapter 三值透传；routes/permission 新旧 body 兼容；question 通道 opencode 实现 + pi 缺席。
- **B**：opencode noReply/expectReply 映射；pi busy delivery 映射 steer/followUp；pi expectReply=false 降级 + 每会话单次 warn；deprecated noReply 仍透传。
- **C**：opencode httpComplete 映射 response_format；pi 忽略不抛。
- **E**：handler 写 request.json budget；onGoalCreated 合并 policySnapshot；guard 挂载读到位（集成：create_goal 带 budget → attachBudgetGuardForGoal 生效）。
- **F**：partsToPromptInput video/audio 收集；BeforeProviderRequestEvent 改写调用 fixMediaPayload；opencode 透传回归。
- 回归门槛：全量 `npm test --prefix gateway` + `cd packages/gateway-sdk && bun test` + `npm run build` 全绿。

## 影响面

| 节 | 文件 |
|---|---|
| A | `contract.ts`、`opencode-adapter.ts`、`pi/pi-approval-bridge.ts`、`pi/pi-approval-extension.ts`、`runtime/plugins/pi-runtime.ts`、`routes/permission.ts`、`index.ts`（capGuard 判定） |
| B | `contract.ts`、`opencode-adapter.ts`、`pi/pi-session.ts`、`runtime/plugins/pi-runtime.ts`、`core/manager/milestone-push.ts`、`recall/step-inject`（sendStepInjection 消费点）、`core/budget-guard.ts` 挂载处 |
| C | `contract.ts`、`runtime/completion-http.ts`、`runtime/plugins/pi-runtime.ts`（注释） |
| D | `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（或消息操作组件）、`packages/gateway-sdk`（已有，无需改） |
| E | `mcp/handlers/create-goal.ts`、`mcp/handlers/manager-set-goal.ts`、`mcp/tool-registry.ts`（schema）、`index.ts`（onGoalCreated + triage confirm） |
| F | `contract.ts`（注释）、`runtime/plugins/pi-runtime.ts`、`runtime/pi/pi-session.ts`、新 extension（或并入 mafw-compaction 同型注入） |

## 实施顺序

1. **批次 1（契约层）**：A → B → C → F（同质：契约类型 + 双 runtime + 测试）
2. **批次 2（小）**：E goal 预算面
3. **批次 3（桌面）**：D fork/revert UI

每批次独立 plan → 实施 → 回归，遵循既有"直接提交 main"工作流。
