# Runtime 切换后前端状态全面刷新设计

日期：2026-09-16
状态：已批准（对话中用户确认：刷新模型/agent 列表 + 关闭所有会话 tab 重置到 fresh-launch 状态）

## 背景与问题

`POST /api/runtime/switch` 进程内热切换后，gateway 已广播 `{ type: 'runtime_switched', runtime, previous }`（`gateway/src/index.ts:3940`，`onSwitched` 内，事件流重订阅之后），桌面 MafwShell 也已消费（`MafwShell.tsx:1327`）——但**只 invalidate 了 Rail 会话列表**（`sessionStore.invalidate()`）。

缺口：`/api/provider`、`/api/agents` 都从**当前 runtime 的 client** 读（`gateway/src/index.ts:4072/4087`），而桌面 `providersData`（模型列表/模型选择器）与 `agentsData`（agent 选择器）只在 gwReady 时拉取一次（`MafwShell.tsx:1798-1848` 效果）——切换 runtime 后模型列表、agent 列表全部停留在旧 runtime 数据。

## 已调研的决策：关闭所有会话 tab（用户选定）

runtime 切换更换会话存储后端（opencode SQLite vs pi SessionManager），sessionID 空间互不相通。保留旧 tab 的成本（发送 404、SSE 断流停滞、需新增 runtime 维度只读保护）高于收益（切回后从历史重开仅 2 次点击）；业界同构场景（Chrome profile / k9s context / Jupyter kernel）均选择清空重建。关闭所有 tab 恰好落回已验证的 fresh-launch 代码路径（split 视图本就不持久化，`MafwShell.tsx:305`）。

## 目标

1. 切换 runtime 后，模型列表与 agent 列表自动重拉（反映新 runtime）
2. 已打开会话 tab 全部关闭，聊天区重置到 fresh-launch 状态（欢迎页）
3. gateway 零改动（广播已存在）

## 实现（全部在 `MafwShell.tsx`）

**1. 提取 `refreshMenus()`**：将现 createEffect（:1798-1848）内 `agents.list()` + `providers.list()` 拉取与 setState 逻辑提取为组件内函数（含 `defaultModel() === null` 兜底守卫与 providers 失败重试调度）；原 createEffect 改为调用它。SSE 事件与 effect 共用，天然幂等。

**2. `runtime_switched` handler（:1327-1333）扩展为**：

```typescript
if (event.type === "runtime_switched") {
  console.log("[mafw] SSE runtime_switched", event.runtime)
  // Runtime switch swaps the session storage backend (opencode SQLite vs
  // pi) — cached session lists and open tabs belong to the previous runtime.
  sessionStore.invalidate()
  void refreshMenus()
  resetChatWorkspace()
  return
}
```

**3. 新增 `resetChatWorkspace()`**（重置清单，全部已验证存在的状态）：

```typescript
const resetChatWorkspace = () => {
  setShowWelcome(true)                       // welcome 是信号（:142），非派生——必须显式置回
  setSessions([])
  setSplitViews([])
  setActiveViewId(null)                      // 初始值 null（:460）
  setActiveSessionId(null)
  setSubagentStack(reconcile({}))            // createStore（:103）——对象参数是合并且深层 merge 对 {} 是 no-op，必须 reconcile
  setTodos(reconcile({}))                    // createStore（:299）——同上
  setModelPicks({})
  setDefaultModel(null)                      // 旧 runtime 的兜底模型失效，由 refreshMenus 重设
  setStore("message", reconcile({}))         // store 是 createStore（:76）——嵌套字段逐个 path + reconcile 清空
  setStore("part", reconcile({}))
  setStore("session_status", reconcile({}))
  setStore("session_diff", reconcile({}))
}
```

前置 import 变更（`:2-3`）：`import { createSignal, ..., reconcile } from "solid-js"`、`import { createStore, reconcile } from "solid-js/store"`。

注意：`showWelcome` 是 createSignal 而非派生值——仅清空 sessions 不会回到欢迎页，必须显式 `setShowWelcome(true)`。`anchorRegistry`/`sendingResetters`/`queueFlushers` 等 per-sid registry 残留旧条目无害（内存级），不清理。`modelPicks`/`store` 的顶层 setter 是整对象替换信号（非 createStore），直接传新对象即替换。

## 非目标

- gateway / SDK / TUI 零改动（TUI 按需拉取天然新数据；Config 页 rtInfo 切换后已自行更新）
- 不处理 agentSel 重置（agent 列表刷新后选择残留由用户自行重选，YAGNI）
- 不处理 UsageDock/QuotaDock（15s 轮询自愈）
- 不做旧 tab 只读保留模式（调研已排除）

## 验证

- desktop 无 test script：`npx electron-vite build`（workdir `packages/desktop`）为门禁
- 人工验证点：①切到 pi 再切回 opencode，模型选择器分组反映当前 runtime（pi 下 provider 列表为空/503 时选择器显示兜底不残留旧数据）；②切换瞬间所有会话 tab 关闭、回到欢迎页；③切回后从历史重开会话正常；④Rail 会话列表在切换后立即可见新 runtime 的会话
