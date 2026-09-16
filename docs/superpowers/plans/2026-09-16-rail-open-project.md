# Rail 打开新项目实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rail 项目切换菜单末尾新增 `＋ 打开项目文件夹…`：原生目录选择器 → 复用 `setCurrent`（注册+切换+广播）→ 列表自动刷新高亮。

**Architecture:** main 新增本地 IPC channel `mafw-open-directory`（Electron dialog，对齐 `mafw-export-session` 先例）；preload `projects.openDirectory` 直挂该 channel；Rail 菜单项调用后走既有 `projects.setCurrent`（SDK 非 2xx throw → catch → toast）。gateway/SDK 零改动。spec：`docs/superpowers/specs/2026-09-16-rail-open-project-design.md`。

**Tech Stack:** Electron main/preload/renderer（desktop 包）。无测试框架——`npx electron-vite build` 门禁 + 人工验证。

## Global Constraints

- IPC 信封逐字：`{ ok: boolean; canceled?: boolean; path?: string; error?: string }`（对齐 export-session）
- channel 名逐字：`mafw-open-directory`
- 注册/切换只走 `window.api.mafw.projects.setCurrent(path)`（复用 SDK `project.setCurrent` → `POST /api/projects/register`），不新造注册路径
- 错误 toast 逐字：`打开失败: <message>`，duration 4000
- 所有编辑用 Edit 工具精确替换；禁止 PowerShell 管道重写整文件
- 提交直接 main；构建在 `packages/desktop/`：`npx electron-vite build`（三段完成 exit 0，timeout 300s）

---

### Task 1: main handler + preload + types（三件一体）

**Files:**
- Modify: `packages/desktop/src/main/mafw-ipc.ts`（`mafw-export-session` handler 之后，~:142）
- Modify: `packages/desktop/src/preload/mafw-api.ts:125-129`（projects namespace）
- Modify: `packages/desktop/src/preload/mafw-types.ts`（projects 类型）

**Interfaces:**
- Produces: `window.api.mafw.projects.openDirectory(): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>`——Task 2 消费

- [ ] **Step 1: main handler**

在 `mafw-export-session` handler（:142 结束的 `})`）之后插入：

```typescript
  // Open-project entry (Rail switcher): main owns the native directory picker
  // (renderer is sandboxed). Returns { ok, path } or { ok:false, canceled }.
  ipcMain.handle("mafw-open-directory", async (event: IpcMainInvokeEvent) => {
    try {
      const { BrowserWindow: BW, dialog } = await import("electron")
      const win = BW.fromWebContents(event.sender)
      const res = win
        ? await dialog.showOpenDialog(win, { title: "打开项目文件夹", properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ title: "打开项目文件夹", properties: ["openDirectory"] })
      if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true }
      writeLog("utility", "mafw-open-directory", { path: res.filePaths[0] })
      return { ok: true, path: res.filePaths[0] }
    } catch (err) {
      writeLog("utility", "mafw-open-directory failed", { err: String(err) }, "warn")
      return { ok: false, error: String(err) }
    }
  })
```

- [ ] **Step 2: preload namespace + 类型**

`mafw-api.ts` projects 块：

```typescript
    projects: {
      list: () => invoke("project", "list"),
      current: () => invoke("project", "current"),
      setCurrent: (path) => invoke("project", "setCurrent", path),
      openDirectory: () => ipcRenderer.invoke("mafw-open-directory") as Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>,
    },
```

`mafw-types.ts`：在 projects 对应类型处（exportSession 声明旁模式）加：

```typescript
    openDirectory: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
```

- [ ] **Step 3: 构建验证**

Run（workdir `packages/desktop/`）: `npx electron-vite build`
Expected: exit 0。

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/mafw-ipc.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(desktop): mafw-open-directory IPC for project picker"
```

---

### Task 2: Rail 菜单项 + 流程

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/Rail.tsx`（selectProject 后加函数 ~:215；菜单 For 后 ~:289）

**Interfaces:**
- Consumes: Task 1 `projects.openDirectory()`；既有 `projects.setCurrent(path)`（SDK 非 2xx throw `HTTP 400: ...`）；`setCurrentProject`/`sessionStore.invalidate`/`showToastV2`（均已 import）

- [ ] **Step 1: openProjectFolder 函数**

`selectProject`（:214 结束）之后插入：

```typescript
  const openProjectFolder = async () => {
    try {
      const res = await window.api.mafw.projects.openDirectory()
      if (!res?.ok || !res.path) return // canceled or picker failure (logged in main)
      await window.api.mafw.projects.setCurrent(res.path) // throws on 400 (home dir etc.)
      setCurrentProject({ worktree: res.path, id: res.path }) // optimistic highlight
      sessionStore.invalidate(res.path)
      showToastV2({ description: "项目已打开", duration: 2000 })
    } catch (e: any) {
      showToastV2({ description: `打开失败: ${e?.message || e}`, duration: 4000 })
    }
  }
```

- [ ] **Step 2: 菜单项（For 之后、Copy path 之前）**

```typescript
              <DropdownMenu.Item onSelect={() => void openProjectFolder()}>
                <DropdownMenu.ItemLabel>＋ 打开项目文件夹…</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
```

- [ ] **Step 3: 构建验证**

Run（workdir `packages/desktop/`）: `npx electron-vite build`
Expected: exit 0。

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/Rail.tsx
git commit -m "feat(desktop): open project folder entry in rail switcher"
```

---

### Task 3: 人工验证 + 交付汇报

- [ ] **Step 1: 人工验证点**（告知用户，desktop 重启生效）：①切换菜单末尾出现"＋ 打开项目文件夹…"；②点击弹系统目录选择器；③选中新目录 → 列表刷新高亮、会话列表切换；④选 home 目录 → toast"打开失败: HTTP 400..."；⑤取消 → 无操作；⑥重复打开已注册项目 → 幂等切换
- [ ] **Step 2: 汇报**：commit 哈希 + 构建结果（desktop 无自动化测试，如实说明）
