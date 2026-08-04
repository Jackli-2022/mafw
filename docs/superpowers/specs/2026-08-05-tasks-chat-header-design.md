# Tasks 迁入聊天头部行（ChatHeader + TaskBar + TaskList）— 设计文档

> 依据：MAFW界面美化-开发文档.md §4.5/§4.6（v3.1）、任务列表面板组件-开发文档.md §4.4（v2.4）、MAFW界面美化-整改文档.md（v3.1 注）。
> 核心改判：Tasks 从"Composer 上方面板"迁入**聊天头部行**——ChatHeader（Agent 头 + TaskBar 指示条）+ TaskList 单例（popover/dock/overlay 三态），常态成本 = 0。
> 已确认决策（brainstorming）：省略 inline 形态；PopoverShell 扩展 below-center 锚定；仅任务维度状态点；全部完成延迟 3-5s 隐藏；Ctrl+J 输入聚焦跳过；本轮不实现拖拽排序。

---

## 1. 架构

```
MafwShell
├─ ChatHeader（改造 .mafw-session-titlebar，sticky 40px）
│    Agent 头像 + 标题 + 分隔线 + <TaskBar> (flex-1) + 状态点 + 下缘细线 + done/total 徽章
├─ <TaskList placement>（单例）
│    placement: 'popover'（默认）| 'dock'（Pin 右栏）| 'overlay'（<1200px dock 变体）
├─ todos + taskMetrics（现有数据源不变）
└─ placement 状态机（MafwShell 内）
     placement: 'bar' ↔ 'dock'（localStorage('mafw-tasks-placement')）
     listOpen: boolean（bar 态列表开/关；dock 态恒开）
     Ctrl/Cmd+J、Pin/关闭按钮、Esc/点外部
```

组件：
- **TaskBar**（新，`components/TaskBar.tsx`）：单行指示条，props `{todos, tokens, started, open, onToggle, onPin}`；无任务返回 null
- **TaskList**（重构 TaskPanel → `components/TaskList.tsx`）：props `{todos, tokens, started, placement, onClose, onPin}`
- **ChatHeader**：MafwShell 内 `.mafw-session-titlebar` 结构改造（不拆独立文件）
- **PopoverShell**：扩展 `anchor: 'below-center'`（下方 2px 居中，碰撞翻转）
- 删除 `.mafw-tasks-float`（Composer 上方容器）与旧外壳样式

## 2. ChatHeader + TaskBar 规格

**ChatHeader（sticky 40px）**
```
[◉] Agent 标题    │  [⏳ 当前任务…  ████░ 2/5  1m23s  ▾]    [3/5]
 └20px头像 └15px/600      └ 14px 分隔线 └── TaskBar (flex-1) ──┘ └done/total徽章
```
- 结构：20px 圆形头像（`--accent-dim` 底 + glyph）+ 标题 15px/600 `--text-1` + **14px 分隔线**（1px `--border-subtle`）+ TaskBar（flex-1）+ **done/total 徽章**（`--bg-overlay` 圆角 999px，任务 >0 时）
- 下缘：**2px `--accent` 圆角细线**（有任务时）替代 1px border-subtle；保留 12px 渐变遮罩
- **状态点**：busy 且（无任务 或 dock 态）→ `✔ Running` 12px `--accent-text`；空闲不显示
- 移除旧 "Running" 徽章（`mafw-session-status`，与 TaskBar spinner 语义重复）
- **无任务形态 = `[◉] Agent 标题`**：纯头像 + 标题，无分隔线/TaskBar/徽章；busy 时右侧 `✔ Running`

**TaskBar**
- 无任务 → `null`
- 内容：状态图标（running = 12px spinner / 最后 completed = ✔）+ 当前任务文本 13px `--text-1` truncate + 优先级小图标（high = 11px `--warning`）+ `n/N` 11px `--text-3` + 进度条（48×3px，`--pill` 底 + `--accent` 填充，<640px 视口隐藏）+ 耗时 11px `--text-4` + chevron 9px（列表开时 180°）
- button 形态：hover `--hover` 圆角 6px；点击 / Ctrl+J → 开 popover
- 状态：run 开始淡入（200ms）；**全部完成** → 耗时归零、细线收起、`✔ 全部完成（N/N）` → 3-5s 自动隐藏；点击提前收起
- 当前任务 = running 第一条，无 running 则最后一条 completed

