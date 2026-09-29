# Desktop 布局开关重构设计（dock tabs 归位 + 左右栏统一开关）

日期：2026-09-29 · 状态：已获用户批准（设计层面）· 调研：`docs/research/2026-09-29-desktop-topframe-layout-research.md`（前序）；本轮业界惯例（VS Code/Cursor 布局开关簇、Lucide panel-*、Fluent NavigationView、Notion `»/«`）见 §1

**关系**：本设计**部分回退** `docs/superpowers/specs/2026-09-29-desktop-topframe-design.md` 的 Task 2 产物（dock tab 图标组入顶行），并把 rail 的折叠/展开入口与轨迹入口统一为顶行两端的布局开关。

## 1. 业界惯例（调研结论要点）

- **双栏并存时，开关成组**：VS Code/Cursor/Windsurf 把 Primary Side Bar / Panel / Secondary Side Bar 三个开关相邻放在标题栏**右端、紧邻窗口控制**（`titlebarPart.ts`：先 rightContent 工具栏、后 window-controls）。
- **图标语汇**：圆角方框 + 区域表示；**填充=可见 / 描边+分隔线=隐藏**（Codicon `layout-sidebar-left` ↔ `layout-sidebar-left-off`；Lucide `panel-left` ↔ `panel-left-close`）。图标随状态**换字形**（不是仅改可见性）。
- **tooltip**：`Toggle Primary Side Bar` / `Toggle Secondary Side Bar`（+ 快捷键）；aria 层面用 pressed/toggled 语义。
- **快捷键**：`Ctrl/Cmd+B` 左栏、`Ctrl+Alt+B` 副栏（VS Code 文档）。
- **单左侧栏**应用通常把开关放**左上**（Fluent NavigationView 汉堡、Notion）；本应用左右并存，但用户选定**分居两端**（左开关在顶行最左，右开关在窗口控制左）。
- 本仓库 `packages/ui/src/components/icon.tsx` **已内置** `layout-left-full|partial`、`layout-right-full|partial`（填充程度区分），无需新画图标。

## 2. 目标布局

```
┌─────────┬───────────────────────────────────────────────────────┐
│ Rail头:  │ [◧ 左栏开关] 会话 tab …          [右 dock 开关 ◨][窗口控制] │ 38px 顶行
│ MAFW品牌 ├────────────────────────────────────┬──────────────────┤
│ +主题切换 │ main（chat / 各页面）              │ RightDock        │
│ 项目切换行 │                                   │ [5 tabs]   ✕     │
│ Rail体   │                                   │                  │
└─────────┴────────────────────────────────────┴──────────────────┘
```

## 3. 决策表

| # | 问题 | 决策 |
|---|------|------|
| Q1 | 顶行开关摆位 | **分居两端**：左栏开关在顶行最左，右 dock 开关在窗口控制左侧 |
| Q2 | 右开关点击语义 | **开/关 + 记住上次 tab**（复用既有 `mafw-right-dock-tab` 持久化；不带 tab 参数） |
| Q3 | dock tab 位置 | **回到 dock 内部**（`TabsV2` pill 五 tab），tab 只切换不关闭，关闭仅靠 ✕ |
| Q4 | 快捷键 | 加 `Ctrl+B`（左栏）/ `Ctrl+Alt+B`（右 dock），输入框聚焦时跳过 |

## 4. 具体改动

1. **`RightDock.tsx`**：恢复内部 tab 条（`TabsV2` + `TabsV2.List`，五项 任务/轨迹/用量/便签/改动，pill），恢复 `tab`/`onTab` props；**头行容器类名保持 `.mafw-right-dock-head` 不变**（避免又一次改名 churn，CSS 只按 `[data-component="tabs-v2"]` 选择器命中子元素）；✕ 关闭保留
2. **`mafw.css`**：恢复被删的 `.mafw-right-dock [data-component="tabs-v2"]…` 三条规则（Task 2 移除的那组，可从 `git show b3fc0c35^` 取原文）
3. **删除 `DockTabButtons.tsx`** 及其测试断言；顶行不再渲染 dock 图标组
4. **新增顶行两端开关**（`MafwShell.tsx` 内联或小组件）：
   - 左：`Icon name={railCollapsed() ? "layout-left-partial" : "layout-left-full"}`，`onClick=applyRailCollapsed(!railCollapsed())`，tooltip `显示/隐藏侧边栏 (Ctrl+B)`，`aria-pressed`
   - 右：`Icon name={rightDockOpen() ? "layout-right-full" : "layout-right-partial"}`，`onClick=applyRightDock(!rightDockOpen())`，tooltip `显示/隐藏面板 (Ctrl+Alt+B)`，`aria-pressed`
   - 两者均 `ButtonV2 variant="ghost" size="small"`，接入既有 no-drag 契约（`.mafw-topstrip button`）
5. **Rail 瘦身**：删除 `.mafw-rail-collapse`（chevron-left 折叠箭头）与其 `onToggleCollapsed` 调用；删除折叠态 `.mafw-rail-collapsed` 里的展开按钮；删除 rail nav 的「轨迹」项与 `onOpenTrajectory` 接线
6. **快捷键**：全局 `keydown`——`Ctrl+B` → 切左栏；`Ctrl+Alt+B` → 切右 dock；`e.target` 为 INPUT/TEXTAREA/`contentEditable` 时跳过（与已有 Ctrl+O 细节档位同款守卫）
7. **不动**：rail 品牌行（logo/状态点/主题切换）、`.mafw-topstrip` 拖拽区与双击守卫、会话 tab 恒显、窄屏 dock overlay（`top:38px`）、dock 统一宽度记忆

## 5. 保留行为清单

- rail 折叠时宽度 32px、`mafw-rail-collapsed` 持久化键 `mafw-rail-collapsed` 不变（仅入口迁移到顶行开关）
- dock 宽度记忆 `mafw-right-dock-width`（统一宽度）、tab 记忆 `mafw-right-dock-tab`、开合记忆 `mafw-right-dock-open`
- dock 内 tab 切换不改变开合状态（原行为）
- 会话 tab 的双击重命名/右键菜单/新建、双击守卫排除 `.mafw-session-tab`

## 6. 测试

- 设计契约（`tests/design-contract.test.ts`）：
  - `RightDock.tsx` 含 `TabsV2` 与五个 tab 值；`onTab` prop 恢复
  - `DockTabButtons.tsx` 不存在；`MafwShell.tsx` 不含 `<DockTabButtons`
  - 顶行含 `layout-left-full|partial` 与 `layout-right-full|partial` 两个开关（源码断言 + `aria-pressed`）
  - `MafwShell.tsx` 含 `Ctrl+B` / `Ctrl+Alt+B` 键位分支
  - `Rail.tsx` 不含 `mafw-rail-collapse`、NAV 表不含 trajectory；`onOpenTrajectory` 已移除
- 既有受影响的 topframe 断言更新（顶行内容断言从「含 DockTabButtons」改为「含两个布局开关」）
- 全量 `bun test` + typecheck + `electron-vite build`；CDP 实测：顶行左/右开关点击切栏、dock 内 tab 切换、快捷键、记忆值仍生效

## 7. 非目标（YAGNI）

- 不做 VS Code 的「Customize Layout」下拉（多出第三个按钮）
- 不做活动栏左右位置切换（本应用 rail 恒在左）
- 不做图标动画/过渡
- 不引入第三方图标包（复用内置 icon 集）
