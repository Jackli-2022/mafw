# 会话列表（Rail）组织逻辑调研（2026-09-28）

> 目的：为桌面 Rail 从「多项目树」改回「单项目树」定逻辑。调研对象：Claude、ChatGPT/Codex、opencode、Kimi Code Desktop、Zed、Cursor、Devin/Windsurf。
> 方法：单路子代理网络调研（官方文档优先）。视觉对标见 `2026-09-28-desktop-aesthetics-competitor-research.md`。

## 跨产品收敛规则（高置信度）

1. **项目/workspace 是一级分区，会话是二级项**（Zed、Kimi、Claude Code、ChatGPT/Codex、Cursor Projects）
2. **组内按最近活动排序；置顶项浮顶并豁免时间排序**（ChatGPT pin chat/project；Kimi pin session）
3. **archive 优先于删除**，归档收进底部可恢复区（Zed、Claude VS Code、ChatGPT、Kimi）
4. **自动归档 = 无活动天数阈值，可配置/可关**（Claude VS Code 默认 14 天；Claude CLI 30 天）
5. **搜索是侧栏一等入口**，作用域可从当前项目扩展到全部项目；**标题是主键**，AI 自动生成标题普遍
6. **临时/草稿会话被隔离或排除**（incognito / side chat / temporary）；**子代理与后台任务不做顶层列表项**（在会话内展示）
7. **fork/branch 生成同级项，常折叠回原会话**（Claude CLI 折叠组、Kimi `Fork: ` 前缀）
8. **键盘 switcher 与侧栏树并存**（Zed/Claude `Ctrl+Tab`）
9. **「一窗一项目」（全局 switcher）与「单栏多项目折叠树」二选一**；**单项目树即 Kimi/Zed 的「worktree 折叠回主项目」模型**
10. **pin 只改显示位置，不改变 agent 可见上下文/权限**（ChatGPT 显式定义）

## 反模式

- 同一产品历史被拆到多个 surface 且互不可见（Claude 各端、ChatGPT vs Codex）→「会话去哪了」
- 把 subagent/后台任务当顶层会话（淹没真会话）
- 归档无可见出口（删除即丢失）
- 关键入口无默认快捷键（降低可发现性）
- 单项目/时间回溯场景照搬 Kanban/状态看板（Devin 式，过重）

## 针对本项目的可借鉴点

- **A. worktree 折叠回主项目**（Zed）：同一项目的 worktree 会话挂在项目节点下，不散成多个顶级项目
- **B. 双层 pin + pin 仅位置语义**（ChatGPT）：容器（项目）与条目（会话）都可 pin
- **C. archive-first + 可恢复归档区 + 自动归档阈值**（Zed/Claude）

## 现状与差距（v6 多项目树）

- v6 把 Rail 改成「所有项目平铺 + 各自懒加载会话」，导致：项目切换器与树重复、展开即渲染数千行（已加分页修复）、子项缩进层级弱
- 调研结论支持改回**单项目树**：全局 switcher 选项目（=「一窗一项目」），树内只组织当前项目会话

## 待定逻辑（供设计选型）

- 树形层数：`项目 → 日期组`（2 层）vs `项目 → worktree/分支 → 日期组`（3 层）
- manager 会话：独立 ManagerCard（现状）vs 树内 ★ 置顶项
- 搜索作用域：当前项目（推荐）/ 可扩展到全部项目
- 分页阈值：100 + 「加载更多」（现状已恢复）
