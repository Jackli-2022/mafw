# Desktop 交互补完（B 线）设计：inputbar 导航 + 子代理跳转 + 后台任务可见性

> 日期：2026-10-23 · 状态：待用户确认
> 来源：`docs/research/2026-10-21-six-way-frontend-interaction-gap-survey.md`（P1 批）+ 用户点名的三处实际缺口
> 关系：A 线（workbench 三期沙箱）已记入长期记忆 `mem_1792722731731_xnpg2r`，本件只做 B 线，不碰沙箱。
> 前置：P0 三件已交付（子代理面板 `9b67f225`、后台任务 `3b465060`、行级评论 `b4bbe062`）。

## 1. 意图与 Why

P0 的三块「并行语义」已经上线，但用户在实际使用中仍卡在三处：

1. **聊天里看到子代理任务卡，点不进去**——只有右侧「子代理」tab 能跳，违反「看到什么就能点进去」的直觉。
2. **inputbar 只有 ↑/↓ 历史，没有 readline 编辑层**——改一句话要反复按方向键，长命令/长提示词编辑效率低；历史还只活在当前 pane 内存里，重启就没了。
3. **后台任务面板存在，但环境不满足时静默隐藏**——REST 不可用时「输出/终止/全部转后台」直接消失，用户不知道是没任务还是功能坏了。

本批把这三处收口；checkpoint/rewind、quote-reply、跨会话搜索等 P1 其余项**不在本批**（下一批另立 spec）。

## 2. 范围与设计

### B1 子代理跳转（task 工具卡）

**现状（代码级）**

- 右侧「子代理」tab 行点击 → `openSubagentSession(childID)` 已可用（`SubagentDock.tsx` / `MafwShell.tsx`）。
- 聊天内 task 工具卡由 `packages/session-ui/src/components/message-part.tsx` 的 `task` 注册项渲染；它读 `props.metadata.sessionId`（`message-part.tsx:2071`）。
- 但 opencode v2.1.0 的工具 part metadata 在后台子代理上实证为 `state.metadata.sessionID`（大写 ID；见 `docs/superpowers/specs/2026-10-22-background-task-panel-design.md` §4.1），背景任务检测也按 `sessionID` 读（`background-detect.ts:19`）。
- → **key 不匹配**：`props.metadata.sessionId` 取不到 → `childSessionId()` 为空 → 卡片不可点。这就是「子代理跳转缺失」的根因候选。

**方案**

1. task 卡读取顺序改为：`metadata.sessionId ?? metadata.sessionID ?? metadata.childSessionID`（兼容 opencode 新旧字段与未来 runtime）。
2. `navigateToSession` 已由 desktop 的 `DataProvider` 注入（`MafwShell.tsx:1718`），无需改壳；验证点击链路即可。
3. **Task 0 实证**：对 live opencode 2.1.0 跑一次真实子代理，抓 task part 的 `state.metadata` 键集，钉死实际字段；若两键皆无，再启用兜底（desktop 在 part 入 store 前按 `subagent-tracker` 的 title/description 匹配补 `metadata.sessionId`，单点 enrich，不猜 UI 层）。
4. 纯函数提取：`taskChildSessionID(metadata)` + 单测（`message-part.test.ts` 或新文件），覆盖三键、空对象、非字符串。

**验收**：聊天中 task 卡有跳转箭头；点击进入子会话；`返回父会话` 可回；右侧 dock 行跳转不回退。

### B2 Inputbar 导航（readline 编辑层 + 历史持久化）

**现状**

- ↑/↓ 历史已有 readline 语义（`input-history.ts`：caret 行门、草稿恢复、IME 保护、busy 队列 push）。
- `/` 命令与 `@` mention 的 ↑/↓ 选择已有。
- 编辑层缺失：Ctrl+A/E/B/F/K/U/W、Ctrl+T 均未接线（`ChatPane.tsx` 只有 Ctrl+C/F/O）。
- 历史是 `createInputHistory(50)` 的内存态，per pane，重启丢失。

**方案**

