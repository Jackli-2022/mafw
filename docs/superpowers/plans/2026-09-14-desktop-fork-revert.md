# 桌面 ChatView fork/revert 接线（P1 批次 3）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面 ChatPane 消息操作区接 session-ui 现有 `actions.fork/revert` 位：fork → SDK → toast + 打开新会话 tab；revert → 内联确认条 → SDK → 清 store 触发重拉；会话 reverted 态显示 unrevert。

**Architecture:** main 进程零改动（mafw-ipc 通用派发 `mafwClient[ns][method]`，SDK 三方法 P0 已有）。改动面 = preload（类型 + 3 方法）、ChatPane（actions 回调 + 确认条 + 刷新）、MafwShell（传 `onOpenForkedSession=openSessionTab`）。

**Tech Stack:** SolidJS、Electron preload、`@mafw/session-ui`（SessionTurn actions 位现成）。

**Spec:** `docs/superpowers/specs/2026-09-14-runtime-contract-p1-batch-design.md` §D

## Global Constraints

- renderer 只经 `window.api`（desktop AGENTS.md 约束）；IPC 走通用派发，main 不加专用 handler。
- 验证 = `cd packages/desktop && npm run typecheck`（tsgo -b，板记忆 rss0vt）+ `npx electron-vite build`。
- 源码修改一律 edit/write 工具。
- 每 task：改动 → typecheck → commit。

---

### Task 1: preload 三方法 + 类型

**Files:**
- Modify: `packages/desktop/src/preload/mafw-types.ts`（sessions namespace 类型）
- Modify: `packages/desktop/src/preload/mafw-api.ts`（sessions 实现）

**Interfaces:**
- `sessions.fork(sessionID: string, messageID?: string): Promise<{ session: { id: string } }>`
- `sessions.revert(sessionID: string, messageID: string): Promise<void>`
- `sessions.unrevert(sessionID: string): Promise<void>`

- [ ] **Step 1: mafw-types.ts** sessions 段 abort 行后加：

```ts
      fork: (sessionID: string, messageID?: string) => Promise<{ session: { id: string } }>
      revert: (sessionID: string, messageID: string) => Promise<void>
      unrevert: (sessionID: string) => Promise<void>
```

- [ ] **Step 2: mafw-api.ts** sessions 段 abort 行后加：

```ts
      fork: (sessionID, messageID?) => invoke("session", "fork", { path: { id: sessionID }, body: { messageID } }),
      revert: (sessionID, messageID) => invoke("session", "revert", { path: { id: sessionID }, body: { messageID } }),
      unrevert: (sessionID) => invoke("session", "unrevert", { path: { id: sessionID } }),
```

- [ ] **Step 3: 验证 + Commit**

Run: `cd packages/desktop && npm run typecheck`
Expected: exit 0

```bash
git add packages/desktop/src/preload/mafw-types.ts packages/desktop/src/preload/mafw-api.ts
git commit -m "feat(desktop): preload sessions fork/revert/unrevert"
```

---

### Task 2: ChatPane actions + 确认条 + MafwShell 接线

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（ChatPane 调用点传 prop）

**Interfaces:**
- `ChatPaneProps.onOpenForkedSession?: (sid: string) => void`
- PaneInner 内：`revertConfirm` signal、`canUnrevert` signal、`userActions` memo、`refreshAfterRevert()`（清 store.message[sid] + pageState 重置 → MafwShell 现有 effect 自动 loadSessionHistory）

- [ ] **Step 1: ChatPane props 加 onOpenForkedSession**（`onClosePane` 附近）：

```ts
  onOpenForkedSession?: (sid: string) => void
```

- [ ] **Step 2: PaneInner 状态与回调**（`switchConfirm` signal 定义附近加）：

```ts
  const [revertConfirm, setRevertConfirm] = createSignal<{ messageID: string } | null>(null)
  const [canUnrevert, setCanUnrevert] = createSignal(false)

  // 会话 reverted 态探测（session info 的 revert 字段，opencode 专属）
  onMount(async () => {
    if (!sidProp()) return
    try {
      const info: any = await window.api.mafw.sessions.get(sidProp())
      setCanUnrevert(!!info?.revert)
    } catch { /* fail-open */ }
  })

  const refreshAfterRevert = () => {
    props.setStore(prev => ({ ...prev, message: { ...prev.message, [sidProp()]: [] }, part: { ...prev.part, [sidProp()]: [] } }))
    props.setPageState(sidProp(), { cursor: null, hasMore: true, loading: false })
  }

  const userActions = () => ({
    fork: async ({ sessionID, messageID }: { sessionID: string; messageID: string }) => {
      try {
        const out = await window.api.mafw.sessions.fork(sessionID, messageID)
        showToastV2({ title: "已分叉", description: `新会话 ${out?.session?.id ?? ""} 已创建`, variant: "success" })
        if (out?.session?.id) props.onOpenForkedSession?.(out.session.id)
      } catch (e: any) {
        showToastV2({ title: "分叉失败", description: String(e?.message || e), variant: "error" })
      }
    },
    revert: async ({ messageID }: { sessionID: string; messageID: string }) => {
      setRevertConfirm({ messageID })
    },
  })
```

