# Rail「指挥台」重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rail 顶部新增 Manager 状态卡片（活跃 Goal 进度 + 待决问题徽标，点击直达会话），搜索框折叠为头部图标（Ctrl+K 呼出），Manager 从底部小行移除。

**Architecture:** 纯桌面 renderer 改动，gateway 零改动。新建自包含 `ManagerCard` 组件（内部 15s 轮询 goals/questions，fail-open 降级）；`Rail.tsx` 头部行改造 + 底部清理；样式追加在 `mafw.css`。

**Tech Stack:** SolidJS + `@opencode-ai/ui/v2`（ButtonV2/TooltipV2/TextInputV2）+ Electron dev HMR。

## Global Constraints

- 禁止裸 `<button>` / `<input>`，一律 `@opencode-ai/ui/v2` 组件（ButtonV2 props: `variant="ghost"|..., size, icon, onClick`，rest 透传）
- 新 `.tsx` 文件遵循本目录惯例：文件首行 `// @ts-nocheck`（Rail.tsx / MafwContextMenu.tsx 同款）
- TooltipV2 统一 `openDelay={300}`
- 数据管道只用现有 preload API：`window.api.mafw.goals.list()`（返回 `Goal[]`，元素 `{goalId, phase, loop, currentWave, totalWaves, nextAction?, updatedAt?}`）、`window.api.mafw.questions.list()`（返回 pending 的 `QuestionRequest[]`，无 status 字段，长度即 pending 数）
- 桌面包无单测框架：每任务以 `npm run typecheck`（tsgo -b）为门禁 + 手动验证
- 所有命令在 `opencode-dev/packages/desktop` 目录执行；typecheck 失败禁止提交

---

### Task 1: ManagerCard 组件

**Files:**
- Create: `opencode-dev/packages/desktop/src/renderer/mafw/components/ManagerCard.tsx`

**Interfaces:**
- Consumes: `window.api.mafw.goals.list()`, `window.api.mafw.questions.list()`（preload 已有）
- Produces: `ManagerCard(props: Props)`，Props = `{ managerSessionId: string | null; managerUpdatedAt?: number; online: boolean; onSelectSession: (id: string, title: string, manager: boolean) => void; onOpenQuestions?: () => void }`（Task 3 消费）

- [ ] **Step 1: 创建组件文件（完整代码）**

```tsx
// @ts-nocheck
import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

const POLL_MS = 15000

const relTime = (ts?: number): string => {
  if (!ts) return ""
  const diff = Date.now() - ts
  if (diff < 60000) return "刚刚"
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${Math.floor(diff / 86400000)} 天前`
}

type Props = {
  managerSessionId: string | null
  managerUpdatedAt?: number
  online: boolean
  onSelectSession: (id: string, title: string, manager: boolean) => void
  onOpenQuestions?: () => void
}

