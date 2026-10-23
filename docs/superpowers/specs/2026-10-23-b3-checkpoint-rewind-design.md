# B3：Checkpoint / Rewind 时间线设计

> 日期：2026-10-23 · 状态：待用户确认
> 来源：`docs/research/2026-10-21-six-way-frontend-interaction-gap-survey.md` P1（checkpoint/rewind 时间线）
> 前置：B 线第一批（readline/历史/task 跳转/后台 REST/点击聚焦）与 B2（quote-reply/变更树）已交付。
> 本批纯 desktop，复用既有 `session.revert` / `session.diff` / `session.revertDiff`；不改 gateway/runtime。

## 1. 意图与 Why

当前回滚只有「某条 user 消息上的 revert 按钮」：看不到全局时间线、不知道每个 checkpoint 改过哪些文件、也没有「只回滚代码/保留对话」的粒度。agent 跑长任务后，用户想回到 20 分钟前某个 prompt 的状态，只能凭记忆翻消息。

Checkpoint 时间线把**每个 user 回合**变成一个可检查的点：时间、prompt 摘要、该回合改过的文件；支持「回到这里（对话+文件）」和「只回滚代码」。

## 2. 关键现实（实证）

- opencode 2.1 的 `session.revert` 是 **stage+commit**，`contract.ts` 明确 `revertUndoApi: false`（commit 后不可逆）。
- 现有 `ChatPane` 的 revert 确认文案仍写「可通过撤销回滚恢复」——对 2.1 是**错误承诺**，本批必须按 runtime/`revertUndoEnabled` 改写。
- **边界差异（builder check 实证）**：opencode 的 revert 撤回目标 user 消息及其后所有内容（含文件改动）；pi 的 `SessionManager.branch(messageID)` **保留**目标消息、只丢弃其后的回复，且**不回滚文件**。同一 `messageID` 在两个 runtime 语义不同，UI 文案必须区分，不能统一写「回到这里」。
- **代码回滚数据源（2026-10-23 终审实测修正）**：当前 opencode 2.1 adapter 的 `session.diff(messageID)` **不按 messageID 过滤**（同一会话所有 messageID/无 messageID/不存在 messageID 返回同一份全会话 diff），且 user/assistant 消息没有 `summary.diffs`。因此 code rewind **不再回退使用 `sessions.diff`**；只在每个目标回合都有 `filesKnown` + 完整、可反转的回合级 patch 时显示；当前环境默认隐藏（见 §6/§7）。
- `session.revertDiff` 接收 `{patches:[{file?,patch,hunkIndices}]}`；单回合全 hunk 反转用 `patch + 0..@@-1`。多回合顺序应用，避免同一文件跨回合 patch 拼接冲突。
- `summary.diffs` 是 per-turn 历史快照（不是 VCS 当前态），随 user 消息携带；时间线用它展示"该回合改了哪些文件"，缺失时回退 `sessions.diff(messageID)` 拉取。
- pi runtime：`diffApi:false` → 隐藏「只回滚代码」；`sessionBranchApi:true`（有 revert）→ 仅对话回滚，且保留目标 prompt。

## 3. 入口与形态

- **入口**：ChatPane 标题栏新增 `ButtonV2 ghost small`「时间线」+ Tooltip「检查点 / 回滚」。不用 double-Esc（Esc 已被中断占用）。
- **形态**：模态 overlay（复用现有 backdrop/panel 视觉语言），最大高度 70vh，可滚动；标题「时间线」+ 副标题「仅显示最近 30 天」+ 关闭。
- **行**：时间（本地 `HH:mm` / 日期）+ prompt 摘要（单行 ellipsis）+ 文件 chips（最多 5 个 + `+N`）+ 操作。
- **最新回合**：最新一条 **已持久化** user 消息标「最新」，**保留操作**（它就是"撤销最后一回合"的入口；inline revert 已有同样能力，不能隐藏）。
- **数据范围**：只渲染 `store.message` 已加载的窗口（首屏 100 条 + 聊天自身的 backfill/「加载更早」）；副标题写「已加载的历史（最多 30 天）」而不是承诺完整 30 天；footer 提示「更早的检查点请先在聊天中加载更早历史」。本批不做 overlay 独立分页/虚拟滚动。
- **空态**：无 user 回合 → 「本会话还没有可回滚的检查点」。
- **运行中**：允许打开查看；回滚操作禁用并提示「会话运行中，结束后可回滚」。

