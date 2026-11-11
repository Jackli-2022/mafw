# Project Agent Workbench Plan D2 — 项目首页与团队属性（2026-11-11）

## 范围

- 本地 `main`，未 push
- Spec：`docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md` §5.1/§5.2/§5.3/§6.1/§7.5
- Plan：`docs/superpowers/plans/2026-11-11-project-agent-workbench-project-home.md`
- 架构现状：`docs/architecture/desktop.md` §「项目首页与团队属性」

## 提交

| commit | 内容 |
|---|---|
| `fb76b5a5` | Plan D2 文档 |
| `c9e6ebd7` | `recent-content.ts`：按项目持久化的最近内容模型 |
| `f9746f59` | `dir-watch-pool.ts`：文件树目录监听引用计数，`FilesDock` 接入 |
| `5fc18a7d` | 项目首页「项目文件 / 最近内容」+ `openProjectFile` 项目 scope 路由 |
| `b0bdddcf` | 项目团队条；删除左栏 Pod face；IconRail 团队快捷入口 |

## 行为变化

- 项目首页新增项目名与团队条，主体改为两栏：左侧「项目文件」树 + 下方最近内容，右侧「全部 Goal」。两栏占满工作台高度，左栏内部滚动；容器 < 980px 时上下堆叠。团队条是分隔线而不是卡片，避免首页出现多块并排盒子。
- 项目文件树固定在项目主目录 scope。即使当前内容 scope 是某个 Goal revision，从项目首页点文件也会回到项目根，并清空 `contentReturnGoalId`。
- 最近内容按项目持久化，最多 8 条；打开文件后立即出现在列表顶部，刷新/重启后恢复。
- 项目首页树与内容工作台树可同时挂载；目录 watcher 按 `(root, rel)` 引用计数，不再出现一方卸载导致另一方停止刷新。
- 左栏只剩会话/搜索/便签三个 face；旧 `pod` face 自动回落 `sessions`。
- 图标轨 Pod 目的地改为「团队」快捷入口：打开项目首页并滚动到团队条，保留 attention badge 与结果圆点。
- 团队条提供 Lead / Tech Lead / 团队 / 邮箱 / 记忆入口；团队细节（成员、邮箱、共享记忆）仍在执行抽屉的 `PodDock`。

## 验证

- desktop 全量 **3343 / 3343**，691 suites
- `npx tsgo --noEmit -p tsconfig.json` rc=0
- `electron-vite build` rc=0
- 实机 dev 冒烟：
  - 项目首页：项目名 + 团队条 + 项目文件 + 最近内容；截图 `.mafw/qa/plan-d2-project.png` / `plan-d2-recent.png`
  - 从最近内容打开 `AGENTS.md`：上下文 `内容`、scope `项目文件`、L2 `文件 / 浏览器 / 终端`；截图 `.mafw/qa/plan-d2-content.png`
  - 团队「团队」动作打开执行抽屉的 `PodDock`，当前上下文仍为项目；截图 `.mafw/qa/plan-d2-team.png`
- DOM 冒烟确认：左栏图标 aria-label 不再有 `Pod`，改为 `团队`；`mafw-rw-tabs` 数量为 0。

## 后续

Plan D3 仍需处理：跨重启的树展开/滚动/草稿持久化、Goal revision 最近项、按「验收 / 阅读 / 修改」三种意图重排内容面、Goal 详情注意力顺序与阶段 Tab 清理。D2 只交付项目首页与团队归位，不宣称 spec 全量体验完成。