export function ManagerCard(props: Props) {
  const [goal, setGoal] = createSignal<any>(null)
  const [pending, setPending] = createSignal(0)

  const refresh = () => {
    if (!props.online) return
    window.api.mafw.goals.list().then((goals: any[]) => {
      const list = Array.isArray(goals) ? goals : []
      setGoal([...list].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null)
    }).catch(() => setGoal(null))
    window.api.mafw.questions.list().then((items: any[]) => {
      setPending(Array.isArray(items) ? items.length : 0)
    }).catch(() => setPending(0))
  }

  onMount(() => {
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => { if (props.online) refresh() })

  const openManager = () => {
    if (props.managerSessionId) props.onSelectSession(props.managerSessionId, "Manager", true)
  }
  const openQuestions = () => {
    if (props.onOpenQuestions) props.onOpenQuestions()
    else openManager()
  }

  const progress = () => {
    const g = goal()
    if (!g || !g.totalWaves) return null
    return Math.min(100, Math.round(((g.currentWave || 0) / g.totalWaves) * 100))
  }

  return (
    <Show when={props.managerSessionId}>
      <div class="mafw-manager-card" classList={{ offline: !props.online }} onClick={openManager}>
        <div class="mafw-manager-card-head">
          <span class="mafw-manager-card-dot" />
          <span class="mafw-manager-card-name">Manager</span>
          <Show when={pending() > 0}>
            <TooltipV2 value={`${pending()} 个待决问题`} openDelay={300}>
              <span
                class="mafw-manager-card-badge"
                onClick={e => { e.stopPropagation(); openQuestions() }}
              >{pending()}</span>
            </TooltipV2>
          </Show>
        </div>
        <Show
          when={goal()}
          fallback={<div class="mafw-manager-card-idle">Idle · {relTime(props.managerUpdatedAt)}</div>}
        >
          <div class="mafw-manager-card-goal">
            <span class="mafw-manager-card-phase">{goal().phase}</span>
            <Show when={progress() !== null}>
              <span class="mafw-manager-card-progress"><span style={{ width: `${progress()}%` }} /></span>
            </Show>
          </div>
          <div class="mafw-manager-card-meta">{relTime(props.managerUpdatedAt)}</div>
        </Show>
      </div>
    </Show>
  )
}
```

- [ ] **Step 2: typecheck 门禁**

Run: `npm run typecheck`（workdir: `opencode-dev/packages/desktop`）
Expected: 无错误退出

- [ ] **Step 3: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/ManagerCard.tsx
git commit -m "feat(desktop): ManagerCard component — goal progress + pending-questions badge"
```

---

### Task 2: Rail 搜索折叠

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/Rail.tsx`（头部行 + 搜索状态）
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`（追加样式）

**Interfaces:**
- Consumes: `Icon`（"magnifying-glass"）、`TextInputV2`、`TooltipV2`、`ButtonV2`（均已 import 或可从 `@opencode-ai/ui/v2/button-v2` 引入）
- Produces: Rail 内部状态 `searchOpen()`；Task 3 在同文件继续编辑

- [ ] **Step 1: 引入 ButtonV2 + 搜索展开状态**

Rail.tsx imports 区加入（与现有 v2 import 并列）：

```tsx
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
```

`const [query, setQuery] = createSignal("")` 之后加：

```tsx
const [searchOpen, setSearchOpen] = createSignal(false)
```

- [ ] **Step 2: 头部行加搜索图标（⌕）**

现有头部（`<div class="mafw-rail-head">` 内，项目切换器 `</DropdownMenu>` 之后、折叠按钮之前）插入：

```tsx
<TooltipV2 value="Search  Ctrl+K" openDelay={300}>
  <ButtonV2
    variant="ghost"
    size="small"
    icon="magnifying-glass"
    aria-label="搜索会话"
    onClick={() => setSearchOpen(v => !v)}
    class="mafw-rail-search-toggle"
  />
</TooltipV2>
```

- [ ] **Step 3: 搜索框改为条件展开行**

删除原常驻搜索块：

```tsx
<div class="mafw-rail-search" ref={searchRef}>
  <TextInputV2 ... />
</div>
```

在 `.mafw-rail-head` 的关闭 `</div>` 之后插入展开行（Task 3 会把 ManagerCard 放它后面）：

```tsx
<Show when={searchOpen()}>
  <div class="mafw-rail-search" ref={searchRef}>
    <TextInputV2
      value={query()}
      onInput={e => { setQuery(e.currentTarget.value); setHi(-1) }}
      onKeyDown={onSearchKeyDown}
      onBlur={e => { if (!query().trim()) setSearchOpen(false) }}
      onClearClick={() => { setQuery(""); setHi(-1) }}
      leadingIcon={<Icon name="magnifying-glass" size="small" />}
      showClearButton={query().length > 0}
      placeholder="Search chats…"
      autoFocus
    />
  </div>
</Show>
```

- [ ] **Step 4: Esc 收起 + Ctrl+K 展开**

`onSearchKeyDown` 的 Escape 分支改为：

```tsx
else if (e.key === "Escape") { setQuery(""); setHi(-1); setSearchOpen(false) }
```

Ctrl+K effect 内 `searchRef?.querySelector("input")?.focus()` 改为：

```tsx
setSearchOpen(true)
setTimeout(() => searchRef?.querySelector("input")?.focus(), 0)
```

- [ ] **Step 5: 追加样式（mafw.css 末尾）**

```css
.mafw-rail-head-actions { display: flex; align-items: center; gap: 2px; }
.mafw-rail-search-toggle { opacity: 0.75; }
.mafw-rail-search-toggle:hover { opacity: 1; }
```

（若 `.mafw-rail-head` 现有布局为 flex，折叠按钮与新图标自然并排；仅需保证间距 — 以上三条即全部新增。）

- [ ] **Step 6: typecheck + 手动验证**

Run: `npm run typecheck`
Expected: 无错误

dev 模式（electron-vite dev 运行中，HMR 自动生效）验证：
1. 头部出现 ⌕ 图标；点击展开搜索框并聚焦；Esc 收起
2. Ctrl+K 呼出；失焦且无查询词时收起；有查询词失焦保持展开
3. 搜索高亮 ↑↓/Enter 导航照常

- [ ] **Step 7: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/Rail.tsx opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): rail search collapses to header icon (Ctrl+K to expand)"
```

---

### Task 3: ManagerCard 集成 + 底部清理

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/Rail.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: Task 1 的 `ManagerCard`（Props 见 Task 1 Produces）
- Produces: Rail 最终布局（头部 → [搜索行] → ManagerCard → New session → 列表 → Usage+Settings）

- [ ] **Step 1: import + 挂载 ManagerCard**

Rail.tsx imports 加入：

```tsx
import { ManagerCard } from "./ManagerCard"
```

搜索展开行 `</Show>` 之后、`<div class="mafw-rail-new">` 之前插入：

```tsx
<ManagerCard
  managerSessionId={props.managerSessionId ?? null}
  managerUpdatedAt={managerRow()?.time?.updated}
  online={gwReady()}
  onSelectSession={props.onSelectSession}
