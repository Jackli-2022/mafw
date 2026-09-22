# mafw_* 全工具专属卡片设计（desktop）

日期：2026-09-22
状态：已确认（brainstorming 三段问答：实现路径=编译期 Solid / 范围=全覆盖 / 粒度=族级定制+字段配置）

## 1. 背景与目标

desktop ChatView 的工具卡片经 `@mafw/session-ui` 的 `ToolRegistry`（`packages/session-ui/src/components/message-part.tsx:1559`，按 `part.tool` 精确名匹配）渲染。当前 `MafwToolCards.tsx`（`packages/desktop/src/renderer/mafw/components/MafwToolCards.tsx`）只覆盖 24 个工具：

- 定制卡 5 个：`mafw_search_hybrid`、`mafw_add_memory`、`mafw_get_deltas`、`mafw_python`、`mafw_python_restart`
- 规则卡 9 个（`MafwRuleCard`）：自动化 + triage 族
- 泛用卡 10 个（`MafwGenericCard` = KV + JSON dump）
- **其余 ~20 个工具掉进 session-ui 的 `GenericTool`**（goal 族大半、记忆写入族、桌面控制 6 个、媒体 3 个、restart_agent 等）

目标：全部 **44 个第一方工具**（39 个 gateway MCP 工具，`gateway/src/mcp/tool-registry.ts`；5 个插件侧工具，`src/plugin.ts:175-179`：`mafw_media_ask`、`mafw_media_upload`、`mafw_media_speak`、`mafw_python`、`mafw_python_restart`）都有按语义定制的专属卡片，无 GenericTool 兜底（仅未知/未来工具落兜底）。

## 2. 决策记录

| 问题 | 决策 | 理由 |
|---|---|---|
| 实现层 | 扩展为内置 Solid 组件（编译期注册） | 第一方工具配第一方卡片；响应式流式更新；可随 desktop bun 测试；用户插件 `override:true` 仍可覆盖 |
| 范围 | 全覆盖 44 个 | 消灭 GenericTool 与 JSON dump 泛用卡 |
| 粒度 | 族级定制 + per-tool 字段配置 | 8 族共享卡片组件 + 每工具纯数据 extract 配置；避免 44 个独立组件的维护面 |

## 3. 架构与文件布局

`MafwToolCards.tsx`（334 行）拆为目录，一族一文件；`index.ts` 汇总导出 `registerMafwToolCards()`。**注册时机与调用签名不变**——`MafwShell.tsx:1151` 仍调 `registerMafwToolCards()`，先于 `registerUserPluginCards()`（registry 是覆盖语义，用户插件捕获 original 的顺序必须保持）。

```
packages/desktop/src/renderer/mafw/components/tool-cards/
  index.ts          # registerMafwToolCards()：注册全部 44 个 key；导出 TOOL_KEY_LIST 供完整性测试
  shared.tsx        # 卡片壳与公共件：safeJson、Section 类型、KvRows/TagChip/CodeBlock/EmptyRow 渲染、familyCard() 工厂
  extract.ts        # Section/ToolCardSpec 类型 + 全部 44 个工具的纯 extract 配置（无 Solid 依赖，bun 可测）
  memory-read.tsx   # 记忆检索族组件
  memory-write.tsx  # 记忆写入族组件
  goal.tsx          # Goal 编排族组件
  interact.tsx      # 交互/反馈族组件
  automation.tsx    # 自动化 & Triage 族组件（现 MafwRuleCard 迁入）
  desktop.tsx       # 桌面控制族组件
  media.tsx         # 媒体族组件
  python.tsx        # Python 族组件（现 Python 双卡原样迁入）
```

旧 `MafwToolCards.tsx` 删除，`MafwShell.tsx` 的 import 路径改为 `./components/tool-cards`。

### 3.1 核心抽象：Section + extract

每个工具一张配置（纯数据，集中在 `extract.ts`）：

```ts
type Section =
  | { kind: "kv"; rows: Array<[string, string]> }
  | { kind: "tags"; items: string[] }
  | { kind: "text"; text: string; tone?: "muted" | "warn" | "error" }
  | { kind: "code"; text: string; language?: string }
  | { kind: "list"; items: SectionListItem[] }   // 结构化行（标题/副标题/徽标）

interface ToolCardSpec {
  icon: string                       // @mafw/ui Icon 名
  title: string                      // 卡片标题（中文短名，如「记忆检索」）
  subtitle?: (input: any) => string | undefined
  defaultOpen?: boolean
  extract: (input: any, output: string | undefined) => Section[]
}
```

族组件 = `familyCard(spec)` 生成的 Solid 组件：读 `ToolProps`，`output` 容错 `JSON.parse`（失败保留原文进 `code` 段），把 `spec.extract()` 的 `Section[]` 渲染进 `BasicTool`。现有 5 张定制卡中视觉独特的（search 结果行、python 卡）保留独立组件，不强行套 Section 模型。

## 4. 族划分（8 族 / 44 工具）

