# 2026-11-19 · MemoryPage 移到右工作台

- **版本**：`v5.1.0`（桌面交互变更，不升版本号）
- **提交**：`789a0929e` + `8bb462830`
- **范围**：desktop 右工作台 focus / scene tab / MemoryPage compact；gateway / runtime 契约零改动
- **依据**：dev app live 验证（chat 760 + 右 dock 1052，紧凑页正常）

## 问题

- `MemoryPage` 原本是主区 top-level tab：`翻记忆` 直接 `setActiveTab("memory")`，
  把 chat 整体换掉。记忆是参考/上下文，看的时候不应该丢掉对话。
- 主区页面也没有独立入口（`NAV_TABS` 的 Memory 项未渲染），只有回执能到，像一个孤岛。

## 现状

- **右工作台 focus**：`memory` 成为 `SubjectRef`（`subjectKey = "memory"`），
  走 `openMemoryFocus()` → `revealWorkbench()` + `openSceneTab({ kind: "memory" })` +
  `openSubject(...)`；不再切主区 `activeTab`。
- **scene tab**：`scene:memory` 持久化 tab，label「记忆」，icon `memory`（渲染为 `brain`）；
  切换项目后可恢复。
- **FrameBar**：crumbs 为 `项目 / 记忆`（scope 不再显示「项目文件」）。
- **MemoryPage compact**：右 dock 内隐藏 `PageHeader`（FrameBar 已有面包屑），
  保留 Knowledge / Episodes、搜索、分布徽标、L5 与卡片；`is-compact` 负责 12/14px 内边距与滚动。
- **回执链接**：`翻记忆 →` 仍然 `stopPropagation` + 关闭浮层，然后打开右 dock；
  chat 保持可见，浮层不会留在屏幕上。
- 主区 `activeTab() === "memory"` 分支移除；回执成为唯一的记忆入口。
- 命令面板的「记忆」也改走 `openMemoryFocus()`，不再 `nav("memory")` 切旧主区路由。

## 验证

- 新增 **6** 条单测：focus-model memory subject 1 条、scene-tabs memory id/defaults 1 条、
  memory-dock wiring 3 条（MafwShell / FocusStage / MemoryPage compact）、
  stage-dispatch memory 1 条。
- desktop 全量：**4197 pass / 0 fail**（基线 4191）。
- `tsgo --noEmit -p tsconfig.json`：通过。
- `electron-vite build`：通过（1m 7s）。
- live：点「翻记忆 →」后 chat 仍为 760×1066；右 dock 1052×1066，`.mafw-memory-page.is-compact`
  存在、`.mafw-mem-tabs` 存在，crumbs 为 `opencode-plugin-mafw / 项目 / 记忆`，浮层关闭。
