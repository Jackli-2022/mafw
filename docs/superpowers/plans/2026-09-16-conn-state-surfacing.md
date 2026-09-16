# Gateway 连接状态多界面真实反映实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** conn 相位（initial/connected/reconnecting/down）提升为模块级单例并接入 titlebar 圆点（融合 gwStatus）、全 tab 横幅+down 占位、Rail offline 融合、ChatPane down 禁用发送。

**Architecture:** `connection-state.ts` 导出模块级单例 `conn` + `useConnPhase()`；titlebar 既有圆点升级为融合态（conn 相位为主、gwStatus 兜底，新增 `.reconnecting` CSS 类）；ConnBanner 组件在 MafwShell 内容区挂一次（覆盖全部非 chat tab 的 down 占位）+ RightDock/Rail 各自挂载；gateway 零改动。spec：`docs/superpowers/specs/2026-09-16-conn-state-surfacing-design.md`。

**Tech Stack:** SolidJS renderer（desktop 包）。无测试框架——`npx electron-vite build` 门禁 + 人工验证（杀/启 gateway 观察各处）。

## Global Constraints

- 不改 connection-state 相位机逻辑；`connection-state.test.ts` 自建实例用法不受影响
- Solid 陷阱：组件内解构 props/信号丢响应；createStore 清空用 reconcile；conn 用模块级单例（规避 Context 断链，#mem-5swjt7）
- titlebar 圆点融合优先级（逐字）：`conn.down` 或 `gwStatus failed` → `failed` 类；`conn.reconnecting` → `reconnecting`；`conn.connected` → `ready`；`gwStatus starting` 或 `conn.initial` → `starting`；`gwStatus stopped` 且无 conn 信号 → `stopped`
- CSS 仅新增 `.mafw-titlebar-dot.reconnecting { background: #E5484D; animation: mafw-breathe 1s ease-in-out infinite; }`（沿用 failed 红色语义 + 呼吸表达恢复中，不引入约定外新色）
- 所有编辑用 Edit 工具精确替换；提交直接 main；构建 `npx electron-vite build`（workdir `packages/desktop`，timeout 300s）

---

### Task 1: 单例 + useConnPhase

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/connection-state.ts`（文件尾追加）

**Interfaces:**
- Produces: `conn`（模块级单例，MafwShell 的 `conn.report` 调用点不改）、`useConnPhase(): Accessor<ConnPhase>`

- [ ] **Step 1: 追加单例与 helper**

文件末尾（`allWithFailureFlag` 之后）追加：

```typescript
// Module-level singleton: one phase machine per renderer. Consumers import
// `conn` (to report) or `useConnPhase()` (to read reactively) — a module
// singleton avoids Solid Context chain issues entirely (first-party source,
// single bundle, no duplicate-instance risk).
export const conn = createConnectionState()

/** Reactive phase accessor for components. Subscriptions live for the page
 *  lifetime — consumers are app-lifetime components (Rail/titlebar/Docks), so
 *  no per-component cleanup is needed. */
export function useConnPhase(): Accessor<ConnPhase> {
  const [phase, setPhase] = createSignal<ConnPhase>(conn.phase)
  conn.subscribe((ev) => setPhase(ev.phase))
  return phase
}
```

并在文件头部 import 区补：`import type { Accessor } from "solid-js"; import { createSignal } from "solid-js";`（合并为一行：`import { createSignal, type Accessor } from "solid-js";`）

- [ ] **Step 2: 构建验证**

Run（workdir `packages/desktop/`）: `npx electron-vite build`
Expected: exit 0。

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/mafw/connection-state.ts
git commit -m "feat(desktop): connection-state module singleton + useConnPhase"
```

---

### Task 2: MafwShell 接线（单例改用 + titlebar 融合 + 横幅/占位）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`

**Interfaces:**
- Consumes: Task 1 `conn`/`useConnPhase`；既有 `gwStatus()` signal、TabStrip 内容分支（:2679-2690）、RightDock 渲染点
- Produces: `connPhase()` accessor（组件内），`connDown` 派生

- [ ] **Step 1: 删局部实例，改用单例**

:1253 `const conn = createConnectionState()` 删除（订阅与 report 调用点全部改用导入的单例）；import 行 `import { createConnectionState } from "./connection-state"` → `import { conn, useConnPhase } from "./connection-state"`；组件顶部（原实例位置）加 `const connPhase = useConnPhase()` 与 `const connDown = () => connPhase() === "down"`。

- [ ] **Step 2: titlebar 圆点融合**

titlebar 圆点块（`<TooltipV2 value={gwStatus()...}>` + `<div class="mafw-titlebar-dot" classList={{...}}>`）替换为：

```tsx
        <TooltipV2
          value={
            connPhase() === "down" ? "Gateway 已断开，正在自动重启…" :
            connPhase() === "reconnecting" ? `Gateway 正在重连（第 ${conn.attempts()} 次尝试）` :
            connPhase() === "connected" ? "Gateway 已连接" :
            gwStatus()?.state === "starting" ? "Gateway 启动中" :
            gwStatus()?.state === "failed" ? "Gateway 启动失败" :
            gwStatus()?.state === "stopped" ? "Gateway 已停止" :
            "Gateway 启动中"
          }
          openDelay={300}
        >
          <div class="mafw-titlebar-dot" classList={{
            ready: connPhase() === "connected" && gwStatus()?.state !== "starting",
            reconnecting: connPhase() === "reconnecting",
            failed: connPhase() === "down" || gwStatus()?.state === "failed",
            starting: connPhase() === "initial" || gwStatus()?.state === "starting",
            stopped: connPhase() !== "down" && connPhase() !== "reconnecting" && connPhase() !== "connected" && gwStatus()?.state === "stopped",
          }} style={{ "margin-left": 4 }} />
        </TooltipV2>
```

