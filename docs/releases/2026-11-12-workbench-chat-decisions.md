# Workbench Stage-first Chat 决定面（Plan 3）— 2026-11-12

## 范围

- Spec：`docs/superpowers/specs/2026-11-12-workbench-stage-first-design.md`
- Plan：`docs/superpowers/plans/2026-11-12-workbench-chat-decisions.md`
- 本轮把 Chat 变成决定面：决定板、单一 attention 投影、决定记录、委托单预览、代理契约、执行状态进框。
- 工具审批（permission card / ApprovalsPage）仍是独立实时表面；Chat 四模式选择器、episode、分屏、世界总览、legacy context 清理留给 Plan 4。
- 本地 `main`，未 push。

## 提交

| commit | 内容 |
|---|---|
| `2f4d7713` | 决定 / attention SDK 契约 + 纯决定板模型（四组、goal 过滤） |
| `1f63ec93` | `/api/attention` 投影未解决评审项；desktop `decisionStore` 与 rail badge 单源 |
| `8272680f` | Chat 决定板（计数、折叠、条目动作） |
| `821439a7` | 决定动作进入工作台：Goal focus、评审项锚点、计划审阅浮层 |
| `594ec1bc` | 文件型决定记录：draft / confirm / shelve / reopen、审计历史、人类专属路由 |
| `464ebf6d` | MCP `mafw_decision_draft`：只起草，不能确认 |
| `3ffaacb6` | 决定记录卡 + Goal 总览决定历史 |
| `649fdec5` | 委托单预览：12 字段 + 授权级别；确认前不创建 Goal |
| `203e04bf` | 代理契约卡 + 框执行 badge |
| `771b344f` | 修复决定面 CSS 导入路径 |
| `3d9e0bf6` | 最终 review 修复：记录身份保持、计划 nonce 绑定 Goal、切项目清空、注册表 canonical 查找、15s 兜底刷新 |
| `8fb09920` | 决定记录 reopen 回归测试 |
| `2b634919` | 补 `mafw_decision_draft` 工具注解（MCP registry 覆盖门） |

范围说明：`0992909c` / `9f6e79dd` 等视觉语言提交在 Plan 3 基线 `911e7ea4` 之前，不属于本轮；本轮 12 个提交全部属于 Plan 3。

## 行为变化

- **决定板**：Chat transcript 上方显示 `需要你定 / 待确认 / 已定 / 已搁置`；空组也显示 0；Tech Lead thread 只看当前 Goal，Lead thread 看整个项目。
- **单一计数**：rail 的 Pod badge 与决定板的“需要你”来自同一个 `decisionStore`；未解决评审项进入 attention，已解决不出现。
- **决定动作**：计划待批准 → 打开 Goal 计划审阅浮层；方向 / 问题 / 结果 → 对应 Goal face；评审项 → 带 `rel:Lx` 的编辑器锚点；记录 → 就地展开。
- **决定记录**：Agent 经 MCP 只起草；人可在决定板或 Goal 总览确认、搁置、重开。记录写入 `<project>/.mafw/decisions/<id>.json`，带选项、证据、理由、后果、复看日期与审计历史。确认 / 搁置 / 重开路由拒绝任何非空 `actorSessionID`。
- **委托单预览**：新 Goal composer 先显示 12 字段与授权级别 3；`返回修改` 保留表单；只有 `确认并创建` 调用 `onCreate`。
- **代理契约**：Goal 总览显示 level 3/4、Mandate / Discretion / Escalation / Audit 与人类专属边界（验收、合并、解决评审项、5 自决永远不允许）。
- **执行状态**：框显示 `blocked` / `待验收` / `done` / `done/total` / 阶段 badge；legacy 执行抽屉在 focus 态仍隐藏。
- **失效路径**：决定记录在 MCP 静默写入时由 15s 兜底刷新；Pod 事件仍即时刷新。记录 `updatedAt` 未变时保留对象身份，避免刷新清空正在填写的确认表单。

## 验证

