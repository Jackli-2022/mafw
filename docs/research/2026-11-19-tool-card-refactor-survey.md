# 工具卡体系调研（2026-11-19）

> 目的：回答“工具卡是否都要重构”。结论是**模型确实分裂，但不需要一次性重写**。
> 先用“所有原生卡进抽屉 + 一层归一化”解决可见问题，再按波次收敛 presentation 契约。
> 前置：`docs/superpowers/specs/2026-10-11-tool-card-polish-design.md`（v8 方向 A）、
> `docs/research/2026-10-11-tool-call-rendering-survey.md`（六家对标）。

## 1. 现状：同一工具，三套渲染

| 路径 | 代码 | 触发/视觉 | 覆盖 |
|---|---|---|---|
| A. session-ui 原生 | `packages/session-ui/src/components/message-part.tsx` `ToolRegistry` | `BasicTool` 14px；每个工具自带 trigger；无 badge；图标 prop 实际未渲染（task 自绘图标例外） | read/list/glob/grep/webfetch/websearch/task/bash/edit/write/apply_patch/question/skill + 通用 MCP 兜底 |
| B. desktop MAFW family | `packages/desktop/src/renderer/mafw/components/tool-cards/*` | `ToolCardSpec` + `familyCard` + `BasicTool`；badge、`mafw-tool-box` 分节、animated | **30 个 `mafw_*` spec** + 8 个自绘卡（search/add/deltas/rule/python/python_restart/execute/goal_created） |
| C. 过程时间线 | `packages/session-ui/src/components/process-timeline.tsx` `ToolRow` | 11px 无框行；相对路径；无图标；通用 input/output | 除 `edit/write/apply_patch` 外的所有工具 |

同一个调用在不同位置长得不一样：

- `read`：普通聊天 14px BasicTool；时间线里 11px 无框图。
- `mafw_search_hybrid`：普通聊天是带结果/徽标的 family card；时间线里退化成 `Mafw Search Hybrid` + 通用 JSON 行，结果列表和 badge 全丢。
- `task`：普通聊天有“打开子代理”入口；时间线行没有。
- `question`：普通聊天有答案正文；时间线行没有。
- `edit`：普通聊天 14px diff 卡；时间线里刚被 CSS 压到 11px。

## 2. 根因：标题/副标题有四个构建器

1. `getToolInfo(tool, input, metadata, directory)` — 通用标题/副标题/icon，时间线 ToolRow 与 context 组兜底使用。
2. 每个原生 renderer 自己拼 `BasicTool.trigger`（read 的 filename、bash 的 command、task 的自定义 trigger……）。
3. `contextToolTrigger` / `contextToolDetail` — read/list/glob/grep 的“上下文组”又拼一套。
4. `ToolCardSpec`（desktop family）— `title` / `subtitle` / `icon` / `extract` / `badge`。

新增一个工具最多要改 4 处；字段（相对路径、状态、badge、展开）没有单一来源。

## 3. 视觉/交互不一致清单

- **字号**：BasicTool 14px；时间线 11px；edit 被抽屉 CSS 压到 11px；task 自绘 14px。
- **路径**：native read/edit/write 用 filename；desktop specs 用 goalId/questionId 等；context 组用 `getDirectory`；相对路径只在时间线/近期 native 改动里出现。
- **壳**：BasicTool 无框；desktop family 有 `mafw-tool-box` 内容盒；bash 有终端盒；edit/write 有自定义 trigger；question 默认展开答案。
- **状态**：desktop family 有 `ToolBadge`；native 用 BasicTool 状态；时间线用 `✓/·/⚠` 字形。
- **展开**：BasicTool animated / 自定义 defer / 时间线手写 Collapsible / edit 原生折叠，四套动效。
- **富交互**：task 打开子代理、question 回答、skill 详情、MAFW search/add/rule/python/execute/goal 的 badge/分节，时间线行全部丢失。
- **图标策略**：v8 已定“原生族不渲染 icon”；BasicTool 的 `icon` prop 实际未用；task 自绘仍有一个 subagent 图标，时间线行已去掉图标。
- **测试**：desktop family 有 `extract.test.ts` / `tool-card-css.test.ts`；session-ui 侧只有 fs 断言，没有“所有注册工具都能产出同一形状”的 conformance 测试。

## 4. 建议：两阶段，不要 big-bang

### Phase 1（先让所有卡 fit in，低风险）

- 时间线对**所有工具**都渲染注册的原生卡（删除 `ToolRow` / `CARD_TOOLS` 白名单），保留 task/question/skill/MAFW family 的富内容。
- 加一层作用域归一化 CSS：
  - 触发标题 11px/550，目标/路径 10.5px；
  - 无前置图标（task 图标隐藏）；
  - 行工具无外框、hover 淡底、右侧一个 chevron；
  - edit/write/apply_patch 保留 diff 卡；富卡保留自己的操作。
- 这一步只改 `process-timeline.tsx` + CSS，不动 ToolRegistry/BasicTool，风险最低。

### Phase 2（模型收敛，按波次）

定义单一 `ToolPresentation`：

```ts
interface ToolPresentation {
  kind: 'row' | 'diff' | 'rich'
  title: string
  object?: string                 // 相对路径 / 命令 / query
  meta?: Array<{ text: string; tone?: 'ok'|'warn'|'err'|'muted' }>
  status: 'pending' | 'running' | 'completed' | 'error'
  sections?: Section[]            // kv / text / code / list / tags
  actions?: Array<{ label: string; kind: 'open-subagent'|'answer'|'link'; run: () => void }>
}
```

- `ToolRegistry` renderer 改为返回 presentation（或 `renderCustom` 逃生口），一个 `ToolCard` 组件按 `kind` 渲染；普通聊天/时间线共用，只切换 density。
- desktop `ToolCardSpec` 先做 adapter → presentation，逐步合并；最后删除 `getToolInfo` / `contextToolTrigger` 的重复字段。
- 波次：row 工具（read/search/bash/generic）→ diff（edit/write/apply_patch）→ rich（task/question/skill）→ MAFW family（30 specs + 8 bespoke）。
- 加 conformance 测试：每个 `ToolRegistry` 名称都必须产出合法 presentation；空对象/缺 title/缺 status 直接失败。

## 5. 风险 / 非目标

- 审批卡 / flow-card / renderAfterPart 是承重路径，Phase 1 不动；Phase 2 保留逃生口。
- 不做大爆炸式签名替换；先 adapter，后删旧路径。
- 不追求 Claude 拟人微文案 / 家族色图标（v8 已否决）。
- 移动端不复用 session-ui 这套卡（Flutter 自绘），重构范围仅 desktop。

## 6. 待决

1. 先做 Phase 1（所有原生卡进抽屉 + 归一化）还是直接写完整 Phase 2 spec？
2. 普通聊天是否也切到 11px/无框的新密度，还是只让时间线用紧凑密度？
3. `task/question` 的富操作在抽屉里保留原生卡，还是改成行 + 右侧动作按钮？
