# 2026-11-16 · 左栏「团队」改为 Lead 入口

- **版本**：`v5.1.0`（交互行为修订，不升版本号）
- **提交**：`43fb88e5`
- **范围**：desktop 左 IconRail；gateway / SDK / 运行时契约零改动
- **前置**：`docs/architecture/desktop.md` 的「项目首页与团队属性」

## 问题

左栏「团队」按钮原本是 `openProjectTeam()`：打开「工作」世界总览并让团队条滚动/聚焦。
但项目级对话的入口是 Lead；用户要回到 Lead 需要另找 tab 或「返回项目 Lead」。左栏最显眼的
项目级按钮反而把用户带去团队条，入口层级不顺。

## 现状

- 左栏按钮文案改为 **Lead**，图标仍为 `team-three`。
- **左键**：`openLeadEntry()` 打开项目 Lead（切到 chat、确保 Pod、打开 Lead 会话）。
- **当前会话是 Lead 时高亮**（`leadActive={activeSessionIsLead()}`）。
- `podBadge`（人类 attention 数）与 `podResultDot`（未查看结果）保留。
- **右键**：上下文菜单 `rail.lead` → 「查看团队」，复用 `openProjectTeam()` /
  `teamFocusRequest`，打开「工作」世界总览并定位团队条。
- 团队条仍留在项目首页；只是不再是左栏左键的默认目的地。

## 测试与门禁

- desktop 全量：**3870 / 3870** pass（736 suites）
- 新增 2 个用例：
  - `rail-lead-entry.test`：左键 `onLead` / `leadActive` / 右键 `onTeam`
  - `context-menu/builders/rail.test` +1：`rail.lead` 菜单暴露 `rail.viewTeam`
- `npx tsgo --noEmit -p tsconfig.json`：仍被并行 plugin 改动阻断
  （`PluginPackagesSection.tsx` 重复 key）；本次涉及文件无类型错误。
- `npx electron-vite build`：rc=0
- 未 push、未合并远端。

## 边界

- 左栏不再有“一键滚动到团队条”；需要右键「查看团队」或从「工作」页进入。
- Lead 入口在没有项目时 toast「尚未选择项目」；没有 Pod 时会创建 Pod（与既有
  `openLeadEntry` 行为一致）。
