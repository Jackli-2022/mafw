# Rail 重设计（ChatGPT 式对话列表）— 设计文档

日期：2026-09-01
状态：已与用户确认方向（方案 A + 三处迭代：折叠箭头右置图标化、Manager 沉底固定区、ASCII 定稿）

## 背景与问题

现 Rail（`opencode-dev/packages/desktop/src/renderer/mafw/components/Rail.tsx`）是伪树结构（History → 项目名 → 会话），存在：

**逻辑问题**
1. Rail 与 MafwShell 各拉一份会话数据，刷新靠 `sessionRefreshKey` prop 人肉 bump（已发生过陈旧列表事故）
2. 按 created 排序，最近活跃的旧会话沉底
3. 日期分组仅在 >20 条时出现，列表形态随数量跳变
4. 50 条硬截断，无搜索、无加载更多，1996 条真实历史看不到
5. Manager 行过滤逻辑（role + managerSessionId + 目录三重匹配）是数据补丁
6. 空标题显示截断 session ID
7. 无重命名/删除

**视觉问题**
- 字母方块图标 1996 行全是灰块，零信息量
- 树缩进 + 双 folder 图标浪费横向空间
- 大写 HISTORY 标题 + 计数徽章是文件树语言
- footer "◀ 折叠侧边栏" 文字条非标准

## 目标 / 非目标

**目标**：ChatGPT 式扁平对话历史列表；统一数据层；按最后活跃排序；固定日期分组；搜索；加载更多；hover 行内操作；项目 switcher；折叠箭头右置图标化；Manager 沉底固定区。

## 非目标

虚拟滚动库引入（客户端分页足够）；Cmd+K 命令面板；会话置顶/文件夹（业界有 Starred/Pinned/Projects 区，属增量功能，列 backlog）；gateway 侧过滤逻辑变更（已完成：worker/子代理已在 `/api/sessions` 隐藏）。

## 业界共识对照（2026-09 调研）

调研对象：ChatGPT、Claude、Kimi、Cursor、Linear、Slack、Open WebUI/LibreChat。
共识采纳：扁平无树、updated 倒序、固定日期分组、New 置顶、顶部搜索+键盘导航、hover ⋯、背景高亮、空标题兜底、图标化收起（右置，Claude/Kimi 式）、行内无时间戳、无计数徽章、无限滚动。
分歧自选：项目切换采用 **Claude 式顶部下拉**（MAFW 的项目=工作区，Slack workspace 模式也收敛于此）；分组头 sticky 保留为增强。
Backlog：Pinned/Starred 区、Cmd+K 全局面板、manager busy 状态点。

## 布局定稿（ASCII）

```
┌──────────────────────────────────┐
│ ▾ opencode-plugin-mafw        ◀  │  ← switcher 左 · 折叠箭头右（常驻图标按钮）
│ ┌──────────────────────────────┐ │
│ │ + New session                │ │  ← 置顶显式按钮
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ 🔍 Search chats…             │ │  ← TextInputV2
│ └──────────────────────────────┘ │
│ ══════ 滚动区 ══════════════════ │
│ 今天                             │  ← sticky 分组头，固定出现
│  config页面修改记忆系统模型        │  ← active：背景高亮（无 inset 阴影）
│  关于 gateway 的简短询问      ... │  ← hover 行尾浮 ⋯
│ 昨天                             │
│  SDK 插件切换与前端方案           │
│ 8月                              │
│  …                               │
│         [ 加载更多 ▾ ]           │  ← 默认 100 条，每次 +200
│ ══════ 固定区（flex-shrink:0）═══ │
│ ◆ Manager                ● idle  │  ← 永不随列表滚动，上方会话再多也钉底
│ ◎ UsagePill                      │
│ ⚙ Settings                       │
└──────────────────────────────────┘

折叠后：内容区左上角浮 ▶ 图标按钮（现有 .mafw-rail-expand 样式复用）。

switcher 下拉（点击项目行弹出）：
┌──────────────────────────────┐
│ ✓ opencode-plugin-mafw       │  ← 当前项打勾；选择即 setCurrent + 重拉
│   gateway                    │
│   desktop                    │
└──────────────────────────────┘
项目行 hover 右侧 ⋯ 菜单：Set as current / Copy path（沿用现有 ContextMenu 项）。
```