- 新增测试：**69 个**（决定模型、store、决定板、记录服务/路由/MCP、委托预览、代理契约、执行 badge、计划 nonce）。
- desktop 聚焦：**59 / 59**；修复后新增回归 10 / 10。
- desktop 全量：**3526 / 3526**，696 suites。
- gateway 聚焦：**29 / 29**；决定记录修复聚焦 **12 / 12**。
- gateway 全量：**6605 / 6605**，852 suites。
- `npx tsgo --noEmit -p tsconfig.json` rc=0
- `electron-vite build` rc=0
- 实机冒烟（dev app + 新 preload）：
  - Lead / 普通 Chat 上方决定板显示 `需要你定 4`，rail Pod badge 同为 `4`
  - 点击结果待验收条目 → Goal focus，框显示 `rev 1` + `待验收`，Goal 总览渲染代理契约
  - 展开代理契约 → Mandate / Discretion / Escalation / Audit / 人类专属全部正确
  - 起草一条决定记录 → `待确认 1`；展开记录卡 → 确认 → `已定 1`，API `status=decided, decidedBy=user`
  - 重开 → `待确认 1`，API `status=draft`
  - 新 Goal composer → `预览委托单` 显示 12 行 + 授权级别 3；`返回修改` 保留标题与目标
  - 冒烟产生的决定记录文件已删除

## 最终 review

独立 reviewer（`gateway/volcengine/deepseek-v4.1-flash`）对 `911e7ea4..771b344f` 做了全量 review。评审发现并已修复：

- **Critical：每次 store refresh 重建记录对象，清空正在填写的确认表单** → 记录按 `id + updatedAt` 保持身份；新增回归测试。
- **Important：`planOpenRequest` 全局 nonce 会在别的 Goal 上重放计划浮层** → nonce 绑定 `goalId`，`shouldOpenPlan` 纯函数 + 回归测试。
- **Important：切项目后决定板可能继续显示上一个项目的决定** → 项目目录变化时先清空，再拉取；新增回归测试。
- **Important：注册表 raw key 与 canonical 路径不一致时决定路由 503** → `findMafwDirForProject` canonical 查找 + 测试。
- **Important：MCP 静默起草的记录不会出现在决定板** → 15s 兜底刷新（记录身份保持，不清表单）。
- **Important：委托测试没有证明 `onCreate` 只在预览确认后发生** → wiring test 断言 `onCreate` 只出现一次且位于 `submit` 内。
- **Important：交付文档缺失** → 本文件 + `docs/architecture/desktop.md`。
- **门禁：MCP registry 覆盖门发现 `mafw_decision_draft` 漏注解** → 补 `MAFW_TOOL_ANNOTATIONS`；gateway 全量 6605/6605。

Deferred minor：

- 框执行 badge 的未知阶段仍显示英文 `stage.kind`，未复用 `STAGE_STATUS` 中文标签。
- 确认时把 `consequences` 清空会回退到 Agent 起草文本，不能显式清空。
- 决定记录目录全量读取、决定板不做虚拟化；当前量级可接受。
- 每次 Pod 事件仍会立即刷新 attention + decisions，没有 trailing debounce。
- `list` 对未注册项目静默返回 `[]`，未打日志。
- 工具审批 / permission card 未并入决定板（按计划保持独立）。
- 计划浮层与评审项锚点的实机路径因当前项目没有对应条目未触发；由 `shouldOpenPlan` / `stageActionFor` 与 wiring 测试覆盖。

## 已知边界

- Chat 的讨论 / 提议 / 委托 / 解决四模式选择器、episode 分组、分屏、世界总览、legacy context 清理仍在 Plan 4。
- 授权级别只做显示与委托单约束，没有新增运行时 policy engine；强制拦截计划外写 / 删除 / 网络仍依赖现有工具权限与评审门。
- 决定记录是项目文件（非 DB），跨项目查询需按项目目录读取；当前 UI 只显示当前项目。
- 15s 兜底刷新是轮询，不是 SSE 失效事件；后续可换成 `decision.updated` 广播。

## 下一步

Plan 4：Chat 四模式与 episode、分屏、世界总览 subject、legacy context 清理、决定板 debounce / SSE 失效与记录虚拟化。
