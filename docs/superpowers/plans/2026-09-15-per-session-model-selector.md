# Input Bar 模型选择按 session 隔离实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打开/切换任意会话时，input bar 模型选择器与该 session 之前实际使用的模型一致；split view 各 pane 独立。

**Architecture:** 全局 `modelSel` 信号替换为 per-session 派生链——用户手选（内存 `Record<sid, ModelSel>`）→ 会话最后一条 assistant 消息的 model（reactive store 派生）→ 全局 recent 默认。ChatPane `onModelSelect` 附带 sid。spec：`docs/superpowers/specs/2026-09-15-per-session-model-selector-design.md`。

**Tech Stack:** SolidJS renderer（desktop 包）、electron-vite 构建。无测试框架（desktop 不在 CI）——每任务以 `npx electron-vite build` 为门禁 + 人工验证点。

## Global Constraints

- Renderer 只经 `window.api`（packages/desktop/AGENTS.md）——本改动纯 renderer，无新 IPC
- 派生优先级逐字：手选 → 会话历史 → `mafw-recent-models` 默认 → null
- `ModelSel` 形状 `{ providerID: string; modelID: string; label: string }`（与现 props.model 内联类型一致）
- 不改 ModelPicker / agentSel / gateway / SDK；不持久化手选
- 所有编辑用 Edit 工具精确替换；禁止 PowerShell 管道重写整文件（编码损坏前科，见 v4.8.0 事故）
- 提交直接 main；构建命令在 `packages/desktop/` 目录：`npx electron-vite build`（预期输出 main/preload/renderer 三段 build 完成、exit 0，timeout 300s）

---

### Task 1: ChatPane 侧 sid 透传（类型先行，独立可构建）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:97`（props 类型）、`:1484-1487`（onModelSelectWrap）

**Interfaces:**
- Produces: `props.onModelSelect: (m: ModelEntry, sid?: string) => void`（Task 2 消费）；`sidProp`（ChatPane.tsx:141 已有，`() => props.sid`）

旧调用方 MafwShell 的单参 handler 与新签名兼容（少参可实现多参类型），本任务后构建仍绿。

- [ ] **Step 1: 修改 props 类型**

`ChatPane.tsx` 行 97：

```typescript
  onModelSelect: (m: ModelEntry, sid?: string) => void
```

- [ ] **Step 2: onModelSelectWrap 附带 sid**

行 1484-1487 整体替换为：

```typescript
  const onModelSelectWrap = (m: ModelEntry) => {
    props.onModelSelect(m, sidProp())
    setPickerOpen(null)
  }
```

- [ ] **Step 3: 构建验证**

Run（workdir `packages/desktop/`）: `npx electron-vite build`
Expected: exit 0，main/preload/renderer 三段无类型错误。

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "feat(desktop): ChatPane model select passes session id"
```

---

### Task 2: MafwShell per-session 派生链

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`：`:72-73`（状态声明）、`:1806-1835`（providers 默认效果）、`:1860` 后（sessionModel 派生函数）、`:2057-2059`（onModelSelect）、`:2392`（ChatPane 渲染点）、`:2652`（UsageDock 渲染点）

**Interfaces:**
- Consumes: Task 1 的 `onModelSelect(m, sid?)`；MafwShell 内已有 `store`（createStore，含 `message: Record<string, any[]>`）、`modelGroups` memo、`currentSessionID()`（`:1789`）、`ModelEntry`（`:52` import）
- Produces: `sessionModel(sid): ModelSel | null`（本文件私有派生函数）；模块级 `type ModelSel`

- [ ] **Step 1: 替换全局信号为 per-session 状态**

行 72-73：

```typescript
  // Model selection (shared across panes; recent-models persistence below)
  const [modelSel, setModelSel] = createSignal<{ providerID: string; modelID: string; label: string } | null>(null)
```

替换为：

```typescript
  // Model selection is per-session: user picks live in modelPicks (in-memory),
  // resolution order in sessionModel() below is pick → session history → recent default.
  const [modelPicks, setModelPicks] = createSignal<Record<string, ModelSel>>({})
  const [defaultModel, setDefaultModel] = createSignal<ModelSel | null>(null)
```

并在 `ModelEntry` import 行（`:52`）之后加模块级类型：

```typescript
type ModelSel = { providerID: string; modelID: string; label: string }
```

- [ ] **Step 2: providers 默认效果改写 defaultModel**

`:1806-1835` 效果内两处：`if (modelSel() === null) {` → `if (defaultModel() === null) {`；`if (found) setModelSel(found)` → `if (found) setDefaultModel(found)`。注释 `:1806-1807` 保留。

- [ ] **Step 3: 新增 sessionModel 派生函数**

在 `modelGroups` memo（起于 `:1860`）结束的 `})` 之后插入：

```typescript
  // Per-session model resolution: user pick → session's last assistant message
  // model → global recent default. All reads are reactive sources, so memo/JSX
  // consumers re-evaluate on history or pick changes.
  const sessionModel = (sid: string): ModelSel | null => {
    const pick = modelPicks()[sid]
    if (pick) return pick
    const msgs = sid ? (store.message[sid] || []) : []
    const last = [...msgs].reverse().find((m: any) => m.role === "assistant")
    const m = last?.model
    if (m?.providerID && m?.modelID) {
      const group = modelGroups().find((g) => g.providerID === m.providerID)
      const entry = group?.models.find((em) => em.id === m.modelID)
      return { providerID: m.providerID, modelID: m.modelID, label: entry?.name || m.modelID }
    }
    return defaultModel()
  }
```

- [ ] **Step 4: onModelSelect 写 per-session pick**

`:2057-2059` 替换为：

```typescript
  const onModelSelect = (m: ModelEntry, sid?: string) => {
    const target = sid || currentSessionID()
    if (!target) return
    setModelPicks({ ...modelPicks(), [target]: { providerID: m.providerID, modelID: m.id, label: m.name } })
  }
```

- [ ] **Step 5: 渲染点改传 per-session accessor**

`:2392`（ChatPane，SplitView renderLeaf 内）：`model={modelSel}` → `model={() => sessionModel(leaf.sid)}`
`:2652`（UsageDock）：`model={modelSel}` → `model={() => sessionModel(currentSessionID())}`

- [ ] **Step 6: 构建验证**

Run（workdir `packages/desktop/`）: `npx electron-vite build`
Expected: exit 0；无 `modelSel`/`setModelSel` 残留引用（`Select-String -Path "...\MafwShell.tsx" -Pattern "modelSel"` 无命中）。

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): per-session model selection (pick -> history -> recent default)"
```

---

### Task 3: 人工验证 + 交付汇报

**Files:** 无代码改动。

- [ ] **Step 1: 桌面端人工验证点**（告知用户，可由用户执行）：①切换两个用过不同模型的会话，pill 跟随各自最后模型；②手选后发送走手选模型且 pill 固定；③split view 两 pane 独立；④新会话落到 recent 默认
- [ ] **Step 2: 汇报**：commit 哈希 + 构建结果（用户偏好的显式记录；本改动无新增自动化测试——desktop 无 test script）