### 4.1 记忆检索族（memory-read，3）
- `mafw_search_hybrid`：**保留现有卡片原样迁入**（结果行：type 徽标 + abstraction + E 值）
- `mafw_get_memory`：KV（id/type/energy/pinned/sticky）+ `memory_value` markdown/code 段 + supersede 链提示
- `mafw_get_axioms`：list——每条 axiom 一行（pattern + energy 徽标）

### 4.2 记忆写入族（memory-write，6）
- `mafw_add_memory`：**保留现有卡片原样迁入**
- `mafw_supersede_memory`：KV（被取代 id 列表、reason）
- `mafw_pin_memory`：KV（id、pinned/sticky/stickyDays → 状态徽标）
- `mafw_merge_memory`：KV（sourceWorktree、策略）+ 结果统计（提取/冲突数）
- `mafw_resolve_merge`：KV（conflictingId、action、newAbstraction）
- `mafw_commit_heuristic`：text（pattern）+ tags（triggerContext）

### 4.3 Goal 编排族（goal，10）
- `mafw_create_goal` / `mafw_set_goal`：KV（goalId/标题/优先级/maxLoops/budget）
- `mafw_get_goal_status` / `mafw_list_goals`：list——goalId + phase/verdict 着色徽标 + 循环进度
- `mafw_cancel_goal`：KV（goalId）+ 结果状态
- `mafw_get_evidence`：code（评审报告内容，截断）
- `mafw_update_state` / `mafw_load_state`：KV（goalId）+ patch/state 的 code 段
- `mafw_answer_question`：KV（questionId、answer）
- `mafw_list_pending_questions`：list——问题 + goalId 徽标

### 4.4 交互/反馈族（interact，4）
- `mafw_ask_user`：text（问题）+ tags（options）
- `mafw_record_feedback`：KV（type 👍/👎/correction、targetId、comment）
- `mafw_get_model_route`：KV（agentType、预算、路由结果模型）
- `mafw_get_deltas`：**保留现有卡片原样迁入**

### 4.5 自动化 & Triage 族（automation，9）
现有 `MafwRuleCard` 迁入本族，9 个工具（list/get automation rules、list/get triage items、automation history、run/validate automation、propose/draft）保持现有呈现；补：`mafw_get_automation_rule`/`mafw_validate_rule` 的 KV 细节（cron、timezone、下次触发）。

### 4.6 桌面控制族（desktop，7）
- `mafw_desktop_screenshot`：KV（selector）+ 输出图片路径/附件缩略（有 dataUrl 时显示）
- `mafw_desktop_navigate` / `mafw_desktop_click` / `mafw_desktop_type` / `mafw_desktop_scroll`：动作摘要行（目标 selector/tab/direction/文本截断）+ 结果 KV
- `mafw_desktop_get_ui_state`：KV（active tab、元素数、窗口尺寸）
- `mafw_restart_agent`：状态徽标 + 输出文本

### 4.7 媒体族（media，3）
- `mafw_media_upload`：KV（文件名/模态）+ taskID 徽标 + 首问
- `mafw_media_ask`：KV（taskID）+ 问题 + 回答文本段（截断 500 字符）+ newTaskID 徽标
- `mafw_media_speak`：KV（音色/style）+ text 摘要（200 字符截断）；不重复播放逻辑（播放由 chat-stream handler 负责，卡片纯展示）

### 4.8 Python 族（python.tsx，2）
- `mafw_python` / `mafw_python_restart`：**保留现有卡片原样迁入**

## 5. 数据流与降级

- `input`：来自 `ToolProps.input`（结构化）；`output`：JSON 字符串 → 容错 parse（沿用现 `safeJson`，失败 → `{ kind:"code", text: 原文 }` 段）
- `running`：只渲染 trigger（title + subtitle(input) + args），body 空或显示「执行中」muted 行
- `completed`：渲染 `Section[]`
- `error`：维持 session-ui 现有 `ToolErrorCard` 旁路（`message-part.tsx:1649`），不动
- 字段缺失一律 fail-soft：`?? "-"` / 跳过该段，**绝不抛断渲染**（卡片异常会破坏整条消息渲染）
- 用户插件 `override:true` 对任何内置卡仍生效（`shouldUseUserCard` 优先级不变）

## 6. 测试（TDD，bun test）

- `extract.test.ts`：44 个工具逐一喂构造的 input/output 断言 `Section[]`——含畸形 JSON、空结果、字段缺失、`running`（无 output）中间态
- `index.test.ts`：**注册完整性**——`TOOL_KEY_LIST` 与硬编码的 44 个工具名单逐一比对（防漏注册；名单即本文 §4 的工具集）
- 组件冒烟 1-2 例（沿用 desktop 现有 bun 测试模式，断言 familyCard 渲染不抛）
- CI：root `npm run test:desktop`

## 7. 非目标

- 不改 session-ui `ToolRegistry` / `BasicTool` / `GenericTool`
- 不改 gateway（零改动）
- 不重做现有 5 张定制卡的视觉
- 不做卡片内交互动作（点击重试、跳转 goal 详情等）——纯展示
- TUI 不在范围（TUI 有自己的 ToolBlock 渲染）