## 4. 数据与纯逻辑

`checkpoint-model.ts`：

```ts
export interface CheckpointFile { file: string; additions?: number; deletions?: number; status?: string; patch?: string }
export interface Checkpoint {
  messageID: string
  createdAt: number | null
  prompt: string
  files: CheckpointFile[]
  filesKnown: boolean
}
export function buildCheckpoints(
  messages: any[],
  parts: Record<string, any[]>,
  now: number,
  retentionDays = 30,
): Checkpoint[]
```

- 只取 `role === "user"` 的消息；按 `time.created` **倒序**（最新在前）。
- **排除未持久化消息**：`isLocalMessageId(id)`（`user-`/`local-`/`queued-` 前缀）不建 checkpoint；否则会拿一个不存在的 messageID 去 revert（404）。
- prompt：`message.text`（2.1 info.text）→ 否则 `parts[message.id]` 的 text parts 拼接 → 否则「(无文本)」；UI 截断显示。
- files：`message.summary.diffs` 中合法条目（`file` 非空字符串），复制 `additions/deletions/status/patch`（patch 供代码回滚使用，UI 不展示）；`filesKnown=false` 表示该 runtime/消息没有提供回合级摘要（区别于"有摘要但无改动"）。
- 30 天过滤：`createdAt != null && createdAt >= now - retentionDays*86400000`；`createdAt == null` 保留（时间未知，不静默丢）。
- 跳过非 user、缺 id、畸形 diffs。

`checkpoint-revert.ts`：

```ts
export function allHunksPatches(files: FileDiffEntry[]): Array<{ file?: string; patch: string; hunkIndices: number[] }>
```

- 只收 `patch` 非空；`hunkIndices` = `0..(@@ 行数-1)`；0 hunk 的文件跳过；空结果返回 `[]`（调用方不发送）。
- 与 gateway `validateEntries` 的 `@@ ` 计数口径一致。

## 5. 操作与运行时语义

### 5.1 回到这里（对话 + 文件）

- `sessions.revert(sessionID, messageID)`（现有 SDK）。
- **不可逆**（opencode 2.1）：二次确认，文案明确「会 stage+commit，无法通过 unrevert 恢复；请确认已提交/备份」。
- 若 `revertUndoApi === true`（旧 runtime）：文案改为「可通过撤销回滚恢复对话内容」。
- 成功后：关闭 overlay → `refreshAfterRevert()`（清空当前会话 message/part 缓存并重拉）→ toast。
- 失败：toast 错误，overlay 保持打开。

### 5.2 只回滚代码（回到该检查点之前）

- 仅 `caps.diffApi === true` **且** `canRewindCode(targets)` 为真时显示；否则隐藏，并在顶部提示数据不可用。
- **前置门 `canRewindCode`**：目标及之后每个回合 `filesKnown === true`；有文件的回合每条 `patch` 非空且 `isInvertiblePatch`（拒绝 `/dev/null`、`new file mode`、`deleted file mode`——gateway 的 hunk 反转不支持新增/删除文件）；至少一个回合有文件改动。
- 语义：撤销目标 checkpoint 及其之后所有回合的文件改动，对话与消息保留（工作树回到"发出目标 prompt 之前"）。
- 计算目标集合：`checkpointsToRewind(checkpoints, targetMessageID)` = 目标行及所有更新行（newest-first，目标在最后）。二次确认显示「将撤销这条消息所在的回合及之后 N 个回合的文件改动」。
- 逐回合 **newest → oldest** 执行：
  1. 该回合 `files` 为空 → 计入 `noChanges`，跳过；
  2. `allHunksPatches(files)` → `sessions.revertDiff(sessionID, patches)`；await 成功后再处理下一回合；
  3. **不调用 `sessions.diff`**（2026-10-23 实测为全会话 diff，不是回合级）。
- 计数器：`applied` / `noChanges`；成功 toast 写「已应用 X 个回合，Y 个回合无文件改动」；`applied===0` 提示「没有可回滚的代码改动」；失败 toast 写「已应用 X/N 个回合；工作树可能处于中间态」。绝不把跳过的回合算作已应用。
- **当前 opencode 2.1**：没有 `summary.diffs` → `filesKnown=false` → 代码回滚按钮隐藏；文件 chips 显示「文件记录不可用（当前 runtime 不提供回合级摘要）」。对话回滚仍可用。
- 不做「只撤销目标这一回合」的另一种语义（由 ChangesDock 的 hunk 级操作覆盖）。

