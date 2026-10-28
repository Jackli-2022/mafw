# Desktop 右键菜单重构设计（2026-10-28）

状态：待评审（builder check 前）
范围：`packages/desktop` 渲染层右键菜单 + 区域动作表
依据：
- `docs/research/2026-10-28-desktop-context-menu-research.md`（现状与缺陷）
- `docs/research/2026-10-28-context-menu-industry-logic.md`（业界语法与五家证据）

## 1. 问题

1. 14 个对象区域里 9 个没有任何自定义菜单，右键落到 Electron 原生菜单；原生菜单只知道剪贴板与网页元素，不知道光标下是会话、文件、页签还是消息，因此给不出对象动词。
2. 已有 5 张菜单是手写数组、两套实现（`MafwContextMenu` 与直接使用 `@mafw/ui/context-menu`），没有共享模型；`danger` 字段无样式、Automations 重复 Disable、Approvals 标签乱码、Triage 缺项、中英混排。
3. 右键与行内 `⋯` 不是同一张表：LeftDock 用 `dispatchEvent(new MouseEvent("contextmenu"))` 伪造事件，SessionStrip 的 `⋯` 是另一套会话列表。

## 2. 目标 / 非目标

### 目标

- 用一套**菜单模型**覆盖所有对象区域，动词按「主动词 → 组织 → 定位/打开方式 → 取出 → 破坏」分组排序。
- 范围 = `packages/desktop` 渲染层 + **最小的 SDK/preload 增补**（只补网关已有路由的薄封装）；**不新增 gateway 路由**。需要新网关能力的动词进「后续清单」，不进 v1 菜单。
- 右键与 `⋯` 永远同表；支持键盘（Shift+F10 / ContextMenu 键）。
- 输入框、可编辑区、文本选区的右键**保持系统原生**。
- 修复第 1 节列出的全部缺陷；菜单标签集中管理，不再中英混排。
- 菜单构建是**纯函数**，每个 surface 有单测；渲染层薄。

### 非目标

- 不替换 `electron-context-menu`（它继续负责输入框/选区/图片）。
- 不做空白区域的全局菜单（新建/粘贴/设置）。
- 不做菜单内搜索、超过 2 层的子菜单。
- 不做会话 Pin/Archive（gateway 无此能力，另立项）。
- 不做文件重命名/删除（无 fs 写 API）。
- 本批不做菜单的插件扩展（dsh 式 slot），只预留 surface 注册点。

### 反目标

- 不为每个页面复制一份「功能清单」式大菜单。
- 不让右键成为某个动作的唯一入口（可见按钮与菜单必须并存）。
- 不在菜单里放跨对象动作（例如会话行菜单里出现「打开设置」）。

## 3. 核心决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 对象容器用渲染层 Kobalte 菜单；输入/选区用 Electron 原生 | 原生不知道对象；自绘能拿到 Solid 状态与主题 |
| D2 | 每个 surface 一个 `build*Menu(target)` 纯函数，输出 `MenuModel` | 可单测、可排序断言、可被 `⋯` 与右键共用 |
| D3 | 统一渲染器 `<ContextMenu model={…}>`；旧 `MafwContextMenu items` 先适配后删除 | 迁移期不破坏 5 处调用 |
| D4 | `target` 显式传对象（session/file/message/tab/goal/…），不传闭包数组 | 菜单内容可被测试与审计 |
| D5 | 标签集中在 `context-menu/labels.ts`（中文），key 前缀 `menu.*` 预留 i18n | 当前 MAFW 渲染层无 i18n 使用；先集中，后翻译 |
| D6 | 破坏性动作 `danger: true` + 调用方确认；标签带 `…` | 与业界一致（Delete… / Export…） |
| D7 | webview 右键走主进程原生 `Menu.popup`，复用同一份 item 数据 | `<webview>` 没有 DOM contextmenu 事件；样式差异可接受 |
| D8 | 菜单在打开时构建，不做缓存；单次构建 O(10) | 避免订阅与失效问题 |
| D9 | `MenuItem.id` 必填、`onSelect` 可选；提供 `serializeMenu(model)` 去掉闭包 | webview 原生菜单需要跨 IPC；只序列化 browser surface |
| D10 | 原生菜单优先级：可编辑、有文本选区、图片、链接 → 原生；其余对象容器 → 自绘 | 避免一次右键弹两张；用 `electron-context-menu` 的 `shouldShowMenu` + guard 双保险 |
| D11 | 键盘：给列表行/页签/卡片补 `tabIndex=0` + focus-visible；Shift+F10 / ContextMenu 键打开**当前焦点元素**的菜单；不做 roving 方向键 | 全量补 roving 是大工程，超出本批；焦点可见是硬要求 |