## 数据层：`session-store.ts`（新文件）

位置：`renderer/mafw/session-store.ts`。单例 signals store，Rail 与 MafwShell 共用，消灭双份 fetch。

```ts
// 核心 API（Solid signals）
export const sessionStore = {
  sessionsFor(projectID: string | null): SessionInfo[]   // 读（响应式）
  isLoading(): boolean
  invalidate(projectID?: string): void                   // 失效 → 重拉（SSE 重连等）
}
```

- 内部 `Map<projectID, { list, fetchedAt }>` 缓存；`sessionsFor` 惰性触发拉取（ Solid effect 风格）
- 拉取 = `window.api.mafw.sessions.list(projectID)`（gateway 已过滤 worker/子代理，store 不再做业务过滤）
- 排序统一在 store：`time.updated || time.created` 倒序
- 空标题在 store 层补 `"New conversation"`（消费端无需各自兜底）
- MafwShell 的 SSE `onopen` 从 `setSessionRefreshKey(k => k+1)` 改为 `sessionStore.invalidate()`；`sessionRefreshKey` 信号**本次直接删除**（评审确认全部 5 处调用点一并迁移：onopen + createSession×2 + closeSession×2）
- `gateway.info()`/`onStateChange` ready 时自动失效重拉（Rail 现有逻辑迁入 store）

## 分组 / 搜索 / 分页规则

1. **分组固定出现**（不再依赖数量）：今天 / 昨天 / 过去 7 天 / 按月；跨年月份带年份（如 `2025年12月`）。分组头 sticky（业界多为非 sticky，此项为无害增强）。
2. **分页**：默认渲染最近 100 条；**滚动到底自动加载**（IntersectionObserver 触发，每次 +200；业界主流为无限滚动），"加载更多"手动按钮保留为兜底。分组按当前已渲染集合计算。
3. **搜索**：客户端 `title.toLowerCase().includes(q)`，作用于全量数据（1996 条内存过滤 <5ms）。搜索激活时忽略分页上限，结果显示最多 200 行 + 尾部提示"仅显示前 200 条结果"；无结果空态 "No chats found"。搜索词非空时不显示"加载更多"。**键盘导航**：↑↓ 在结果间移动高亮、Enter 打开、Esc 清空并退出搜索；`Ctrl+K`（Cmd+K）聚焦搜索框。
4. **Manager 与孤儿 manager**：永不进入 History 列表（`metadata.mafw.role === 'manager'` 一律排除）。
5. **行内不渲染时间戳**（业界共识：hover TooltipV2 提供完整时间即可）。

## 行设计

- 高度 32px；纯标题省略；无图标、无缩进、无字母方块
- hover：背景 `--hover`；行尾浮 `⋯`（DropdownMenu/ContextMenu）
- active：`--hover` 背景 + 文字 `--text-1`（去 inset box-shadow）
- ⋯ 菜单项：Open / Rename / Delete / Copy session ID
  - **Rename**：调 gateway 新增的 `PATCH /api/sessions/:id`（转发 serve 的 session 更新 title），成功后 `invalidate()`
  - **Delete**：调 gateway 新增的 `DELETE /api/sessions/:id`（**真转发** serve 原生 `DELETE /session/:id`——现有 `/api/session/:id` 路由是 SPA 回退假 200，必须新路由），成功后：若删除的是 active session，清空 activeTab 回 welcome；`invalidate()`
  - Delete 需 `confirm()` 二次确认（遵循桌面 Config 页惯例）

## Manager 固定入口（沉底）