（`userActions` 返回的 revert 只打开确认条；真正执行在确认按钮。）

- [ ] **Step 3: revert 确认执行与 unrevert**（回调区继续）：

```ts
  const doRevert = async () => {
    const target = revertConfirm()
    if (!target) return
    setRevertConfirm(null)
    try {
      await window.api.mafw.sessions.revert(sidProp(), target.messageID)
      setCanUnrevert(true)
      refreshAfterRevert()
      showToastV2({ title: "已回滚", description: "该消息之后的历史已撤回", variant: "success" })
    } catch (e: any) {
      showToastV2({ title: "回滚失败", description: String(e?.message || e), variant: "error" })
    }
  }

  const doUnrevert = async () => {
    try {
      await window.api.mafw.sessions.unrevert(sidProp())
      setCanUnrevert(false)
      refreshAfterRevert()
      showToastV2({ title: "已撤销回滚", variant: "success" })
    } catch (e: any) {
      showToastV2({ title: "撤销失败", description: String(e?.message || e), variant: "error" })
    }
  }
```

- [ ] **Step 4: SessionTurn 传 actions**（1761 行附近的 `<SessionTurn>`）：

```tsx
                    <SessionTurn
                      sessionID={sidProp()}
                      messageID={msg.id}
                      actions={userActions()}
                      classes={{ root: "min-w-0 w-full relative", content: "!overflow-visible", container: "w-full" }}
                    />
```

- [ ] **Step 5: 确认条 UI**（复用 switchConfirm 确认条样式，放在 switchConfirm 的 Show 之后）：

```tsx
                  <Show when={revertConfirm()}>
                    <div class="mafw-confirm-text" style={{ "margin-bottom": "8px" }}>
                      回滚到此消息之前？该消息之后的历史将撤回且文件改动回滚（不可通过界面恢复的部分请谨慎）。
                      <ButtonV2 variant="ghost" size="small" onClick={() => setRevertConfirm(null)}>取消</ButtonV2>
                      <ButtonV2 variant="outline" size="small" onClick={doRevert}>确认回滚</ButtonV2>
                    </div>
                  </Show>
                  <Show when={canUnrevert()}>
                    <div style={{ "margin-bottom": "8px" }}>
                      <ButtonV2 variant="ghost" size="small" onClick={doUnrevert}>撤销回滚（unrevert）</ButtonV2>
                    </div>
                  </Show>
```

（实施时按 switchConfirm 块的实际 JSX 结构对齐容器与样式类；ButtonV2 variant 以 @mafw/ui 现有取值为准。）

- [ ] **Step 6: MafwShell 接线**：ChatPane 调用点加 `onOpenForkedSession={(sid) => openSessionTab(sid)}`。

- [ ] **Step 7: 验证 + Commit**

Run: `cd packages/desktop && npm run typecheck`（exit 0）→ `npx electron-vite build`（exit 0）

```bash
git add packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): ChatView fork/revert/unrevert actions with confirm flow"
```

---

### Task 3: 回归与文档

- [ ] **Step 1: 全量回归**（gateway 未动，跑一遍确认无连带）：

```bash
npm test --prefix gateway
```

- [ ] **Step 2: AGENTS.md 批次 3 一行**（§5.19 Goal 预算面行后）：

```markdown
- 桌面 ChatView fork/revert：ChatPane 经 `window.api.mafw.sessions.fork/revert/unrevert`（preload →
  通用 IPC 派发 → SDK）接 session-ui `SessionTurn` actions 位；revert 内联确认 + 清 store 触发重拉；
  fork 成功 toast + `onOpenForkedSession`（openSessionTab）打开新 tab；unrevert 按 session.revert 态显示
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md desktop fork/revert wiring (P1 batch 3)"
```
