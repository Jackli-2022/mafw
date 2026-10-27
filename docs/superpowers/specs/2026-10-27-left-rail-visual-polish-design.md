# 左侧 Rail 视觉与功能整理设计

日期：2026-10-27
状态：产品已批（mockup 收敛版，视觉伴侣 `leftrail-20261027`）；spec 待 builder check
前置调研：`docs/research/2026-10-27-left-rail-visual-polish-research.md`（视觉诊断 + 六家功能按钮调研，commits `b1a1a599` / `ca7d2ea7`）

## 1. 意图与为什么

用户对左侧 rail 的抱怨是「看到就难看」，收起态 46px 图标轨最重。诊断（截图 + DOM 实测）归因三层：

1. **数据质量泄漏**：会话标题整列是 `New session - 2026-10-13T06:28:19.923Z`；当前项目名渲染成 `.`；
2. **装饰性噪音**：日期分组头被全宽横线穿过 + 常驻计数；Manager 是三行 accent 彩卡；
3. **风格断裂**：六个 rail 图标三种画法、笔重不一；主题钮是 ☀ 文本 emoji；连接点带辉光+呼吸动画；激活态（4% 透明底 + 被按钮圆角吃掉的 inset 左条）没有指示语言。

业界对标（Claude / opencode / dsh / Kimi / Codex / pi-gui，见调研 §8）给出三条硬结论：**新建常驻是 6/6 共识**；**主题按钮 6/6 无一放 rail**（全在设置里）；**opencode 去 sidebar 转 tabs 是社区反弹的反例**（sidebar 方向本身正确）。

## 2. 目标

- 收起态 rail：一个图标家族、清晰的激活语言（1a 填充块）、新建常驻、结构分组语义正确（目的地 vs meta）
- 展开态列表：标题零泄漏（ISO 兜底格式化）、分组头静音、Manager 卡降级为置顶单行、项目名兜底
- 主题切换迁入 Config 页（保留 `/theme` 命令兜底）
- 全程 TDD；desktop 全量测试 + tsgo + electron-vite build 绿

## 3. 非目标

- **不重开 faces IA**：工作/搜索/便签三面维持（2026-10-26 IA 调研定案）
- 会话状态维度（running / 待你处理分组）——业界 4/6 有，记录为后续项，本次不做
- 自动化的导航位归属（3/6 给了，维持 Dashboard，后续候选）
- 用量入口（维持执行概览，上次 IA 决定）
- 搜索框进 sessions face、行内时间戳、第四条常驻轨、1b 通栏样式、C1 无新建版——全部明确不做

## 4. 反目标

- 把 rail 变成第二套功能堆场：只允许 6 钮 + 1 badge，不新增其他目的地
- 图标继续混用多种 dialect：新图标必须进 `packages/ui` icon 表，不走组件内散置 SVG（现有 ☀/moon 内联 SVG 随主题钮一起退役）
- 视觉改动破坏现有键盘/aria 行为：tooltip、aria-label、Ctrl+B 语义全部保留

## 5. 约束（代码事实，已核实）

| 事实 | 位置 |
|---|---|
| 图标 = name→SVG path 字符串表，新增即改表 | `packages/ui/src/components/icon.tsx` |
| rail 图标钮渲染用 ButtonV2 + TooltipV2，32×32 被 ButtonV2 small 压扁需属性选择器钉死 | `IconRail.tsx` + `mafw.css:2919-2943` |
| 并行入口已有：`worktreeEnabled()`（rtCaps.worktreeApi 门）+ `createWorktreeSession` | `MafwShell.tsx:832-854`，ChatPane `onCreateWorktreeSession` 同源 |
| 主题逻辑纯函数可复用：`readSavedTheme/nextTheme/applyTheme` | `src/renderer/mafw/theme.ts` |
| ChatPane 已有 `/theme` 命令（`onToggleTheme`） | `ChatPane.tsx:1023` |
| Config 页是分节结构 | `pages/Config.tsx`（`ConfigPage` + `NavKey`） |
| Manager 卡现渲染：dot+name / phase+进度条 / relTime 三行 | `components/ManagerCard.tsx` |
| 会话标题在 `toNode` 归一（`s.title?.trim() \|\| "New conversation"`） | `components/session-tree.ts` |
| 日期分组头样式（`::after` 横线 + count） | `mafw.css:465-467` + `LeftDock.tsx` |
| CSS 整文件编辑在 Windows dev 下可能被 Vite 漏掉变更事件——验证样式前 `touch` 或重启 dev（AGENTS.md 已记） | — |