### 5.3 运行时门与文案

- `sessionBranchApi === false`：隐藏「回到这里」。
- `diffApi === false`：隐藏「只回滚代码」；overlay 顶部提示「当前 runtime 的回滚只影响对话，不改文件」。
- `runtimeName` / `revertUndoApi` 进入文案助手 `revertWarning(runtimeName, undoable, diffApi)`：
  - `pi`：「pi 回滚保留这条消息、只撤回其后的回复；文件不会回滚，且不可撤销。」
  - `opencode` + `!undoable`：「opencode 2.1 的回滚会 stage+commit，撤回这条消息及其后内容；不可撤销，请确认已提交/备份。」
  - `opencode` + `undoable`：「撤回这条消息及其后内容；可通过撤销回滚恢复对话。」
  - 未知 runtime：「当前 runtime 的回滚语义以运行时为准；请确认已备份。」
- 最新回合同样显示操作：即使"回到这里"意味着撤销最近一回合，这也是有用的入口（与 inline revert 一致）。
- `revertUndoApi` 只影响文案与既有 undo 入口，不影响本 overlay 的操作集合。

### 5.4 既有 inline revert 修正

- `ChatPane` 的 revert 确认文案改为调用同一个 `revertWarning(props.runtimeName, props.revertUndoEnabled, caps.diffApi)`，不再写死「可恢复」。
- 现有 `doRevert` 抽取为 `revertTo(messageID)`，overlay 与 inline 共用；`revertCodeTo(targetMessageID)` 供代码回滚。
- `ChatPaneProps` 增加 `runtimeName?: string` / `runtimeCaps?: Record<string, boolean>`；MafwShell 传 `rtName()` / `rtCaps()`。

## 6. Builder check 裁定（2026-10-23，五项）

1. **「只回滚代码」语义**：确定为"回到发出目标 prompt 之前"——收集目标及之后所有 checkpoint，按 newest→oldest 逐回合 `revertDiff`；不是单次 `diff(target)`。每回合 patch 顺序应用，失败即停并报告已完成数（工作树可能中途）。`summary.diffs` 带完整 patch 时直接用；任一回合缺失 patch 或为空时回退 `sessions.diff(messageID)`。
2. **回滚边界**：opencode 撤回目标消息及之后；pi 保留目标消息、只撤回其后回复且不改文件。二者文案由 `revertWarning(runtimeName, undoable, diffApi)` 生成；最新一条已持久化 user 消息**保留操作**（撤销最近回合有用），不再标"当前且不可操作"。
3. **时间线数据范围**：只渲染已加载窗口（首屏 100 + 聊天 backfill/加载更早）；不实现 overlay 独立分页/虚拟滚动；副标题与 footer 如实说明，不承诺完整 30 天。
4. **运行时文案**：`runtimeName` + `revertUndoApi` + `diffApi` 进入同一文案助手；pi 不再显示"opencode 2.1 stage+commit"的错误提示；未知 runtime 用保守文案。
5. **未持久化消息**：`isLocalMessageId`（`user-`/`local-`/`queued-`）不建 checkpoint，避免用不存在的 messageID 回滚；"最新"标记取最后一条持久化 user 消息。

## 7. 文件预估

| 文件 | 动作 |
|---|---|
| `packages/desktop/src/renderer/mafw/components/checkpoint-model.ts` + `.test.ts` | 新建纯模型 |
| `packages/desktop/src/renderer/mafw/components/checkpoint-revert.ts` + `.test.ts` | 新建 all-hunks 纯函数 |
| `packages/desktop/src/renderer/mafw/components/CheckpointOverlay.tsx` | 新建模态 |
| `packages/desktop/src/renderer/mafw/components/ChatPane.tsx` | 入口按钮、overlay、`revertTo`/`revertCodeTo`、caps prop、inline 文案 |
| `packages/desktop/src/renderer/mafw/MafwShell.tsx` | 传 `runtimeCaps={rtCaps()}` |
| `packages/desktop/src/renderer/mafw/mafw.css` | overlay/行/chips/确认条 |
| `packages/desktop/tests/checkpoint-wiring.test.ts` | 接线断言 |