## 4. 架构

### 4.1 文件布局

```
packages/desktop/src/renderer/mafw/context-menu/
  types.ts          MenuModel / MenuItem / MenuTarget 联合类型
  labels.ts         全部菜单文案（中文），导出 const L = {...}
  surfaces.ts       Surface 常量 + target 类型守卫
  build.ts          buildMenu(surface, target): MenuModel（分发到各 builder）
  builders/
    session.ts      会话行 / 页签
    project.ts      项目行
    message.ts      消息 / 代码块
    file.ts         文件路径 / 文件树 / 编辑器页签
    terminal.ts     终端
    browser.ts      浏览器
    panel.ts        执行/审阅面板行
    card.ts         Goal / Memory / Notes / Approvals / Triage / Automations
  guard.ts          shouldUseNativeMenu(event): boolean
  render.tsx        <ContextMenu model={…}> 统一渲染器
  context-menu.css  danger / shortcut / group / icon 样式
  build.test.ts     各 surface 的项与顺序
  invariants.test.ts 四段式与数量约束的元测试
  guard.test.ts     原生回落判定
```

与现有组件的关系：

- `components/MafwContextMenu.tsx` 保留为兼容层：`items: ContextMenuItem[]` → `MenuModel`，内部改用 `render.tsx`；新代码不再使用。
- `IconRail` / `LeftDock` / `SessionStrip` 直接使用 `render.tsx`（去掉手写 `ContextMenu.Content`）。
- 新区域只在容器上挂 `onContextMenu` + 一个 `⋯`（如需要），两者调用同一个 builder。

### 4.2 数据模型

```ts
export type MenuItem =
  | { type: "item"; id: string; label: string; icon?: string; shortcut?: string;
      disabled?: boolean; disabledReason?: string; danger?: boolean;
      onSelect?: () => void }
  | { type: "separator"; id?: string }
  | { type: "submenu"; id: string; label: string; icon?: string; items: MenuItem[] }
  | { type: "group"; id: string; label: string; items: MenuItem[] }
  | { type: "checkbox"; id: string; label: string; checked: boolean; onSelect?: () => void }
  | { type: "radio"; id: string; label: string; checked: boolean; onSelect?: () => void }

export type MenuModel = {
  surface: Surface
  items: MenuItem[]
  /** 打开来源，用于测试与埋点 */
  from: "contextmenu" | "ellipsis" | "keyboard"
}

/** 去掉闭包，供主进程构造原生菜单；点击后按 id 回投渲染层。 */
export function serializeMenu(model: MenuModel): SerializedMenu
```
```

约束（`invariants.test.ts` 强制）：

- 分隔线 ≤ 2；每组 ≤ 7 项；子菜单深度 ≤ 1。
- `danger` 项必须位于最后一个分隔线之后。
- 弹确认/对话框的动作标签以 `…` 结尾；不弹的不加。
- 同一模型内 `id` 唯一。

### 4.3 渲染器

```tsx
<ContextMenu model={model()} from="contextmenu">
  <div onContextMenu={…}>…</div>
