# Capability Kernel Phase 5 / Automation Live Wiring 交付记录

- 日期：2026-11-13
- 版本：5.1.0（未 bump、未发布）
- 范围：automation action provider 接 live + plugin event bridge
- Spec：`docs/research/2026-11-13-phase5-remaining-scope.md`
- Plan：`docs/superpowers/plans/2026-11-13-kernel-v2-phase5-automation.md`

## 交付范围

### External action resolver

- `AutomationEngine` 增加 `setExternalActionResolver` / `canResolveAction`。
- action 解析顺序：本地 `actions` map → external resolver。
- `ActionHandler` 增加可选 `source` 参数（`cron | event | user | llm`）。
- 外部 action missing / throwing 返回 `missing` / `error`，不抛进 scheduler。
- `validateRule` 用 `canResolveAction`，插件 action 只在 resolver 可解析时通过校验。

### Plugin action adapter

- 新增 `gateway/src/plugins/automation-actions.ts`：
  - action 类型：`plugin:<package>:<action>`。
  - 只解析 `PluginActionRegistry.has(pkg, action)` 为 true 的 action。
  - 输入：`{ ...rule.args, ruleId, source }`；metadata 覆盖同名 args。
- `boot.ts` 在 `PluginHost` 创建后调用 `kernel.bindPluginAutomation(host)`。

### Plugin event sink

- `PluginEventRegistry` 增加 `onEvent` 二次 sink：
  - 只在事件通过注册 / 命名空间 / schema 校验后调用。
  - sink 抛错 fail-open，记录 `sink-failed` 诊断，不阻止 broadcast，也不让 `ctx.emit` 失败。
- `PluginHostOptions.onEvent` 透传；boot 接到 `kernel.handlePluginEvent(event)`。

### Automation external event bridge

- `AutomationEngine.handleExternalEvent()` 按 `rule.trigger.on` 匹配插件事件。
- goal 事件：`goalId + stateVersion` 去重。
- 非 goal 插件事件：`sessionID` / `global` 作用域 + `perGoalCooldown`，不依赖 stateVersion=0。
- `scheduleEventRule` 对 `plugin:` 事件不再注册 `eventBus` 监听；插件事件只走 sink。
- 每条 rule 的异常只记录日志，不影响其他 rule。

### 明确不做

- 不做 timer-owning trigger provider；cron / CronJob / scheduler / budget 仍由 core 拥有。
- 不迁移 cron 规则，不改变 rule 文件格式。
- 不开放新 Goal 节点 / 调度语义。
- 不把插件事件当作 canonical event；仍受 `plugin:<pkg>:*` 命名空间与 schema 校验。

## 验证

- 本计划新增 **18 个测试**：
  - external action resolver / local precedence / missing / throwing / validate rule
  - plugin action adapter / out-of-band metadata
  - plugin event sink / dropped event / async sink rejection
  - external event bridge / cooldown / goal dedupe / unmatched
  - event rule draft API / live wiring source pins
- gateway 全量：**7140 passed / 1 skipped / 7141 total**（911 suites，`--testTimeout=20000`）。
  - 默认 5s 下 `pod-worktree-service` / `restore-git` 在当前 Windows 环境会超时；单文件也受环境影响，放宽到 20s 后全量 clean。属于既有 git worktree 环境 flake，不归因本次 automation 改动。
- gateway typecheck：`npx tsc --noEmit -p tsconfig.json` 退出 0。

## 审查修复（2026-11-13）

- **Action metadata 不再污染 input schema**：`PluginActionInvokeOptions.automation` / `PluginActionCallContext.automation` 作为 out-of-band 上下文传入；handler 的 schema 只校验 `rule.args`。新增 strict `additionalProperties:false` 回归测试。
- **Goal stateVersion 读取真实项目目录**：`AutomationEngine.setStateVersionProvider()` 由 kernel 用 `findGoalStatePath` 注入；state 缺失时不做 `reportedPairs` 去重，只走 cooldown。
- **Dedupe 按 rule 隔离**：`reportedPairs` key 改为 `rule:scope:version`，`unregisterEventRule` 同时清理 `lastFireTimes` / `reportedPairs`。
- **executeRule promise 不再悬空**：cron / event / external 路径都 `void ...catch` 记录错误，避免 unhandled rejection 触发 crash handler。
- **外部事件风暴护栏**：插件事件最少 1s cooldown；`lastFireTimes` / `reportedPairs` 超过 5000 条时裁剪到 4000；插件提供的 `goalId` 先做字符集校验。
- **async sink fail-open**：`onEvent` 支持 Promise，rejection 记录 `sink-failed`，不阻止 broadcast。
- **Event rule 可创建**：`POST /api/automations/draft` 与 MCP `draft-automation-rule` 接受 `trigger.type='event'`、`on[]`、`perGoalCooldown`。
- **未修（记录）**：event payload 未传给 action（只传 `rule.args + automation: {ruleId, source}`）；desktop Automations 表单仍只提供 cron；plugin hook 的 sink 诊断仍复用 drop diagnostic map。后续按需处理。

## 行为示例

```json
{
  "id": "demo-refresh",
  "enabled": true,
  "trigger": {
    "type": "event",
    "on": ["plugin:demo:changed"],
    "perGoalCooldown": "5m"
  },
  "action": { "type": "plugin:demo:refresh" }
}
```

- 事件 `plugin:demo:changed` 到达后，`AutomationEngine` 调 `demo:refresh` action。
- 输入为 `{ ...rule.args, ruleId: "demo-refresh", source: "event" }`。
- 同一 `sessionID` 5 分钟内只触发一次。

## Rollback

- 删除 `boot.ts` 的 `onEvent` / `bindPluginAutomation` → 插件事件/action 回到未接线状态。
- 删除 `AutomationEngine` 的 external resolver / `handleExternalEvent` → 本地 action / eventBus 行为不变。
- 不需要迁移数据；rule 文件格式未变。

## 关键 commit

- `d495f92b` feat(automation): add external action resolver
- `1ff02a82` feat(automation): resolve plugin actions in live rules
- `9b3605be` feat(plugins): add fail-open event sink
- `47ccd37c` feat(automation): trigger rules from plugin events
- `f0ac64cb` feat(automation): wire plugin events and actions into live kernel
- `7e123299` fix(automation): address review findings

## Next

Phase 5 剩余：GoalEval hook（可选）、storage backend 清理。memory 固定为产品能力；embedding/reranker/automation 已可调整。