/>
```

（不传 `onOpenQuestions` → 徽标点击降级为打开 manager 会话；MafwShell 无独立 Questions 视图，spec 决策。）

- [ ] **Step 2: 删除底部 Manager 行**

`.mafw-rail-fixed` 内删除整个 `<Show when={managerRow()}>...</Show>` 块（`mafw-rail-manager-row` 那段）。`managerRow` memo 保留（ManagerCard 的 `managerUpdatedAt` 在用）。

- [ ] **Step 3: 样式（mafw.css）**

用 grep 找到 `.mafw-rail-manager-row` 与 `.mafw-rail-manager-dot` 的现有样式块并整块删除，替换为：

```css
.mafw-manager-card {
  margin: 8px 10px 4px;
  padding: 8px 10px;
  border-radius: 8px;
  border-left: 2px solid var(--accent, #6b7cff);
  background: color-mix(in srgb, var(--accent, #6b7cff) 8%, transparent);
  cursor: pointer;
  user-select: none;
}
.mafw-manager-card:hover { background: color-mix(in srgb, var(--accent, #6b7cff) 14%, transparent); }
.mafw-manager-card.offline { border-left-color: var(--border-weak, #444); background: transparent; }
.mafw-manager-card-head { display: flex; align-items: center; gap: 6px; }
.mafw-manager-card-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--success, #3fb950);
}
.mafw-manager-card.offline .mafw-manager-card-dot { background: var(--text-weak, #777); }
.mafw-manager-card-name { font-size: 12px; font-weight: 600; }
.mafw-manager-card-badge {
  margin-left: auto;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--danger, #f85149);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
}
.mafw-manager-card-goal { display: flex; align-items: center; gap: 8px; margin-top: 5px; }
.mafw-manager-card-phase { font-size: 11px; opacity: 0.85; }
.mafw-manager-card-progress {
  flex: 1; height: 3px; border-radius: 2px;
  background: color-mix(in srgb, currentColor 15%, transparent);
  overflow: hidden;
}
.mafw-manager-card-progress > span { display: block; height: 100%; background: var(--accent, #6b7cff); }
.mafw-manager-card-meta { margin-top: 3px; font-size: 10px; opacity: 0.6; }
.mafw-manager-card-idle { margin-top: 4px; font-size: 11px; opacity: 0.6; }
```

（CSS 变量名以 `mafw.css` 现有 token 为准——若上述变量不存在，回退用字面值；`var(--x, fallback)` 已带兜底。）

- [ ] **Step 4: typecheck + 手动验证**

Run: `npm run typecheck`

dev 模式验证：
1. ManagerCard 出现在 New session 上方；点击主体打开 manager 会话（chat 面板切到 manager）
2. 当前若有活跃 Goal：显示 phase + 进度条；无 Goal：显示 "Idle · xx 前活跃"
3. 底部固定区只剩 Usage + Settings；原底部 Manager 行消失
4. gateway 停止（`mafw stop` 后再 `mafw start`）→ 卡片灰点、恢复后 15s 内数据回来

- [ ] **Step 5: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/Rail.tsx opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): manager command card in rail, drop bottom manager row"
```

---

### Task 4: 回归验证 + 桌面构建

**Files:**
- 无新改动（验证任务；如验证发现回归，修复后在本任务内提交）

**Interfaces:**
- Consumes: Task 1-3 全部产出
- Produces: 构建通过的 `out/`（打包版可用）

- [ ] **Step 1: 全量手动回归清单**

1. 会话列表：右键弹菜单、左击打开、省略号弹菜单（昨日 ContextMenu 修复不回归）
2. 项目切换器下拉正常（仍是 DropdownMenu 左击展开设计）
3. 搜索：展开→输入→高亮导航→Enter 打开会话→收起
4. ManagerCard：数据/徽标/降级三态
5. Rail 折叠按钮（⇞）收展正常

- [ ] **Step 2: 构建打包产物**

Run: `npm run build`（workdir: `opencode-dev/packages/desktop`）
Expected: `built in ...` 无报错，`out/` 更新

- [ ] **Step 3: Commit（如有修复）**

```bash
git add -A opencode-dev/packages/desktop/src
git commit -m "fix(desktop): rail command-deck regressions from manual pass"
```

（无修复则跳过，不留空提交。）