## 3. TaskList + placement

**TaskList（重构自 TaskPanel）**
- **popover**（bar 默认态）：锚定头部行下方 2px 居中（宽 `min(560px, 100%-32px)`，`--bg-float` + 圆角 12px + `--shadow-float`）；Header 44px（Tasks 13px/500 + 指示 pill（耗时·tokens）+ `n/N` + **?? Pin** 22×22 + 关闭 22×22）；列表 `max-height: 320px` 内滚 + 密度模型；Esc / 点外部关闭
- **dock**（Pin 态）：右 320px 平铺 `--bg-base`、左缘 1px 分隔线、无辉光/阴影/圆角；Header 44px + 关闭按钮（= 回归 bar）；`flex-1` 全高内滚 + 密度模型全展开；指示条收回、头部行右侧 busy 时 `✔ Running`
- **overlay**（视口 <1200px 时 dock 变体）：absolute 右侧全高浮层 + `--shadow-float`；点外部/Esc 关闭
- 密度模型 §9.1：>4 任务时 completed 折叠「✔ N 个已完成」、running/failed 全可见、pending 显前 2（有 running）/3（无）、底部「还有 N 个待执行」、展开后内滚；≤4 全平铺
- 行渲染：pending 空心圆 `--text-3` / running spinner `--accent` / completed 绿勾 `--accent` + 删除线（70% 透明）/ failed ✗；priority high 11px `--warning` 小图标；ToolChip；新行入场 200ms fade；无 grab 图标

## 4. 状态机与快捷键

```
bar（默认）──点击 TaskBar / Ctrl+J──▶ popover 列表开
   ▲                                  │
   │ ◀── Esc / 点外部 / 关闭 ─────────┘
   ├─?? Pin ───────────────────────▶ dock（指示条收回）
   └─（dock）关闭 / Ctrl+J ────────▶ 回归 bar
```
- 持久化：`localStorage('mafw-tasks-placement')`；listOpen 不持久化
- Ctrl/Cmd+J：INPUT/TEXTAREA 聚焦跳过；bar 态 toggle listOpen，dock 态回归 bar
- overlay 自动判定：dock + <1200px → overlay 渲染（不改存储值，resize 实时切换）

## 5. 数据流与迁移

- 数据源不变：`todos[sid]` + `taskMetrics()`；TaskBar/TaskList 纯展示
- TaskPanel → TaskList 迁移：计时器冻结 ✓、密度折叠 ✓、行样式 ✓；grab 图标 ✗、5s 自动折叠 ✗（换 TaskBar 延迟隐藏）、卡片外壳 ✗（按 placement 渲染）
- 清理：`.mafw-tasks-float`、`--tasks-glow` 引用、旧 `mafw-task-panel` 外壳；turn-container `padding-bottom: 48px` 保留（jump-latest 让位，非 tasks 预留）
- PopoverShell 扩展 below-center（复用翻转/Esc/外部点击/Portal/主题变量）

## 6. 验收与边界

- 常态成本 = 0：无任务头部行 = `[◉] Agent 标题`
- 任务进行中：TaskBar 嵌入头部行 flex-1，不占额外行；下缘 2px accent 细线
- 全部完成：`✔ 全部完成（N/N）` → 3-5s 自动隐藏
- popover 锚定/关闭/Pin/dock/overlay/Ctrl+J/localStorage 记忆全部可用
- 密度模型默认 ≈5 行；双主题 tokens
- 边界：多会话 todos 隔离；TaskBar 单行 truncate 不增高头部行；overlay 与 popover 不并存；会话 busy 无任务 = 头像+标题+`✔ Running`
- 纯前端改动（gateway 不动）
