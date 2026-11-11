# Project Agent Workbench Plan C 交付记录（2026-11-11）

## 范围

- 分支：本地 `main`（未 push / 未合并到远程）
- Plan：`docs/superpowers/plans/2026-11-11-project-agent-workbench-review-items.md`
- Spec：`docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md` §9
- 架构现状：`docs/architecture/pod.md`（评审项与风险强制验收）、
  `docs/architecture/desktop.md`（结果页评审区）、`docs/reference/tools.md`
  （`mafw_pod_review_respond`）
- TDD 账本：`.superpowers/sdd/2026-11-11-project-agent-workbench-review-items/progress.md`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `16e9e4f8` | 1 | 评审项表 + store |
| `8e06960b` | 2 | 评审项状态机与人工权限 |
| `163b2001` | 3 | 路由 + 验收门 + revision 延续 |
| `ddb8059c` | 4 | 验收审计 + Tech Lead MCP 回应工具 |
| `8ab66ed6` | 5 | SDK 类型/客户端 + 契约生成 |
| `0d10dbeb` | 6 | 桌面 preload 暴露评审项 |
| `c6d07251` | 7 | 评审项模型与结果区组件 |
| `4c1f63c0` | 8 | 结果页接入 + 强制验收流程 |
| `87f45790` | 9 | 批注发送落库（失败中止发送） |
| `042bdbf7` | 10 fix | 强制验收记录在验收后仍显示 |
| `d383188a` | 10 | 架构 / 工具文档 |
| `a357c4e9` | 10 fix | 评审项 CSS 注释编码 + danger token |
| `40300f80` | 复审 | MCP 回应接线 + 批量原子性/并发锁/carry 幂等 |
| `85447a4c` | 复审 | 409 恢复 + 评审项实时刷新 + 双击去重 |
| `bbe652ad` | 复审 | 仅评审门 409 触发强制验收 + revision 透传 |
| `1f63d9ea` | 复审 | 并发发送 FIFO staging + 按 id 取批注 |
| `2b70d3d1` | 复审 | 排队中的 stage 使用发送时批注快照 |

## 行为

- 评审项由人类创建；Tech Lead 只能标记 `已回应`，`已回应` 仍算未解决。
- 普通验收在存在未解决意见时 409；强制验收必须 `force:true` +
  `riskAcknowledged:true`，记录未解决项快照但不把意见标成已解决。
- 打回开新 revision 只克隆未解决项（新行 + `originItemId`/`originRevision`，
  状态重置 `pending`）；旧 revision 证据与意见不改写。
- 已验收 revision 的评审项冻结；验收/打回期间评审写请求返回 409。
- 批注只在发送给 Goal 绑定的 Tech Lead 时落成评审项；落库失败中止发送并保留草稿，
  并发发送按 FIFO 串行，后加批注留给后一条消息。
- 桌面结果页未解决优先展示，强制验收需勾选风险确认；验收后记录与冻结状态在
  reload 后保留。

## 验证

- gateway 全量 **6324/6324**（821 suites，`--testTimeout=15000`；默认 5s 下无关的
  `checkpoint/restore-git` 用例在满载时超时，单跑 7/7 通过）
- SDK **215/215**
- desktop 全量 **3325/3325**（690 suites）
- gateway `tsc --noEmit -p` / desktop `tsgo --noEmit -p` rc=0
- gateway build / SDK build / `electron-vite build` rc=0
- 实机冒烟（一次性 git 项目，2 个 Goal）：人类创建 403、无 force 409、缺风险确认 400、
  解决/重开、revision 2 克隆未解决项（origin 指向 revision 1）、强制验收 checkbox 门、
  验收后记录与冻结、reload 持久化。截图 `.mafw/qa/plan-c-review-forced-accept.png`。
- 复审修复后新增测试：gateway +6、desktop +7；复审终局：ready to merge。

## 已知 minor（未在本轮修复）

- `pods` 路由 JSON body 上限 64KB，而评审项服务允许 50×20KB；大批量批注可能 413。
- 没有 `PodGoalService` + 真实 `PodReviewService` 的端到端「responded 阻塞验收」测试
  （两层分别有测试）。
- 部分 revision 复用不刷新既有 feedback/priority 元数据（仅崩溃重试窗口）。
- MCP `Services` 未类型声明 `podReview`/`podStore`，目前靠 wiring source gate。
- 评审项刷新依赖整个 Pod detail 变化，消息/任务更新也会触发一次 GET。
- 评审门 409 目前匹配服务端英文文案 `unresolved review items`，尚无机器可读错误码。
- 夹具已清理：临时项目/worktree、pod 目录、fixture 会话文件、DB pod/goal/revision/
  review/acceptance/trajectory/registry 条目均无残留；gateway 已重启到新构建。
