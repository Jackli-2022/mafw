# Workbench Stage-first Goal / Review 焦点（Plan 2）— 2026-11-12

## 范围

- Spec：`docs/superpowers/specs/2026-11-12-workbench-stage-first-design.md`
- Plan：`docs/superpowers/plans/2026-11-12-workbench-goal-review-focus.md`
- 本轮把 Goal 与评审对象接入焦点壳：Goal 总览、变更集舞台、器械栏、评审队列、评审项锚点。
- `project` / `goal` / `review` legacy context 保留；Chat 决定板、Agent/用户契约、执行作为框、完整决定记录留给 Plan 3。
- 本地 `main`，未 push。

## 提交

| commit | 内容 |
|---|---|
| `b7591b30` | Goal / review 焦点 helpers：goal scope、Goal / changeSet / reviewItem subject、lens 默认值 |
| `24367115` | 项目首页 Goal 卡与 picker Goal 项打开 Goal 焦点；框显示 Goal 标题与 revision |
| `a98f1c3c` | `ChangeSetStage` 复用 `ChangesDock`；无 diff 时明确空态 |
| `bc1d3dc3` | `InstrumentRail` + `GoalReviewQueue`；评审项 resolve / reopen 仍只由人触发 |
| `ff7cea11` | 评审项焦点携带 `rel:Lx` 锚点；`EditorDock` 打开后 `gotoLine` |
| `7da966f4` | Goal / review 焦点 wiring 与行为回归测试 |
| `53b1901d` | 最终 review 修复：reviewItem 分派到编辑器舞台、解析 Goal worktree、共享 `FocusOpenRequest`、行为级 dispatch 测试 |

范围说明：`0992909c`（动效 / 状态色）与 `9f6e79dd`（视觉语言文档）是并行落地的视觉语言工作，不属于 Plan 2；历史未改写，发布记录单独说明。

## 行为变化

- **Goal 焦点**：项目首页 Goal 卡、picker Goal 项、Goal 详情入口都经 `openGoalFocus` 进入同一焦点栈；scope 为 `goal`，subject 为 `goal`，默认 `orient` lens。
- **Goal 总览**：`FocusStage` 的 `goal` 分支复用 `GoalDetailPanel`；框显示 `Goal · rev N` 与 Goal 标题，不再隐藏在 legacy `goal` context 后面。
- **变更集舞台**：`changeSet` subject 默认 `changes` lens；`ChangeSetStage` 复用 `ChangesDock`，没有 diff 时显示「这个 revision 还没有变更」，不借用其他 session 的 diff。
- **器械栏**：Goal scope 下的 review lens / Goal subject 显示 `InstrumentRail`；评审队列来自 `pod.reviewItems`，状态权威仍在 gateway；栏在 900px 以下堆叠到舞台下方，不覆盖框。
- **评审项焦点**：队列项可聚焦为 `reviewItem` subject，默认 `decide` lens；框显示 `rel:Lx`，舞台分派到编辑器并按锚点行 `gotoLine`。
- **Goal worktree**：从 `pod.result` 读取 revision worktree，经 `fs.listDir` 探测后写入焦点 scope；不可用时回退项目目录，避免把评审锚点解析到错误 revision。
- **返回路径**：评审项 → 变更集 → Goal 总览 → 项目逐层恢复；返回时 `syncStageToFocus` 同步舞台与内容 scope。
- **legacy 不退化**：旧 Goal 详情、review context、验收按钮在非 focus 路径仍可用；`PodReviewItems` 未传 `onFocus` 时渲染与之前一致。

## 验证

- 聚焦测试：**15 / 15**（`stage-dispatch`、`goal-focus-wiring`、`review-focus-wiring`）
- desktop 全量：**3473 / 3473**，696 suites
- `npx tsgo --noEmit -p tsconfig.json` rc=0
- `electron-vite build` rc=0
- 实机冒烟：
  - 项目首页 → Goal：FrameBar 显示 `Goal · rev 1` 与标题，Goal 总览渲染，器械栏出现
  - 器械栏「查看变更集」：进入变更集舞台，无 diff 时显示空态
  - 审阅 lens：器械栏保留，队列为空时显示空队列
  - 返回：回到 Goal 总览
  - 900px 窄窗：器械栏堆叠到舞台下方，宽度占满，不覆盖框
  - 现有 5 个 Goal 的评审项均为 0，评审项实机聚焦未触发；该路径由 `stage-dispatch` 行为测试与 wiring 测试覆盖

## 最终 review

独立 reviewer（`gateway/deepseek-v4-pro#max`）对 `9df02585..7da966f4` 做了全量 review，随后对修复波 `7da966f4..53b1901d` 做 scoped re-review（CLEAN）。

已修复：

- **Critical：评审项落到 world 舞台** → `stageKindFor` / `stageActionFor` 将 `reviewItem` 分派到编辑器，`openReviewItemToFocus` 先 `syncStageToFocus` 再打开锚点；新增行为级 dispatch 测试。
- **Important：worktree 永远是项目目录** → `resolveGoalWorktreeDir` 用 `pod.result` + `fs.listDir` 探测，失败回退项目目录。
- **Important：wiring 测试只查源码文本** → 增加 `reviewItem → editor` 的真实行为测试；队列 fetch/seq 逻辑测试仍 deferred。
- **Minor：`line` 在组件边界类型中丢失** → 统一 `focus-open.ts` 的 `FocusOpenRequest`。

Deferred minor：

- 评审队列首次加载失败仍显示「还没有评审意见」，未区分加载失败与确实为空。
- Goal 框内 revision 出现两次（scope label + badge）。
- 同项目内快速切换焦点时，异步 worktree 解析可能把迟到的评审项 / 变更集压入栈；项目切换已有守卫。

## 已知边界

- 变更集使用当前 session 的 `contentDiffEntries()`；没有独立 worktree diff API，空态是当前缓解。
- 评审项实机路径因现有 Goal 无评审项而未触发；Plan 3 前建议用 scratch 项目播种一条评审项做冒烟。
- Chat 决定板、Agent/用户契约、执行作为框、完整决定记录仍未实现。
- 器械栏 attention badge / 全局「需要你」聚合留给 Plan 3。

## 下一步

Plan 3：Chat 决定板、Agent/用户契约、执行作为框的状态回归、完整决定记录。