- [ ] **Step 3: 内容区横幅 + 非 chat tab down 占位**

`:2295` 内容区分支开头改为：

```tsx
        <div class="mafw-content" classList={{ "mafw-chat-content": activeTab() === "chat" }}>
          <Show when={connDown()}><ConnBanner /></Show>
          {showConfig() ? (
            <ConfigPage ... />
          ) : connDown() && activeTab() !== "chat" ? (
            <div class="mafw-rail-empty" style={{ padding: "48px 0" }}>Gateway 已断开——数据将在恢复后自动刷新</div>
          ) : activeTab() === "chat" ? (
```

（`<Show when={connDown()}>` 放在 `mafw-content` 内第一行——chat tab 也显示横幅；非 chat tab 在 down 时整区占位。ConfigPage 的现有 JSX 原样保留。）

- [ ] **Step 4: RightDock 横幅 + down 占位**

RightDock 渲染点（`<Show when={rightDockOpen()}>` 内）：

```tsx
          <Show when={rightDockOpen()}>
            <Show when={connDown()}><ConnBanner /></Show>
            {connDown() ? (
              <div class="mafw-rail-empty" style={{ padding: "48px 0" }}>Gateway 已断开——数据将在恢复后自动刷新</div>
            ) : (
              <RightDock ...（原 props 原样） />
            )}
          </Show>
```

- [ ] **Step 5: import ConnBanner**

`import { ConnBanner } from "./components/ConnBanner"`（Task 3 创建该文件——本文件内先引用，Task 3 创建后构建才绿；执行顺序按 Task 3 先建文件再回读本任务构建。**执行顺序调整：先 Task 3 的组件创建，再本任务构建。**）

- [ ] **Step 6: Commit（与 Task 3 合并提交）**

---

### Task 3: ConnBanner 组件 + Rail 融合 + ChatPane 禁用 + CSS

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/ConnBanner.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/Rail.tsx`（offline 融合 + 横幅）
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:2252-2264`（发送禁用）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（`.mafw-titlebar-dot.reconnecting`）

**Interfaces:**
- Consumes: Task 1 `useConnPhase`
- Produces: `ConnBanner`（down 时渲染红底横幅，否则 null）

- [ ] **Step 1: ConnBanner 组件（新建，先于 Task 2 构建）**

```tsx
import { useConnPhase } from "../connection-state"

/** Red banner shown while the gateway is DOWN (process exited, auto-restart
 *  in flight). Renders null in every other phase. */
export function ConnBanner() {
  const phase = useConnPhase()
  return (
    <Show when={phase() === "down"}>
      <div style={{
        background: "rgba(229, 72, 77, 0.12)",
        color: "#E5484D",
        padding: "6px 12px",
        "font-size": 12,
        "text-align": "center",
        "flex-shrink": 0,
      }}>Gateway 已断开，正在自动重启…</div>
    </Show>
  )
}
```

（import 补 `import { Show } from "solid-js"`。）

- [ ] **Step 2: Rail offline 融合 + 横幅**

Rail 组件顶部加 `const connPhase = useConnPhase()`；`offline` memo（:101）改为：

```typescript
  const offline = createMemo(() => sessionStore.isOffline(projectID()) || connPhase() === "down")
```

会话列表横幅：`<div class="mafw-rail-scroll" ref={scrollRef}>` 之前插入 `<Show when={connPhase() === "down"}><ConnBanner /></Show>`（import 同款）。

- [ ] **Step 3: ChatPane 发送禁用**

组件顶部 `const connPhase = useConnPhase()`；发送按钮（fallback 分支 :2252-2264）：

```tsx
                <ButtonV2
                  variant="contrast"
                  size="small"
                  onClick={sendMessage}
                  disabled={connPhase() === "down" || (!input().trim() && attachments().length === 0)}
                  class="mafw-send"
                  classList={{ "mafw-send-disabled": !input().trim() && attachments().length === 0 }}
                  aria-label={connPhase() === "down" ? "Gateway 已断开" : "发送"}
                >
```

- [ ] **Step 4: CSS**

`mafw.css` 的 `.mafw-titlebar-dot.failed` 行后追加：

```css
.mafw-titlebar-dot.reconnecting { background: #E5484D; animation: mafw-breathe 1s ease-in-out infinite; }
```

- [ ] **Step 5: 构建 + 提交（Task 2+3 合并）**

Run（workdir `packages/desktop/`）: `npx electron-vite build`
Expected: exit 0。

```bash
git add packages/desktop/src/renderer/mafw
git commit -m "feat(desktop): surface gateway connection phase across titlebar/tabs/rail/composer"
```

---

### Task 4: 人工验证 + 交付汇报

- [ ] **Step 1: 人工验证点**：①杀 gateway → titlebar 圆点红脉动→红、toast 恰一次、Goals/Triage 等非 chat tab 整区占位、chat tab 顶部横幅+发送禁用、Rail offline 占位；②自动重启回来 → 圆点回 accent、横幅消失、轮询回填、恢复 toast 一次；③短暂抖动 → reconnecting 红呼吸 → 回绿
- [ ] **Step 2: 汇报**：commit 哈希 + 构建结果（desktop 无自动化测试，如实说明）