## 6. 设计决定

### 6.1 收起态 rail（产品已批，最终结构）

```text
＋ 新建会话          action 样式：accent 10% 底 + 1px dashed accent 边 + accent 图标
工作 / 搜索 / 便签    目的地组三连排（便签从底部 meta 组归位）
─── spacer ───
Dashboard            待审批红色 badge（现状保留）
Config               静音连接点
```

- **共 6 钮 + 1 badge**。主题钮删除（迁 Config）。
- **激活态（1a 填充块）**：`background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent)`，替换现有 `bg-hover + inset 2px 左条`。命中区 32→34px、圆角 8→9、gap 4→5px。
- **＋ 交互**：单击 = 新建会话（复用 LeftDock 头部同款 `props.onNewSession` 流）；右键 = ContextMenu 两项——「新建会话」「⎇ 并行 worktree」（后者调 `createWorktreeSession`，`worktreeEnabled()` 为 false 时隐藏该菜单项，与 ChatPane 并行按钮同一门）。tooltip「新建会话」。
- **图标家族**（新增到 `packages/ui/src/components/icon.tsx`，统一 1.5px 线面比）：

| 元素 | 图标 | 来源 |
|---|---|---|
| ＋ | `plus-small`（现有） | 不新增 |
| 工作 | 新增 `chat`：圆角气泡+尾巴，**无内部横线** | 参考路径见视觉伴侣 options-2/4.html |
| 搜索 | `magnifying-glass`（现有） | 不动 |
| 便签 | 新增 `sticky-note`：便利贴折角 | 同上 |
| Dashboard | 新增 `layout-grid`：2×2 圆角方块 | 同上 |
| Config | `settings-gear`（现有） | 不动 |

- **连接点**：保留 Config 角标位，5px 实心；**删除辉光 box-shadow 与 mafw-breathe 动画引用**（ready/reconnecting/starting 的颜色语义保留：accent/text-3/text-4；failed=danger；stopped=text-5）。
- **IconRail props**：`theme`/`onToggleTheme` 移除；新增 `onNewSession`、`onNewWorktreeSession?`。分组代码：`actionItems` / `destinationItems`（工作+搜索+便签连排）/ 单 spacer / `metaItems`（Dashboard+Config）。

### 6.2 展开态 dock 列表（诊断带入，方案 A 级）

> 注：产品批的是 rail；这五件是首轮「难看」诊断的组成部分（调研 §1 表 3/4/5/8/9），随本 spec 一并交付，除非产品在审阅时划掉。

1. **分组头静音**：删除 `.mafw-rail-date-group::after` 横线规则与 `mafw-rail-date-count` 计数渲染；label 11px 维持，色提到 `--text-4` 一档。
2. **标题零泄漏（产品已选 C：全覆盖）**：`session-tree.ts` 新增纯函数 `formatRailTitle(title)`——匹配 `^New session - <ISO>` 的兜底标题 → `未命名 · 10月13日`（本地日期）；空标题 → `未命名`；其余原样。**渲染层接入三处**：LeftDock 会话行、WelcomeHome 最近会话（`WelcomeHome.tsx:87/93/241` 现直接渲染原始 `s.title`）、标签页标题创建路径（rail/Welcome 打开会话传入的 title 同样过 formatter）。`toNode` 保持原始标题（`SessionNode` 增 `rawTitle` 或渲染处可取），**重命名草稿必须 seed 原始标题**——禁止把「未命名 · 10月13日」持久化成真标题。
3. **Manager 卡 → 置顶单行**（32px）：`● Manager · <phase 中文> · <relTime>`，右缘红色 pill badge（待决数，沿用现有样式），行底 2px accent 进度细线（进度语义与现卡相同）；idle 态 `● Manager · 空闲 · <relTime>`。phase 极简中文映射（`PLANNING/EXECUTING/REVIEWING/ASKING_USER` → 规划中/执行中/审阅中/待提问），未知名回退英文原文。组件重写为单行结构，CSS 收敛。
4. **项目名兜底**：新纯函数 `railProjectName(raw)`——basename 解析后为空 / `.` / 纯分隔符 → `当前项目`。LeftDock 切换器与 `.mafw-rail-project-head` 两处同源接入。
5. **chevron 后置**：项目切换器渲染顺序改为 `名字 ▾`（现状 `▾ 名字`）。

### 6.3 主题迁 Config