</ContextMenu>
```

- 内部用 `ContextMenu`（Kobalte）的 `Content`，逐类型渲染 item/submenu/group/checkbox/radio。
- `Content` 挂 `data-component="context-menu-content"`（`@mafw/ui` 既有样式）+ 本地 `context-menu.css` 补 `danger`、shortcut 列、icon 槽。
- `disabled` 项用 `ContextMenu.Item disabled`；`disabledReason` 渲染为 `ItemDescription`（现有组件支持）。
- 键盘：Kobalte 自带方向键/Enter/Esc；额外在容器上监听 `Shift+F10` 与 `ContextMenu` 键，以当前焦点行作为 target 打开。

### 4.4 原生回落（guard）

```ts
export function shouldUseNativeMenu(e: MouseEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return true
  // 可编辑区 / 显式逃生口 / 媒体与链接
  if (el.closest("input, textarea, [contenteditable='true'], [data-native-menu]")) return true
  if (el.closest("img, video, audio, a[href], [data-slot='message-part-path']")) return true
  // 文本选区（消息容器内）
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed && el.closest("[data-message]")) return true
  return false
}
```

- 容器 `onContextMenu` 第一行：`if (shouldUseNativeMenu(e)) return`（不 preventDefault）。
- 主进程侧给 `electron-context-menu` 传 `shouldShowMenu: (e, p) => p.isEditable || p.selectionText.length > 0 || p.mediaType === "image" || !!p.linkURL`，与渲染层 guard 同义，双保险避免「一次右键两张菜单」。
- 重命名态、编辑器正文、composer、消息选区、图片、链接因此继续走 Electron 原生。
- `[data-native-menu]` 作为显式逃生口（例如未来的富文本嵌入）。
- **注意**：`session-ui` 目前只有 `SessionTurn` 根上有 `data-message`（`session-turn.tsx:429`），助手文本没有独立标记。v1 允许在 `session-ui` 做**纯增量**标记（`data-message-role`、`data-file-path`），不改变渲染结构与样式。

### 4.5 webview

- 主进程监听 guest `webContents.on("context-menu")`，通过 IPC 请求渲染层提供 `MenuModel`（browser surface），主进程 `Menu.buildFromTemplate` + `popup`。
- 菜单项与渲染层浏览器菜单同源（同一个 `buildBrowserMenu`，序列化后走 IPC）。
- v1 先做 `后退/前进/刷新/复制链接/在系统浏览器打开`；元素点选已在 BrowserDock 头部有按钮，菜单里可选加。

## 5. 区域动作表（v1）

> 图例：✅ 现有能力可直接用；🔧 需新增 IPC/渲染层小改；⛔ 本批不做。

### 5.1 会话行（左 dock 树）与会话页签（顶部）

| 序 | 项 | 段 | 可用性 |
|---|---|---|---|
| 1 | 打开 | A | ✅ |
| 2 | 重命名 | B | ✅ 行内改名 |
| 3 | 分叉会话 | B | ✅ `sessions.fork`（以当前会话为源） |
| 4 | 导出 Markdown… | D | ✅ `export-markdown` |
| 5 | 复制会话 ID | D | ✅ |
| — | — | — | — |
| 6 | 关闭页签（仅页签） | E | ✅ |
| 7 | 删除会话… | E | ✅ 现有确认 |

差异：页签有「关闭页签」，行有「删除会话…」；两者共用 1–5。

### 5.2 项目行（左 dock 项目 switcher）

| 序 | 项 | 段 | 可用性 |
|---|---|---|---|
| 1 | 新建会话 | A | ✅ |
| 2 | 在文件管理器中显示 | C | ✅ `revealPath` |
| 3 | 复制项目路径 | D | ✅ |

「关闭项目…」需要新的登记表移除路由，**v1 不做**（列入后续清单）。

### 5.3 聊天消息

| 序 | 项 | 段 | 可用性 |
|---|---|---|---|
| 1 | 复制文本 | D | ✅ |
| 2 | 复制为 Markdown | D | 🔧 复用 export 的 turn 序列化 |
| 3 | 引用到输入框 | A | ✅ `formatQuote` + composer 插入 |
| 4 | 从此处分叉（仅 user） | B | ✅ `sessions.fork(messageID)` |
| 5 | 朗读（仅 assistant 且有 TTS 能力） | A | ✅ VoiceSession |

- **「编辑并重发」v1 不做**：`sessions.revert` 会截断该消息之后的全部历史、且不回滚工作区文件，语义需要单独拍板（仅末轮？是否含文件？是否确认？）。列入后续清单。
- 文本选区右键不弹本菜单（guard）。
- 消息容器右键 > 有选区/图片/链接时原生；无选区时本菜单。

### 5.3b 代码块

| 序 | 项 | 段 | 可用性 |
|---|---|---|---|
| 1 | 复制代码 | D | ✅ |
| 2 | 复制为 Markdown | D | ✅ |

识别：`pre > code`（session-ui markdown 渲染产物）；菜单挂在 `pre` 上。

### 5.4 文件路径（聊天中的文件）

**触发对象（v1 明确三类）**

1. tool card 里的路径 `[data-slot="message-part-path"]`（已是独立 span）；
2. markdown 里的**非 http(s) 链接**（相对路径/绝对路径，渲染为 `<a href>`）；
3. markdown 行内代码中「看起来像路径」的片段——**v1 不做**（误判成本高）。

实现：session-ui 做纯增量标记（`data-file-path={rel}`、`data-file-root`），desktop 用事件委托挂菜单；根路径取**会话的 directory**（worktree 会话=worktree 目录），不取项目 benchRoot。绝对路径或越出根的路径隐藏「在编辑器中打开」。

| 序 | 项 | 段 | 可用性 |
|---|---|---|---|
| 1 | 附加到输入框 | A | ✅ composer-insert |
| 2 | 在编辑器中打开 | A | ✅ `requestOpenEditor`（仅根内相对路径） |
| 3 | 用…打开 ▸（系统默认 / VS Code / Cursor / Zed） | C | 🔧 `openPath(path, app)` 已有；四项固定，不做探测 |
| 4 | 在文件管理器中显示 | C | ✅ `revealPath` |
| 5 | 复制 ▸（绝对路径 / 相对路径 / 文件名） | D | ✅ 根+rel 可拼 |

### 5.5 文件树行

| 序 | 项 | 段 | 可用性 |
|---|---|---|---|
| 1 | 打开 | A | ✅ |
| 2 | 预览 | A | ✅ fileOpenPlan |
| 3 | 附加到输入框 | A | ✅ |
| 4 | 在文件夹中显示 | C | ✅ `revealPath` |
| 5 | 复制 ▸（相对路径 / 绝对路径 / 文件名） | D | ✅ |

### 5.6 编辑器 / 预览页签

| 序 | 项 | 段 | 可用性 |
|---|---|---|---|
| 1 | 关闭 | E | ✅ |
| 2 | 关闭其他 | E | 🔧 |
| 3 | 关闭右侧 | E | 🔧 |
| 4 | 复制路径 | D | ✅ |
| 5 | 在文件夹中显示 | C | ✅ |

### 5.7 终端

| 序 | 项 | 段 | 可用性 |
|---|---|---|---|
| 1 | 复制（有选区） | D | ✅ xterm selection |
| 2 | 粘贴 | A | ✅ PTY 输入 |
| 3 | 全选 | D | ✅ |
| 4 | 清屏 | A | ✅ ANSI |
| 5 | 在外部终端打开 | C | ✅ |
| — | — | — | — |
| 6 | 关闭终端 | E | ✅ |

### 5.8 浏览器

| 序 | 项 | 段 | 可用性 |
|---|---|---|---|
| 1 | 后退 / 前进 / 刷新 | A | ✅ |
| 2 | 复制链接 | D | ✅ |
| 3 | 在系统浏览器打开 | C | ✅ |
| 4 | 点选页面元素 | A | ✅ G2 |

### 5.9 执行 / 审阅面板行

**执行类行（子代理 / 后台任务 / 轨迹回合）**

| 序 | 项 | 段 | 可用性 |
|---|---|---|---|
| 1 | 打开会话 | A | ✅ |
| 2 | 复制 ID | D | ✅ |
| 3 | 终止（后台/子代理） | E | ✅ `tasks.cancel` |

**审阅类行（改动文件）**

| 序 | 项 | 段 | 可用性 |
|---|---|---|---|
| 1 | 打开 | A | ✅ |
| 2 | 在文件夹中显示 | C | ✅ |
| 3 | 复制 ▸（相对路径 / 绝对路径 / 文件名） | D | ✅ |

diff **行/hunk** 级菜单（撤销此 hunk 等）**v1 不做**；现有行内批注按钮保留。

### 5.10 卡片类

**Goal 卡**：查看详情（A）→ 在时间线打开（A）→ 复制 Goal ID（D）→ — → 暂停（B，仅运行中）→ 取消…（E）。

> `Resume` 现状是**静默 200 no-op**（gateway `GoalControlAction` 无 `RESUME` 分支）。v1 不显示 Resume，并把 Dashboard 现有项移除；等网关补上再恢复。

**Goal 泳道格**：打开会话（A）→ 重跑此节点…（A，confirm）→ 复制产物路径（D）。

**Memory 卡**：复制摘要 / 复制全文（D）→ 固定/取消固定（B，`/api/memory/pin` 已有，需补 SDK/preload 薄封装）→ 设为便签/续期/下架（B）→ — → 删除…（E）。

**Notes 卡**：续期（B）→ 下架（B）→ — → 删除…（E）。

**Approvals 卡**（按卡片类型分表）：

- *提问卡*：批准（A）→ 拒绝（A）→ 复制问题（D）。
- *权限卡*：允许一次（A）→ 始终允许（A）→ 拒绝（A）→ — → 记此前缀 / 记此工具（B）→ 复制命令（D）。

**Triage 卡**：确认（A）→ 建议确认（A）→ 建议拒绝（A）→ 查看 Goal（C）→ — → 忽略…（E）。

**Automations 卡**：启用/停用（B）→ 复制规则 ID（D）→ — → 删除…（E，gateway 有 DELETE，需补 SDK/preload）。

> 「立即运行」只有 MCP 工具、没有 HTTP 路由，**v1 不做**。

> 说明：批准/拒绝是「对对象的主动词」，不做 danger 色；只有删除/取消/终止/忽略这类不可逆或需确认的项用 danger。

## 6. 视觉与交互规范

- 分组：最多 3 组；组间 1 条分隔线；不出现连续两条分隔线。
- 项高 28px；图标 14px；右侧快捷键 11px `--text-4`；danger 用 `--danger` 文本色 + hover `--danger-dim`。
- 子菜单：`Copy ▸`、`Open in ▸`、`用…打开 ▸`，只在变体 ≥ 2 时出现。
- 禁用：灰 + `ItemDescription` 说明原因（如「没有未读通知」）。
- 关闭行为：选择后关闭并归还焦点到触发元素；Esc 关闭；点击外部关闭。
- 打开位置：跟随光标；超出视口时 Kobalte 翻转。
- 快捷键列只显示已注册的键，不虚构。

## 7. 缺陷修复（随迁移完成）

| # | 缺陷 | 处理 |
|---|---|---|
| 1 | `data-danger` 无样式 | `context-menu.css` 增加 `[data-danger]` 规则 |
| 2 | Automations 重复 Disable | 重写为「启用/停用 / 复制 ID / — / 删除…」 |
| 3 | Approvals 标签乱码 | 进 `labels.ts`，用纯文本「批准」「拒绝」 |
| 4 | Triage 菜单缺项 | 补齐三档决策 |
| 5 | 中英混排 | 全部走 `labels.ts`（中文） |
| 6 | LeftDock `⋯` 伪造事件 | 改为 `openMenu("ellipsis")` 直接打开同一模型 |
| 7 | SessionStrip `⋯` 语义混淆 | 保留「全部会话」下拉，另加行内动作入口或仅在右键提供 |
| 8 | Dashboard `Resume` 是静默 no-op | v1 移除该项（gateway 无 RESUME 分支） |
| 9 | 原生菜单与自绘菜单可能同时弹 | 主进程 `shouldShowMenu` + 渲染层 guard 双保险 |

## 8. 测试策略

仓库现状：桌面测试是 `node --test` + `@mafw/test-shim`，只跑 `.test.ts`（无 `.test.tsx`）。因此：

1. **纯函数单测**：每个 `build*Menu` 断言 `id` 序列、分隔线位置、danger 位置、禁用条件、子菜单。
2. **元测试 `invariants.test.ts`**：对所有 surface × 典型 target 跑约束（≤7 项/组、深度 ≤1、danger 最后、省略号规则、id 唯一）。
3. **guard 单测**：输入框/选区/`data-native-menu` 返回 true；普通容器返回 false。
4. **CSS 契约测试**（仿 `composer-toolbar-css.test.ts`）：断言 `[data-danger]`、`context-menu-shortcut` 等选择器存在；防止再次「写属性没样式」。
5. **接线契约测试**：grep 式断言各组件使用 `buildMenu` 而非手写数组（防止回潮）。
6. **序列化测试**：`serializeMenu` 输出不含函数、id 与渲染模型一一对应；webview 点击 id 能回投到同一个 builder 的 item。
7. GUI 冒烟：每张菜单逐项点击路径 + 键盘 Shift+F10 + 输入框原生菜单不被夺 + 消息/图片/链接只弹一张。

## 9. 迁移顺序

| 阶段 | 任务 | 验收 |
|---|---|---|
| T1 | types / labels / build 框架 / renderer / guard / CSS / 元测试 | 现有 5 张菜单能等价迁移，单测绿 |
| T2 | 迁移 IconRail / LeftDock / SessionStrip / Dashboard / Memory / Approvals / Triage / Automations，修 9 个缺陷 | 菜单行为不回退，danger 可见，无重复项 |
| T3 | 文件路径菜单 + 文件树行 + 编辑器页签 | 三个区域右键可用；与 `@` 文件引用、编辑器打开联动 |
| T4 | 聊天消息 + 代码块菜单 | 选区仍原生；复制/引用/分叉/朗读可用 |
| T5 | 终端 + 浏览器（含 webview 原生菜单接管） | 无双层菜单；复制/粘贴可用 |
| T6 | 面板行 + Goal 泳道格 | 打开会话/终止/重跑可用 |

每阶段独立可发布；T1 是硬前置。

## 10. 风险

| 风险 | 缓解 |
|---|---|
| 右键抢走文本选区菜单 | guard + 单测 + GUI 冒烟；`data-native-menu` 逃生口 |
| webview 双层菜单 | 主进程 `context-menu` 事件里 `preventDefault` 并只弹我们的菜单 |
| 菜单位置被 dock 裁切 | 一律 Portal 到 body（现有做法） |
| `⋯` 与右键模型不一致 | 同一 builder；接线契约测试 |
| 删除类动作误触 | danger + 确认；菜单不直接执行不可逆操作 |
| 标签再次散落 | `labels.ts` 单一来源；接线测试禁止组件内写死 `label:` |

## 11. 留给 builder 的决定（我的建议，不阻塞）

- `icon` 是否首批全加：建议先用现有 `@mafw/ui` icon 家族，缺的宁可不放。
- 文件路径「用…打开」的编辑器列表：先固定 `系统默认 / VS Code / Cursor / Zed`，不做探测。
- 消息菜单是否包含「朗读」：建议有 TTS 能力时才显示。
- 菜单项 hover 是否显示描述行：仅在 `disabledReason` 时显示，避免菜单变高。

## 12. Builder check 决议（2026-10-28）

> 评审提出 7 个会改变计划的问题；以下为裁决（不阻塞实现），已回写进上文表格。

| # | 问题 | 裁决 |
|---|---|---|
| 1 | 需要网关/SDK 的动词怎么处理 | **范围锁在 desktop + 最小 SDK/preload**（只薄封装已有路由）：Memory pin、Automations delete 可做；「关闭项目」「立即运行」「Goal Resume」无路由/无分支，**v1 不做**，进 §13 |
| 2 | 非可聚焦行如何支持键盘 | 给列表行/页签/卡片补 `tabIndex=0` + focus-visible；Shift+F10 / ContextMenu 键对**焦点元素**打开；不做 roving 方向键（后续） |
| 3 | 「聊天文件路径」是哪个 DOM 对象 | v1 只认三类中的两类：tool card 路径 `[data-slot="message-part-path"]` 与 markdown 非 http 链接；行内代码**不做**。允许 session-ui 做纯增量标记（`data-file-path`/`data-file-root`），根取会话 directory |
| 4 | 「编辑并重发」的破坏语义 | **v1 不做**（revert 会截断后续历史且不回滚文件）；保留复制/引用/分叉/朗读。语义选项进 §13 |
| 5 | 原生菜单与自绘菜单谁赢 | 可编辑/选区/图片/链接/媒体 → 原生；其余对象 → 自绘。主进程 `shouldShowMenu` + 渲染层 guard 双重保证；不允许两张同弹 |
| 6 | 哪些 surface 进 v1 | 代码块单独一张（复制代码/复制为 Markdown）；diff hunk 不做；执行行与审阅行分表；Approvals 提问卡与权限卡分表 |
| 7 | MenuItem 是否可序列化 | **id 必填、onSelect 可选** + `serializeMenu`；只有 browser surface 走原生菜单，点击 id 回投渲染层 |

## 13. 后续清单（v1 明确不做）

| 项 | 原因 | 需要什么 |
|---|---|---|
| 编辑并重发 | revert 语义破坏性未定 | 仅末轮？含文件回滚？确认文案？ |
| 会话 Pin / Archive | gateway 无能力（G7） | 会话级元数据 + 列表分组 |
| 关闭项目 | 无登记表移除路由 | 新 gateway 路由 + 当前项目/打开页签的处理规则 |
| 自动化「立即运行」 | 只有 MCP 工具，无 HTTP 路由 | 新路由（是否遵守 auto_confirm 待定） |
| Goal Resume | `GoalControlAction` 无 RESUME 分支，当前是静默 no-op | 恢复入口节点定义 + watchdog 交互 |
| 文件重命名 / 删除 | 无 fs 写 API | fs 写 IPC + 回收站语义 |
| diff hunk 菜单 | 现有行内批注按钮已覆盖 | 撤销 hunk / 复制 diff 的交互设计 |
| 菜单插件扩展（dsh slot） | 本批只做框架 | surface 注册表 + 用户/插件命令 |
| roving 方向键导航 | 键盘可达先用 tab 保底 | 列表组件的统一焦点模型 |
