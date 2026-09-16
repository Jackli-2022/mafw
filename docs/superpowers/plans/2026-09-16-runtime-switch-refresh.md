# Runtime 切换后前端状态全面刷新实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 切换 runtime 后桌面自动重拉模型/agent 列表，并关闭所有会话 tab 重置到 fresh-launch 状态（欢迎页）。

**Architecture:** gateway 广播 `runtime_switched` 已存在（零 gateway 改动）。MafwShell 将 providers/agents 拉取提取为可复用 `refreshMenus()`，SSE handler 扩展为调用 `refreshMenus()` + `resetChatWorkspace()`（ Solid createStore 清空一律 `reconcile`）。spec：`docs/superpowers/specs/2026-09-16-runtime-switch-refresh-design.md`。

**Tech Stack:** SolidJS renderer（desktop 包）、electron-vite 构建。desktop 无 test script——构建门禁 + 人工验证。

## Global Constraints

- gateway / SDK / TUI / ModelPicker / agentSel 零改动（spec 非目标）
- createStore 清空必须 `reconcile`（对象参数是深层合并，`{}` 是 no-op）——`subagentStack`(:103)/`todos`(:299)/`store`(:76) 均是 createStore
- `showWelcome` 是信号（:142）——必须显式 `setShowWelcome(true)`，仅清 sessions 回不到欢迎页
- history 自动加载 effect（:1635-1640）在 `activeSessionId` 为 null 时早退——reset 后无误拉，已验证
- 所有编辑用 Edit 工具精确替换；禁止 PowerShell 管道重写整文件（编码损坏前科）
- 提交直接 main；构建命令在 `packages/desktop/`：`npx electron-vite build`（预期三段完成 exit 0，timeout 300s）

---

### Task 1: 提取 refreshMenus（行为不变的重构）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`：`:2-3`（imports）、providers/agents 拉取效果（`gwReadyForMenus` createEffect，约 :1802-1852）

**Interfaces:**
- Produces: `refreshMenus(): void`（组件内函数，拉取 agents.list + providers.list 并 setState，含 `defaultModel() === null` 兜底守卫与 providers 失败重试调度）——Task 2 的 SSE handler 消费

- [ ] **Step 1: imports 加 reconcile**

`:2` 与 `:3`：

```typescript
import { createSignal, createEffect, createMemo, onMount, onCleanup, Show, For, reconcile } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
```

- [ ] **Step 2: 效果体提取为 refreshMenus**

将现 createEffect 整体替换为（效果体原样搬入函数，逻辑逐字不变）：

```typescript
  const refreshMenus = () => {
    window.api.mafw.agents.list().then((list: any[]) => {
      setAgentsData(Array.isArray(list) ? list : [])
    }).catch(e => console.warn("[mafw] agents.list:", e))
    window.api.mafw.providers.list().then((p: any) => {
      setProvidersData(p)
      // Default the model pill to the most recently used model (first entry of
      // localStorage mafw-recent-models) — only when we have no default yet.
      if (defaultModel() === null) {
        try {
          const recent: string[] = JSON.parse(localStorage.getItem("mafw-recent-models") || "[]")
          const first = recent[0]
          if (first) {
            const findModel = (prov: any, mid: string) => {
              const m: any = prov.models?.[mid]
              return m ? { providerID: prov.id, modelID: mid, label: m.name || mid } : null
            }
            let found: { providerID: string; modelID: string; label: string } | null = null
            const slash = first.indexOf("/")
            if (slash > 0) {
              // Composite key: providerID/modelID
              const pid = first.slice(0, slash)
              const mid = first.slice(slash + 1)
              const prov = (p?.all || []).find((x: any) => x.id === pid)
              found = prov ? findModel(prov, mid) : null
            } else {
              // Legacy plain id: match the first provider that has it
              for (const prov of p?.all || []) {
                found = findModel(prov, first)
                if (found) break
              }
            }
            if (found) setDefaultModel(found)
          }
        } catch { /* ignore */ }
      }
    }).catch(e => {
      // Serve/gateway may still be starting (or briefly down): retry with a
      // bounded schedule instead of leaving an empty model picker forever.
      console.warn("[mafw] providers.list:", e)
      const attempt = providersRetry() + 1
      if (attempt <= 12 && providersRetryTimer === null) {
        providersRetryTimer = setTimeout(() => {
          providersRetryTimer = null
          setProvidersRetry(attempt)
        }, 10_000)
      }
    })
  }

  createEffect(() => {
    if (!gwReadyForMenus()) return
    providersRetry() // re-run when a failed providers fetch schedules a retry
    refreshMenus()
  })
```

- [ ] **Step 3: 构建验证（重构不变式）**

Run（workdir `packages/desktop/`）: `npx electron-vite build`
Expected: exit 0，无类型错误。

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "refactor(desktop): extract refreshMenus from gwReady providers effect"
```

---

### Task 2: resetChatWorkspace + runtime_switched handler 接线

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`：runtime_switched handler（:1327-1333）

**Interfaces:**
- Consumes: Task 1 `refreshMenus()`；既有 `sessionStore`（session-events 模块）、`setModelPicks`/`setDefaultModel`（per-session 模型状态）、`setStore`（createStore）
- Produces: `resetChatWorkspace(): void`（组件内函数）

- [ ] **Step 1: 替换 runtime_switched handler 为重置逻辑**

`:1327-1333` 整体替换为：

```typescript
      if (event.type === "runtime_switched") {
        console.log("[mafw] SSE runtime_switched", event.runtime)
        // Runtime switch swaps the session storage backend (opencode SQLite vs
        // pi) — cached session lists, model/agent menus, and open tabs belong
        // to the previous runtime. Refetch menus and reset the chat workspace
        // to the fresh-launch state (welcome page).
        sessionStore.invalidate()
        void refreshMenus()
        resetChatWorkspace()
        return
      }
```

- [ ] **Step 2: 新增 resetChatWorkspace**

紧接 handler 所在 createEffect 之后（或 `refreshMenus` 定义之后任意组件顶层位置）插入：

```typescript
  // Runtime switch swaps the storage backend: open tabs reference sessions
  // that do not exist under the new runtime (sending would 404, SSE delivers
  // no events for them). Reset to the fresh-launch state — welcome page,
  // empty caches. createStore fields MUST clear via reconcile (object args
  // deep-merge, {} would be a silent no-op).
  const resetChatWorkspace = () => {
    setShowWelcome(true)
    setSessions([])
    setSplitViews([])
    setActiveViewId(null)
    setActiveSessionId(null)
    setSubagentStack(reconcile({}))
    setTodos(reconcile({}))
    setModelPicks({})
    setDefaultModel(null)
    setStore("message", reconcile({}))
    setStore("part", reconcile({}))
    setStore("session_status", reconcile({}))
    setStore("session_diff", reconcile({}))
  }
```

- [ ] **Step 3: 构建验证**

Run（workdir `packages/desktop/`）: `npx electron-vite build`
Expected: exit 0；`Select-String -Pattern "resetChatWorkspace|refreshMenus" src\renderer\mafw\MafwShell.tsx` 各有定义与调用。

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): refresh menus and reset chat workspace on runtime switch"
```

---

### Task 3: 人工验证 + 交付汇报

- [ ] **Step 1: 人工验证点**（告知用户）：①切到 pi → 模型选择器分组变空/兜底、所有会话 tab 关闭回欢迎页；②切回 opencode → 模型列表恢复、从历史重开会话正常；③Rail 会话列表切换后立即可见新 runtime 会话
- [ ] **Step 2: 汇报**：commit 哈希 + 构建结果（desktop 无自动化测试，如实说明）
