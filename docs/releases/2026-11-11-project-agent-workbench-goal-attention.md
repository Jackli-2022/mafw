# Project Agent Workbench Plan D3c — Goal 详情注意力顺序（2026-11-11）

## 范围

- 本地 `main`，未 push
- Spec：`docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md` §8.2
- 前置：`docs/releases/2026-11-11-project-agent-workbench-viewer-tools.md`

## 提交

| commit | 内容 |
|---|---|
| `05e20e48` | Goal 详情按注意力重排；技术详情默认折叠；无用户摘要时提供显式开关 |

## 行为变化

- Goal 详情的阅读顺序改为：
  1. Goal 标题与主行动（`GoalUserHero`）
  2. 阻塞 / 最近错误
  3. 需要你回答
  4. 方向讨论
  5. 计划任务
  6. 上下文来源（背景，不再抢占注意力）
  7. 结果与证据（`PodResultView`）
  8. 探针 / 版本历史
  9. 技术详情（Goal id、phase、Loop、verdict、时间线）
- 技术详情默认折叠。之前 `!goalSummary()` 会自动展开技术详情；现在没有用户摘要时也只在显式点击「技术详情」后展开，并新增对应开关。
- 结果与证据仍先于技术诊断；打回、验收、问题回答、Tech Lead 讨论入口不变。
- Goal 上下文顶部标签继续显示 Goal 标题。

## 验证

- desktop 全量 **3358 / 3358**，691 suites
- `npx tsgo --noEmit -p tsconfig.json` rc=0
- `electron-vite build` rc=0
- 实机 dev 冒烟（`.mafw/qa/plan-d3c-goal.png`）：
  - 打开终态 Goal：标题、主行动、结果顺序正确；
  - 技术详情默认不渲染，存在「技术详情」开关；
  - 顶部上下文标签为 Goal 标题。

## 后续（D3d）

- 显式分屏 / 并行工作区。
- 跨重启的文件树展开、滚动位置、草稿持久化。
- Goal revision 最近项。