1. 新建纯模块 `packages/desktop/src/renderer/mafw/components/composer-readline.ts`：
   - `applyReadlineKey({ value, start, end }, key, { ctrl, alt, meta, shift }) -> EditResult | null`
   - 支持：`Ctrl+A` 行首、`Ctrl+E` 行尾、`Ctrl+B/F` 单字符左/右、`Ctrl+K` kill 到行尾、`Ctrl+U` kill 到行首、`Ctrl+W` 删除前一个词、`Ctrl+T` 交换光标两侧字符；`Alt+B/F` 按词移动（可选，纳入本批）。
   - 多行语义：A/E/K/U 以 `\n` 为行边界；K/U 只影响当前行。
   - IME 组合中、picker 打开时不拦截（沿用现有优先级）。
   - 不做自定义 undo 栈：保留 textarea 原生 Ctrl+Z/Ctrl+Y；文档标注（survey 列的 undo/redo 由原生承担）。
2. ChatPane `onKeyDown` 接线：命中则 `preventDefault` → `setInput` → `setDraft` → `queueMicrotask` 恢复 selection → `autoGrow`。
3. 历史持久化：
   - `input-history.ts` 增 `load(entries)` / `entries()`（或在 store 层包一个持久化适配器），存储注入可测。
   - localStorage key：`mafw-input-history:v1:<sessionID>`；JSON 数组，max 50 条，单条 4KB 截断，总 20KB 截断。
   - `ChatPane` mount 与 `sidProp()` 切换时 load；`history.push` 后写穿；send / busy 入队两条路径都 push（现语义不变）。
   - 会话删除不主动清理（孤儿键无害；后续可加 LRU 清理）。
4. 队列召回（把排队消息 ↑ 收回输入框）**不做**——队列 chips 已可见/可删，避免与 readline 历史抢占。

**验收**：

- 单行/多行里 Ctrl+A/E/B/F/K/U/W/T 行为正确；IME 组合中不触发；picker 打开时不抢键。
- 重启 app 后 ↑ 能召回本会话上次发送的内容；切换会话历史隔离。
- 原 ↑/↓ 草稿恢复、busy 队列 push 回归全绿。

### B3 后台任务可见性

**现状**：work bar + dock + 通知 + 15s 对账已实现；REST 三件（输出/终止/全部转后台）由 `background-capability.ts` 两门控制：

- `backgroundRestAvailable()`：`GET /api/shell` 可达（v2 鉴权桥就绪）
- `canUseBackgroundApi()`：runtime 为 opencode

当前实测：gateway 活、`serveRunning:false`、`/api/shell` 502 → REST 门为 false，dock 静默隐藏按钮。

**方案**

1. `BackgroundDock` 在 `backgroundRestState() === "unavailable"` 且存在 shell 行时，顶部显示一行弱化说明：
   `"网关未注入 v2 鉴权或 serve 未就绪：输出/终止/全部转后台暂不可用"`（fail-open，不挡列表）。
2. `BackgroundWorkBar` 的 blocking 行同样按 `unavailable` 显示说明（替代死按钮）；`"checking"` 状态不闪文案。
3. 不新增快捷键：Ctrl+B 已被左侧 dock 占用；「全部转后台」按钮保留（spec 原语义）。
4. 不碰 gateway/runtime：v2 鉴权桥是用户并行工作；能力探测改为 **三态 + 挂载期 60s 重探 + SSE 重连/runtime 切换 reset**，就绪后自动点亮（见 §3.3）。
5. 补 wiring 测试：`unavailable` → 说明文案存在、按钮不存在；`available` → 反之；`checking` → 两者都不出现。

**验收**：serve/REST 不可用时面板不再"静默消失功能"；就绪后按钮自动出现；无 gateway 改动。

### B4 点击 chatview 聚焦 inputbar

**现状**：点击消息区/空白处只会选中文本，输入框不获得焦点；用户必须再点一次底部 composer 才能继续输入。

**方案**

1. 在 `ChatPane.tsx` 的滚动容器 `.mafw-session-turn-container`（`onScroll={handleScroll}` 同一元素）加 `onClick`。
2. 纯谓词模块 `composer-focus.ts`：`shouldFocusComposerFromClick({ button, detail, ctrl, meta, alt, shift, selectionCollapsed, target })`——
   - 仅主键、`detail === 1`、无修饰键；
   - 文档选区非空（拖选/双击选词）→ 不抢焦点；
   - 目标在交互元素内（`a/button/input/textarea/select/[role=button]/[role=tab]/[contenteditable=true]`）→ 不抢焦点；
   - 其余（消息文本、气泡、空白）→ 聚焦 composer。