- 位置：滚动区与 footer 之间的**固定区**（`flex-shrink: 0`），列表再长也不滚动
- 内容：`◆ Manager` + 状态点（idle/busy；busy 判定本期可先只显示 idle，数据来源 manager session 的 SSE 事件，非本期范围则恒 idle）
- 点击行为同会话行（`onSelectSession(id, 'Manager', true)`）
- `managerSessionId` prop 保留（MafwShell 传权威 id）；无权威 id 时该行隐藏

## 项目 switcher 与折叠

- 顶部一行：左 = switcher（当前项目名 + ▾），右 = 折叠箭头 `◀`（24px 图标按钮，常驻，hover 背景；不用文字）
- switcher 下拉：项目列表（复用 ContextMenu 或 DropdownMenu，滚动区 max-height ~320px），当前项打勾；选择 → `projects.setCurrent(worktree)` + store 失效重拉
- 折叠：`onToggleCollapsed` 既有回调；折叠态左上角浮 `▶`（现有 `.mafw-rail-expand`）
- "All projects" 列表区与 footer "◀ 折叠侧边栏" 文字条删除

## gateway 侧新增（前置依赖）

1. `DELETE /api/sessions/:id` → `opencodeClient` serve 原生 `DELETE /session/:id` 转发（注意路由正则带 `(?:\?|$)` 惯例，§6.5）
2. `PATCH /api/sessions/:id` `{ title }` → serve session 更新转发
3. 两者均要求 `sessionApi` 能力，缺能力 503；带单测（routes 层 deps 注入）
4. SDK `gateway-sdk`：`sessions.remove(id)` / `sessions.rename(id, title)` + preload `mafw-api.ts` 暴露

## 错误与空态

- gateway 不可达 / 拉取失败：滚动区显示 "Gateway offline"（弱化文案，非报错弹窗）
- 无会话："No sessions yet"（保留）
- 搜索无结果："No chats found"

## 样式约定

- 侧栏宽度：现默认 **264px**（`MafwShell.tsx:1554`，用户可拖拽）已处共识 240-260 区间，**不改**（修订：原"200→240"基于 AGENTS.md 过时描述）
- 行字号 12 → **13px**（行高 32px 保持；业界 13-14px/28-36px）
- `mafw.css` rail 段重写：删除 `.mafw-rail-tree` / `.mafw-agent-icon` / `.mafw-rail-manager-label` / `.mafw-rail-collapse-bar` / `.mafw-rail-project-list`；新增 switcher 行、搜索框、加载更多、固定区样式；**保留 `.mafw-rail-settings-bar` 基础样式**（sticky 改 static）；删除 :2351 重复的 `.mafw-rail-scroll` 定义
- 遵守 §5.10：TextInputV2（搜索/行内重命名）、ContextMenu/DropdownMenu（菜单）、TooltipV2（`openDelay: 300`）、禁裸 `<button>`/`<input>`
- **Electron 无 `window.prompt`**：重命名用行内 TextInputV2 编辑行实现（`window.confirm` 可用于删除确认）

## 验证清单（手动 + 自动）

- gateway：新增 DELETE/PATCH 路由单测（deps 注入，沿用 routes 测试模式）；340 测试基线不回归
- desktop：typecheck 通过
- 手动：分组正确（今天/昨天/7天/月/跨年）；updated 倒序；加载更多翻页；搜索过滤与空态；重命名后列表即时更新；删除 active 会话回 welcome、删除普通会话列表刷新；项目切换列表随动；折叠/展开；Manager 沉底不随滚动；worker/子代理会话不出现

## 风险

- serve DELETE/PATCH 权限语义（session 删除可能触发 permission 流程）——实现时验证，失败显式 toast
- 1996 条 × ~300B ≈ 700KB IPC 单次传输——首拉可感知但一次性，缓存后无成本；若卡顿再加批量（本期不做）
- MafwShell 2200 行文件内改动需克制，只动 historySessions 接线与 onopen
