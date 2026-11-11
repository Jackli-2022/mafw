# Project Agent Workbench Plan D1 — 右工作台 Context Shell（2026-11-11）

## 范围

- 本地 `main`，未 push
- Spec：`docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md` §5.1/§5.3/§8.2
- Plan：`docs/superpowers/plans/2026-11-11-project-agent-workbench-shell-ia.md`
- 架构现状：`docs/architecture/desktop.md` §「右工作台 Context Shell」

## 提交

| commit | 内容 |
|---|---|
| `21ed643f` | Plan D1 文档 |
| `ab28999e` | `workbench-context.ts`：project / goal / content / review + 旧 B1 view 迁移 |
| `852521d1` | Focus 快照加入 context / executionOpen |
| `8b4dd29e` | 右工作台改为 Context Shell：移除四个 L1 Tab、Goal 独立上下文、执行抽屉、内容/审阅归位、CSS 与测试迁移 |

## 行为变化

- 右侧不再显示 `工作 / 工作台 / 执行 / 审阅` 四个一级按钮；顶部只有上下文（项目 / Goal / 内容 / 变更审阅）、返回、文件入口、执行抽屉与 Focus。
- 项目上下文只显示项目工作概览；打开 Goal 进入独立 Goal 上下文，`GoalDetailPanel` 按 Goal keyed 重挂。
- 内容上下文保留 `文件 / 浏览器 / 终端 / 插件` 二级 surface；项目头「文件」直接进入项目文件。
- 从 Goal 结果打开本版文件，内容头返回优先回到原 Goal（`contentReturnGoalId`），不是一律回项目。
- 执行详情进入右侧抽屉，`概览 / 待办 / 子代理 / 后台 / 轨迹 / 团队` 不再占一级导航。
- 旧 `mafw-workbench-view` 自动迁移到 `mafw-workbench-context`；旧 `execution` 回落到项目上下文，不自动打开抽屉。

## 验证

- desktop 全量 **3329/3329**（690 suites）
- `npx tsgo --noEmit -p tsconfig.json` rc=0
- `electron-vite build` rc=0
- 实机 dev 冒烟：
  - 项目上下文：header `项目` + `文件` + `执行`，无 4 个 L1 Tab；截图 `.mafw/qa/plan-d1-shell.png`
  - Goal 上下文：header 为 Goal 标题，GoalDetailPanel 顶部可见；截图 `.mafw/qa/plan-d1-goal.png`
  - 内容上下文：header `内容`，L2 `文件 / 浏览器 / 终端`，项目文件树可见；截图 `.mafw/qa/plan-d1-content.png`
  - 执行抽屉：分区概览 + 关闭；截图 `.mafw/qa/plan-d1-exec.png`（调试重绘版 `.mafw/qa/plan-d1-exec-debug.png`）
- 实机发现并修复：执行抽屉首帧在 Electron+CDP 下可能未重绘 → 加 `will-change: transform` + `mafw-drawer-in` 动画；项目头部同时显示 `项目文件` 两次 → context label 改为 `内容`，作用域由 `ContentScopeHeader` 单独显示。

## 后续

Plan D2/D3 仍需处理：项目首页文件树/最近内容、Pod 降为项目属性、按验收/阅读/修改三意图重排内容面、Goal 详情阶段 Tab 清理。本轮只交付 shell IA，不宣称完成 spec 全量体验。