## 8. 测试策略

- `checkpoint-model.test.ts`：只取 user；倒序；text/parts 回退；30 天过滤；null 时间保留；files 复制与畸形跳过；本地/乐观/queued id 排除；空会话。
- `checkpoint-revert.test.ts`：单文件 2 hunk → [0,1]；多文件；无 patch 跳过；0 hunk 跳过；空输入；`checkpointsToRewind` 的 newest-first 顺序与目标包含；`revertWarning` 的 opencode(undoable/不可逆)/pi/未知 runtime 文案。
- `checkpoint-wiring.test.ts`：ChatPane 有「时间线」入口/overlay/`runtimeName`/`runtimeCaps`/`revertCodeTo`；overlay 按 `diffApi`/`sessionBranchApi` 显隐；最新行保留操作；inline revert 走同一文案；MafwShell 传 caps/name。
- 门禁：desktop `npm test`、`tsgo --noEmit`、`electron-vite build`。
- 手工冒烟：打开时间线看行/文件；在 scratch 会话验证「只回滚代码」的多回合顺序与部分失败提示；运行中禁用；opencode 2.1 的不可逆文案；pi 文案只做单元/接线验证（不切 runtime）。对话回滚本身是破坏性操作，冒烟只在 scratch 会话做。

## 9. 非目标

- 自动 git 备份/快照（opencode 2.1 无 unrevert；本批只做显式警告，不新建 backup 分支）。
- 对话-only 回滚（SDK 无此语义）。
- 只撤销目标单回合的代码（代码回滚按 newest→oldest 回退到目标之前；单回合 hunk 操作由 ChangesDock 覆盖）。
- overlay 独立分页/虚拟滚动（只渲染已加载窗口；更早历史先在聊天中加载）。
- 跨会话/跨 worktree 时间线、30 天后的归档清理。
- double-Esc 快捷入口、checkpoint 命名/收藏。
- gateway/runtime 改动。

## 10. 风险

| 风险 | 处置 |
|---|---|
| 2.1 revert 不可逆，用户误点 | 二次确认 + runtime-aware 文案 + 运行中禁用；不做静默操作 |
| 多回合代码回滚中途 patch 冲突 | 逐回合 newest→oldest；失败立即停 + 报告已完成 N/M；不自动重试/不假装成功 |
| `summary.diffs` 缺失 → 文件 chips 空 | 显示「无文件记录」；代码回滚时回退 `sessions.diff(messageID)` 拉取 |
| pi 回滚保留目标消息且不改文件 | `revertWarning` 与 `diffApi` 门控区分；不显示 opencode 文案 |
| 未持久化消息（user-/local-/queued-） | `buildCheckpoints` 直接排除，避免 404 |
| 加载窗口不是完整 30 天 | 副标题写「已加载的历史（最多 30 天）」+ footer 提示先加载更早 |
| 30 天过滤本地时钟偏差 | 仅 UI 过滤，不删数据；时间未知保留 |
| 大量 checkpoint 渲染卡顿 | 已加载窗口有限；不做独立分页/虚拟滚动（YAGNI） |

## 11. Final review correction（2026-10-23 终审实测）

1. **代码回滚数据源**：当前 opencode 2.1 的 `session.diff(messageID)` 不按 messageID 过滤，返回全会话 diff；user/assistant 消息也没有 `summary.diffs`。因此 **code rewind 不使用 `sessions.diff` fallback**；只有 `filesKnown + 完整可反转 patch` 时才显示；当前环境默认隐藏（对话回滚不受影响）。
2. **新增/删除文件**：gateway `invertHunks` 不交换 `---/+++` 头，无法反转 `new file mode`/`deleted file mode`；`isInvertiblePatch` 拒绝这类 patch，含此类文件的回合禁用代码回滚。
3. **确认防双击**：行按钮只 requestConfirm；只有确认面板的「确认」按钮执行；行按钮在确认态打开时禁用。
4. **Busy gate**：`revertTo` 与 inline 确认按钮都按 `sending`/session busy 禁用；overlay 同步禁用。
5. **Runtime 刷新**：`runtime_switched` 事件触发 `loadRuntimeInfo()`，避免热切换后沿用旧 caps/name。
6. **文件 chips 诚实**：`filesKnown=false` → 「文件记录不可用」；`filesKnown=true && files=[]` → 「无文件改动」。