3. 聚焦用 `textareaEl()?.focus({ preventScroll: true })`；**不改变** composer 现有 caret/选区/草稿。composer disabled（gateway 未就绪）时自然 no-op。
4. 不关闭已打开的 picker（点击 chatview 时由既有 outside-click 逻辑处理）；不自动滚动到底部。
5. 双击选词：若手工冒烟发现首击聚焦破坏选词，加 220ms 延迟 + `selectionchange`/`dblclick` 取消（计划里先按即时聚焦实现，冒烟后定）。

**验收**：点击消息文本/空白 → caret 落在 inputbar；拖选文本、双击选词、点击链接/按钮/工具卡 → 不抢焦点；有草稿时点击不清空、不移动 caret。

## 3. Builder check 裁定（2026-10-23，六项）

Builder check 抓到 6 个会导致计划返工的问题，逐项裁定如下（均按"输入框优先、只做必要改动"原则）：

1. **Ctrl+F / Ctrl+K 所有权冲突**
   - 现状：`Ctrl+F` 是会话内搜索（`ChatPane.tsx`），`Ctrl+K` 是左栏搜索（`MafwShell.tsx`），二者都不看输入框焦点。
   - 裁定：**composer 聚焦时 readline 赢**（Ctrl+F = 前移一字符、Ctrl+K = kill 到行尾）；两个全局 handler 加 composer 焦点门（`e.target.closest(".mafw-composer")` 或 activeElement 在 composer 内则 return）。焦点在 composer 外时全局搜索行为不变。
   - 影响文件：`ChatPane.tsx`（readline 接线）、`MafwShell.tsx`（Ctrl+K 门）、`ChatPane.tsx`（Ctrl+F 门）；补两条 wiring 断言。
2. **选中区与 Shift 语义**
   - 裁定：移动类（A/E/B/F、Alt+B/F）**折叠选区**后落到目标位置；kill 类（K/U/W）**选区非空时删除选区**，否则按行/词作用；Ctrl+T 在选区非空时 no-op；Shift 不参与 readline 扩展（不实现 Shift+Ctrl+A/E 扩选）。写进 `composer-readline.ts` 的契约注释与测试矩阵。
3. **B3 能力探测一次性 → 三态 + 重探**
   - 现状：`BackgroundDock`/`BackgroundWorkBar` 各只调一次 `backgroundRestAvailable()`，60s 重试永不发生；`restOk=false` 无法区分"未探测"与"不可用"。
   - 裁定：`background-capability.ts` 增加 `backgroundRestState(): "checking" | "available" | "unavailable"`（保留旧布尔 API 兼容）；组件 mount 时探测，**在挂载且存在 shell 行时每 60s 重探**，SSE 重连 / runtime 热切换时 `resetBackgroundCapability()`。说明文案只在 `unavailable` 显示，`checking` 不闪。
4. **失败 task 卡也要能跳**
   - 现状：`ToolErrorCard` 只接受 `href`；desktop 无 `sessionHref`，失败子代理卡永远不可点，而这正是最需要点进去看原因的状态。
   - 裁定：**纳入本批**。给 `ToolErrorCard` 加可选 `onNavigate`；`message-part.tsx` 的错误分支与正常分支共用同一个 `taskChildSessionID(metadata)` 三键解析；有 id 时点击跳转，无 id（任务创建前就失败）不渲染链接。
5. **历史截断安全**
   - 裁定：**超过 4KB 的条目整条不存**（绝不截半条再召回——静默发送残缺 prompt 比没有历史更糟）；总预算 20KB 按"丢弃最旧整条"收缩；不做截断标记。测试覆盖超长条目被跳过。
6. **修饰键平台策略**
   - 裁定：readline 只认**字面 Ctrl**，不拦截 Meta/Cmd——macOS 的 Cmd+A 全选、Cmd+W 关窗保持原生；Windows/Linux 上 Ctrl+A 覆盖全选（与 opencode Desktop 上游一致，明确接受此取舍）。Ctrl+W 在 composer 内 `preventDefault + stopPropagation`；Windows 主进程无应用菜单（`menu.ts`），无加速键冲突。