- ConfigPage 的 **Desktop 页**（其定位本就是「行为与外观集成」）新增内联「外观」小节：当前主题展示 + 循环按钮（复用 `toggleTheme` 语义与 `theme.ts` 纯函数）。**不新增 NavKey**（单开关不配一级导航）。
- ChatPane `/theme` 命令保留（`onToggleTheme` 接线不动）。
- IconRail 主题钮及其内联 ☀/moon SVG 删除。

### 6.4 项目名兜底（builder check 定稿）

- 纯函数 `railProjectName(raw)`：basename 解析后为空 / `.` / 纯分隔符 → 当前项目显示 `当前项目`，**非当前项目显示 `未命名项目`**。
- 接入**三处**：切换器触发条（`LeftDock.tsx:278`）、切换器下拉菜单项（`LeftDock.tsx:285`，builder 发现同样会露 `.`）、`.mafw-rail-project-head`。

### 6.5 左 dock 推挤判定：默认档 50:50 预算（产品定稿，取代初稿静态 1470）

- **规则三句话（产品定稿）**：
  1. 右侧工作台下限 520 太小，提到 **640**——与 chat 默认档拉平，这就是「50:50」；
  2. dock 推挤仅当默认配置下双方都保得住：`W ≥ 46 + dockWidth + 640 + 640`，否则**浮层**（宽度驱动、与最大化无关，B1 架构不变）；
  3. **只保证默认档**：阈值不随 chat 档位（520/760）联动——用户拉大 chat 由既有护栏钳制，不做动态阈值。
- **纯函数**：`leftDockPushBudget(dockWidth) = 46 + dockWidth + 1280`（1280 = 640 chat 默认档 + 640 工作台下限）；`WORKBENCH_MIN_WIDTH: 520 → 640`（workbench-detents.ts，chatPxForDetent 护栏随动）。旧 `LEFT_DOCK_PUSH_MIN_WIDTH` 删除。
- 数字表（dock 宽 → 阈值）：264 → **1590**；400 → 1726；180 → 1506。产品窗口 1390 → 浮层；2048 最大化 → 推挤（chat 640 / 工作台 1098 ≥ 640）；1590 恰好 640/640。
- `resolveMode` / `restoreLeftDockOpen` / `shouldAutoRestoreLeftDock` 签名改收 `dockWidth`（不收 chatDetent），budget 为单一真相；拉宽跨阈值自动恢复 open 偏好用同一 budget。
- **ResizeHandle max**：push 态拖宽上限 `leftDockPushDragMax(viewportWidth) = clamp(min(400, W − 46 − 1280), 180, 400)`，防止拖过预算点模式翻转、手柄消失。
- `effectiveLeftDockWidth` 夹紧保留为纵深防御（新规则下 push 恒满足预算，实际不再触发）。
- **预期行为变化（intended）**：①窄窗下 chat 护栏改保工作台 640（1200 窗：chat 514 / 工作台 640；旧规则 chat 634 / 工作台 520）；②chat 拉到 760 而窗口不足时被钳回 640（只保默认档）。
- 验收：1390 开 dock = 浮层且 chat 一像素不变；≥1590 开 dock = 推挤且工作台 ≥ 640；1366 全屏 = 浮层；拉宽跨 1590 自动恢复 open；workbench-detents 测试随 640 更新。

## 7. 留给 builder 的

- 新图标三条（`chat` / `sticky-note` / `layout-grid`）的最终 SVG path——spec 给了视觉伴侣里的参考 path，允许按 icon.tsx 现有条目的 viewBox/stroke 习惯微调，但三件必须同笔重同留白密度；
- ContextMenu 在 IconRail 的具体挂法（`ContextMenu` from `@mafw/ui`，与 LeftDock 会话行同款用法即可）；
- 测试文件划分与命名（建议：纯函数进 `session-tree.test.ts` / 新 `rail-display.ts` 模块同级 test；样式契约进 `tests/`；wiring 用 source contract 模式对齐仓库现状）；
- 实现顺序（建议 rail → dock → Config，每步全量测试绿）。

## 8. 验收

- TDD：新增/修改行为先有测试；
- 桌面全量 `npm test` 绿 + `tsgo -b` rc=0 + `electron-vite build` rc=0，交付时报告新增测试数与全量通过数；
- GUI 冒烟（dev app reload 后）：rail 6 钮一屏（＋/工作/搜索/便签/Dashboard/Config）；＋单击建会话、右键出两项（无 worktree 能力时只剩一项）；激活为填充块；连接点无动画；主题在 Config 可切、`/theme` 仍可用；列表无 ISO 串与空名；Manager 单行；分组头无横线无计数；
- 交付记录写 `AGENTS.md`（版本 + commit 哈希，用户惯例）。
