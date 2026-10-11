# MAFW Desktop 工具卡美化 v8（对齐原生工具调用 bar）— 设计文档

> 日期：2026-10-11
> 前置：`docs/research/2026-10-11-tool-call-rendering-survey.md`（Claude/Codex/pi/opencode/dsh/Kimi 六家）；`docs/superpowers/specs/2026-09-28-desktop-v6-design.md`（工具卡元数据行）、`2026-10-10-desktop-motion-polish-design.md`（两级动效）
> 状态：设计方向 A（对齐原生）已获用户批准

## 1. 背景

工具卡功能上已修好（不再空卡），但视觉上**比任何对标产品都更扁平**：`.mafw-session-turn-container` 把工具覆盖成 **22px 无框行 + 左竖线缩进内容**（dsh 式刻意压缩），内容无 surface 盒、无展开动效、触发行无右侧状态位、无显式截断提示。

六家调研收敛出「原生工具调用」的 bar：① 默认折叠一行 + 显式展开；② 结构化一行摘要（标题 + 目标 + 量化增量）；③ 内容体是独立 surface（描边/圆角 + mono + 可滚 + 可复制）；④ 状态用 shimmer/点 + 耗时；⑤ 截断显式；⑥ 颜色尺寸走 token。

本设计目标：把 MAFW 工具卡提到该 bar，且用 v5/v6 token 保持克制。

## 2. 目标 / 非目标

**目标**：
- 触发行结构化：标题 + 上下文 chip + `key=value` args + 右侧状态徽标
- 内容体 surface 盒（描边 + 圆角 + 内边距 + inset 底），数据/代码走 mono，代码可滚动 + 显式截断
- 展开高度动效（surface 档）；进行态标题 shimmer
- 全工具卡统一（family + search/add/rule/python）

**非目标**：
- 不加家族色图标（原生族 shell 也不渲染 icon，且偏离克制）
- 不追 dsh 常显轨迹 / Claude 拟人微文案
- 不做 opencode 式 file-accordion / diff 视图（MAFW 工具无文件 diff 语义）
- 不改工具卡数据解析逻辑（已修好，见上一批提交）
- 不改 gateway / 事件流

## 3. 设计

### §3.1 触发行（`.mafw-session-turn-container [data-component="tool-part-wrapper"]`）

现状：`[data-slot="collapsible-trigger"]` height 22px、`--text-3` 12px。改为：
- height **26px**；padding `0 6px`；border-radius `var(--r-sm)`；hover `background: var(--hover)`（保留）；加 `:active { background: var(--active); transform: translateY(.5px) }`（复用 v7 微交互）。
- 标题（`[data-slot="basic-tool-tool-title"]`）：`--text-1`、**13px**、weight 500。
- 上下文（`subtitle`）：`--text-3`、12px。
- args（`[data-slot="basic-tool-tool-arg"]`）：`--text-4`、11px、mono 可选。
- **右侧状态徽标**：用 `BasicTool` 的 `trigger.action` 位（已有，`[data-slot="basic-tool-tool-action"]`）。新增小 pill 样式 `.mafw-tool-badge`（成功=accent / 失败=danger / 中性=muted），按工具补：verdict PASS/FAIL（goal）、valid ✓/✗（validate/draft）、enabled ON/OFF（rule）、count N（list）。
- 进行态：标题 shimmer 由 `BasicTool` 自带 `TextShimmer`（`active={pending()}`）——确认在 MAFW 覆盖下可见（现被 12px/色覆盖，需放行）。

### §3.2 内容体（surface 盒）

现状：`[data-slot="collapsible-content"] > * { border-left: 1px; margin-left: 4px }`（左竖线缩进）。改为内容容器本身成盒：
- `[data-slot="collapsible-content"]`：`margin: 4px 0 8px`；`padding: 8px 10px`；`border: 0.5px solid var(--border-subtle)`；`border-radius: var(--r-md)`；`background: var(--bg-inset)`。
- 移除「左竖线 + margin-left 4px」规则。
- `mafw-tool-output`（code 段）：`--font-data` 12px、inset 底、可滚动、`max-height: 240px`；**显式截断提示**（spec 已 trunc，渲染时若命中截断追加 `… 还有更多`）。
- kv 网格保持 sans（可读），值列可 `--font-data`（数值类）。tags chips 随盒内 padding 收紧。
- 盒子与 SectionView 同色系，避免双层嵌套打架。

### §3.3 动效

- `BasicTool` 传 `animated`（高度过渡，走 v7 的 `--dur-surface`/`--ease-surface` 档）。
- 进行态 shimmer；完成态不做入场动画（避免每卡闪烁）。
- reduced-motion 沿用 v7 全局降级。

### §3.4 落地范围

- `familyCard`（`shared.tsx`）：传 `animated`；让 spec 可提供 `badge`（可选）。
- 自绘卡 `MafwSearchCard`/`MafwAddMemoryCard`/`MafwRuleCard` + `python.tsx`：同样接盒 + 徽标。
- `extract.ts` 的 `ToolCardSpec` 增可选 `badge?(input, output): { text: string; tone: "ok"|"warn"|"err"|"muted" } | undefined`；各 spec 按需补。

## 4. 落地文件映射

| 区域 | 文件 |
|---|---|
| 触发行 + 内容盒 CSS | `packages/desktop/src/renderer/mafw/mafw.css`（`.mafw-session-turn-container [data-component="tool-part-wrapper"]` 段、`.mafw-tool-*` 段） |
| 徽标 | `mafw.css`（`.mafw-tool-badge`）+ `extract.ts`（`ToolCardSpec.badge`）+ `shared.tsx`（渲染徽标） |
| 动效 | `shared.tsx`（`animated`）+ 自绘卡 |
| 契约测试 | `packages/desktop/src/renderer/mafw/tool-card-css.test.ts`（新，读 mafw.css 断言规则） |
| 徽标数据 | `extract.ts` 各 spec `badge`（goal/validate/draft/rule/list 等） |

## 5. 测试与验收

- CSS 契约测试：触发行 26px、内容盒描边/圆角/内边距规则存在、mono code 规则、左竖线规则已删。
- 徽标纯逻辑测试：`ToolCardSpec.badge` 对样例 input/output 产出预期（extract.test.ts）。
- `bun test` + `electron-vite build` 门禁；双主题目视（用户，本地无法读图）。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 盒 + 原有左竖线双层视觉打架 | 删左竖线规则，仅保留盒 |
| 触发行加高后与 thinking 行不一致 | thinking 行同步微调或保持（thinking 是独立块，暂不动） |
| 每卡加徽标工作量大 | 先高频工具（goal/rule/list/validate）补，其余用可选 badge 缺省不显示 |
| `animated` 与 MAFW 展开样式冲突 | 用 `BasicTool` 原生 animated 路径，clippable 高度由它管 |
| 我无法目视 | 用户验收 + CSS 契约测试 |

## 7. 明确不纳入（YAGNI）

- 家族色图标、file-accordion/diff、常显轨迹、拟人文案、语法高亮（MAFW 工具输出非代码）
- 工具卡数据解析改动（已完成）
- gateway / 事件流改动