## 5. 非目标

- A 线：WSL/沙箱、serve 迁入、共享 terminal 解冻、浏览器同页协同、CUA。
- P1 其余：checkpoint/rewind 时间线、截屏注释、quote-reply、跨会话全文搜索、变更文件树实时化 → 下一批 B2 立项。
- pi runtime 的子代理/后台能力（无生产者，按 P0 裁定恒空）。
- gateway / runtime 改动（含 v2 鉴权桥、`/api/shell` 反代注入）。

## 6. 关键决定

| 决定 | 内容 |
|---|---|
| 历史作用域 | **按会话**持久化（key 含 sessionID），与 per-session draft 语义一致；不做全局 shell 式历史 |
| 历史截断 | > 4KB 整条不存；总 20KB 丢最旧整条；绝不召回半条 |
| undo/redo | 用 textarea 原生实现，不自建 undo 栈（避免与受控 value 的输入法/组合态打架） |
| readline 键位 | Ctrl+A/E/B/F/K/U/W/T + Alt+B/F；不做 Ctrl+Y 等扩展 |
| 键位所有权 | composer 聚焦时 readline 赢（Ctrl+F/K 不再触发全局搜索）；焦点在外时全局不变 |
| 修饰键 | 只认字面 Ctrl，不拦 Meta/Cmd（macOS 原生全选/关窗保留） |
| task 卡字段 | 三键兼容 + Task 0 实证；失败卡（ToolErrorCard）同样可跳 |
| 后台 REST | 三态能力 + 60s 重探；只做"可见的能力说明"，不修鉴权桥（越界到并行 v2 工作） |
| 点击 chatview | 非交互目标 + 主键单击 + 无选区 → 聚焦 composer；不改 caret/草稿；交互元素与文本选择不抢 |

## 7. 测试策略

- 新增 `composer-readline.test.ts`：每键 × 单行/多行/边界（行首/行尾/空/选中区/全选）、Alt 词移动、不命中返回 null。
- `input-history.test.ts` 扩展：持久化适配器（fake storage 注入）load/save/上限/坏 JSON fail-open；会话隔离 key。
- `message-part.test.ts`：`taskChildSessionID` 三键兼容 + 非字符串。
- `composer-focus.test.ts`：主键/修饰键/detail/选区非空/交互目标/普通文本六组谓词。
- desktop wiring：`ChatPane` 接线（readline 命中 preventDefault、scroller onClick、history load/persist 调用点）、`BackgroundDock` REST 说明分支。
- 门禁：desktop `npm test` + `npx tsgo --noEmit` + `npx electron-vite build`；session-ui `npm test`（若改动导出）。
- 手工冒烟：dev app 真实子代理点击跳转；重启后 ↑ 历史；REST 关闭/开启两态面板。

## 8. 风险

| 风险 | 处置 |
|---|---|
| `TextareaV2` 受控 + selection 恢复时序 | `queueMicrotask` 后读 `textareaEl()` 设置 selection；跑真实 IME 冒烟 |
| Ctrl+W 在 Electron 可能触发关窗/菜单加速键 | composer `onKeyDown` 先 `preventDefault`；检查主进程菜单无冲突 |
| localStorage 容量/隐私 | 本地明文，仅存用户自己输入；每会话 20KB 上限；文档标注 |
| opencode metadata 实际键与源码假设不符 | Task 0 live 抓帧钉死；兜底 enrich 仅在实测缺失时启用 |
| 子代理卡在历史水合时 metadata 被剥 | 与 background-detect 的 state.metadata 读取同源；回归覆盖 live + 历史两条路径 |

## 9. 交付顺序（计划阶段细化）

1. Task 0：live 抓 task part metadata + `/api/shell` 能力两态实证。
2. B1：task 卡三键兼容 + 单测 + 跳转冒烟。
3. B2a：`composer-readline.ts` 纯模块 + 单测 → ChatPane 接线。
4. B2b：历史持久化适配器 + 单测 → ChatPane load/persist 接线。
5. B3：REST 三态说明 + wiring 测试。
6. B4：`composer-focus.ts` 纯谓词 + 单测 → scroller 接线 + 手工冒烟（文本选择不被打断）。
7. 文档 + 全量门禁 + 独立 review。
