# MAFW Desktop 界面美化 — 设计文档

> 日期：2026-08-03
> 权威规范：《MAFW界面美化-开发文档.md》（仓库根目录，v2 含双主题 §3.4）
> Tasks 面板内部规格见《任务列表面板组件-开发文档.md》

## 1. 目标

将 MAFW Desktop 按《MAFW界面美化-开发文档.md》v2 全量重构：四阶背景分层 + 品牌绿收口 + 六阶文字 + 双主题（跟随系统 + 手动覆盖）+ 分区改造（标题栏/导航/侧栏/会话 Tab/聊天/工具块/Tasks/Composer）+ 动效与滚动条。

一次全量落地，按文档 §7 验收。

## 2. 主题机制（文档 §3.4）

- **CSS 变量两套值**：`:root` 暗色（默认，文档 §3.1–3.3）+ `[data-theme="light"]` 亮色（§3.4 表）+ `@media (prefers-color-scheme: light)` 下的 `:root:not([data-theme])`。
- **切换**：标题栏右侧日/月按钮，两态 toggle；写入 `html[data-theme]` + `localStorage('mafw-theme')`；无手动选择时跟随系统（媒体查询自动响应）。
- **`color-scheme: dark|light`** 同步声明（原生滚动条/表单跟随）。
- **v2 token 同步覆盖**：暗/亮两套变量同时覆盖 `--v2-background-bg-*`、`--v2-border-*`、`--v2-text-*` 等，让 session-ui 气泡、ButtonV2 等组件跟随全量主题化。
- **迁移**：全仓搜索替换硬编码色值（已定位约 25 处：Rail.tsx、TaskPanel.tsx、Dashboard.tsx、Graph.tsx、TriagePage.tsx、MafwToolCards.tsx、mafw.css），禁止写死白透明度类（`bg-white/[.x]`），一律 `var(--...)`。

## 3. 分区改造（文档 §4）

| 分区 | 要点 |
|------|------|
| 4.1 标题栏 | 底 `--bg-base`、高 38px、MAFW 13px/600、绿点 glow-accent 脉动 2s、日/月切换按钮 |
| 4.2 导航 | 分段 pill 组（高 44px、icon 15px + 13px/500、圆角 8px）；激活 `--accent-dim` 底 + `--text-1` + icon 染 `--accent`；计数徽章 |
| 4.3 侧栏 | 宽 264px；HISTORY 分组头（12px/600 大写 + 计数 + hover 折叠/搜索）；工作区文件夹行 32px；会话行 36px + 20px agent 图标位；**选中 = 2px `--accent` 指示条 + `--bg-hover` 底**（去整条绿底）；Manager 徽章降级中性 11px；日期分组（>20 条 今天/昨天/7月）；底部状态条 32px |
| 4.4 会话 Tab | 高 36px；tab 10px 圆角小卡 `--bg-overlay`（激活）/透明 hover `--bg-hover`；agent 色点 + 名称 + hover ×；"+" 24×24 |
| 4.5 聊天 | 底 `--bg-raised`；消息列 max-width **760px** 居中、水平 padding 32px；Agent sticky 头（20px 圆头像 `--accent-dim` + 名称 15px/600 + 运行状态绿点）；行内代码 12.5px mono `--bg-overlay`；**工具块卡片化**（`--bg-overlay` + 圆角 10 + 头部 32px + 计数徽章 + chevron 折叠，子行缩进线 + hover）；用户气泡 16/16/4/16 圆角、max-width 70%、`--bg-overlay`；间距 user→agent 24px / 同角色 8px |
| 4.6 Tasks | **悬浮输入框上方 12px**、同宽（760px 对齐）；`--bg-float` + `--shadow-float` + 圆角 16 + 右侧辉光；有任务滑入（translateY 8px + fade 200ms）；全部完成 5s 折叠为摘要（"✓ 3 tasks · 42s"）；消息列表底部预留 padding = 面板高 + 12px |
| 4.7 Composer | `--bg-float` + 圆角 16 + 1px 边框；聚焦绿描边 `rgba(63,208,122,.35)` + 外圈 3px 光晕；最小 52px / 最大 200px 自动生长；**Send 主按钮：`--accent` 底 + `var(--on-accent)` 文字**（注意：文档 §4.7 写 `#0C0C0E` 是暗色值，实现用 `--on-accent` 保证亮色正确）；空输入 40% 透明；快捷键提示 `⏎ Send · ⇧⏎ New line` |
| 4.8 全局 | 8px 滚动条 thumb `rgba(255,255,255,.09)` hover .16；选中文本绿 20%；焦点环 2px 绿 40%（仅 focus-visible）；动效 ≤300ms 无回弹；数字 tabular-nums |

## 4. 落地文件

- `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css` — 主题层（暗/亮变量 + v2 覆盖 + media）、全部分区样式
- `MafwShell.tsx` — 标题栏日/月按钮 + 主题状态（localStorage/data-theme）、会话 Tab 小卡化、聊天布局（760px）、Tasks 悬浮布局、Composer
- `components/Rail.tsx` — 264px、分组头、agent 图标位、选中指示条、Manager 徽章降级、日期分组
- `components/TabStrip.tsx` — 导航 pill 组 + 计数徽章
- `components/TaskPanel.tsx` — 悬浮定位适配、5s 折叠摘要、亮色辉光变量
- 工具块卡片化 — scoped CSS 覆盖 session-ui 工具块（mafw.css）

## 5. 验证

- 构建通过（gateway 无关，仅 desktop HMR）
- 文档 §7 全量验收（含 6 项双主题：亮色四阶背景、默认跟随系统、localStorage 覆盖重启保持、亮色交互清晰）
