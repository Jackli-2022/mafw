# 模型选择按 session 隔离设计（input bar 打开即与该 session 一致）

日期：2026-09-15
状态：已批准（对话中用户确认：per-session 选择态 / 派生优先级 手选→会话历史→全局默认）

## 背景与问题

桌面端 input bar 的模型选择器（model pill）当前是**全局单例**（`MafwShell.tsx:73` 的 `modelSel` 信号，注释即 "shared across panes"）：

- providers 加载后，若未手选，默认取 localStorage `mafw-recent-models` 最近项（`MafwShell.tsx:1806-1835`）——与 session 无关
- split view 的多个 ChatPane（`MafwShell.tsx:2392/2652` 渲染点）共享同一 selector，A pane 手选会改掉 B pane
- 打开一个历史上用模型 B 的会话，pill 与发送路径仍指向全局默认 A
- ChatPane 已有 session 感知的局部逻辑：`pickerCurrentKey`（ChatPane.tsx:1474-1482）从最后一条 assistant 消息读 model 用于 picker 高亮——证明 per-session 数据源（消息自带 `model`）现成可用

## 目标

打开/切换任意会话时，input bar 模型选择器与**该 session 之前实际使用的模型一致**；split view 各 pane 互相独立。

## 行为规则（派生优先级，高→低）

1. **用户手选（内存态）**：`Record<sessionID, ModelSel>`，`onModelSelect` 写入当前 pane 的 sid；手选后固定，直到再次手选
2. **会话历史派生**：该 session 最后一条 assistant 消息的 `model`（`store.message[sid]`，响应式——新回复到达自动跟随）；label 经 `modelGroups` 解析（`m.name || m.modelID`，provider 断开时回退 modelID）
3. **全局 recent 默认**：`mafw-recent-models` 最近项（providers 加载效果现有逻辑，改写入 `defaultModel` 信号）
4. 都没有 → null（显示 "default"）

跨重启：手选不持久化（内存态）——重启后打开会话回到其历史模型，正是期望行为。

## 实现改动

**`MafwShell.tsx`**（约 40 行）：

- 删除全局 `modelSel` 信号，新增：
  - `type ModelSel = { providerID: string; modelID: string; label: string }`
  - `const [modelPicks, setModelPicks] = createSignal<Record<string, ModelSel>>({})`
  - `const [defaultModel, setDefaultModel] = createSignal<ModelSel | null>(null)`
  - `sessionModel(sid): ModelSel | null` 纯函数（读取均为响应式源：modelPicks / store.message / modelGroups / defaultModel）
- providers 加载效果中 `setModelSel(found)` → `setDefaultModel(found)`，守卫由 `modelSel() === null` 改为 `defaultModel() === null`
- `onModelSelect(m, sid?)`：写 `setModelPicks({ ...modelPicks(), [sid ?? currentSessionID()]: {...} })`
- ChatPane 渲染点（`MafwShell.tsx:2392`，SplitView renderLeaf 内）：`model={modelSel}` → `model={() => sessionModel(leaf.sid)}`
- UsageDock（`MafwShell.tsx:2652`）：`model={modelSel}` → `model={() => sessionModel(currentSessionID())}`

**`ChatPane.tsx`**（约 3 行）：

- props 类型 `onModelSelect: (m: ModelEntry, sid?: string) => void`
- `onModelSelectWrap` 调用 `props.onModelSelect(m, sidProp())`
- `props.model` 消费方（`pickerCurrentKey` / `currentModelLabel` / 发送路径 1100 行）零改动自然受益

## 非目标

- 不改 ModelPicker 组件（recent-models 写入、分组、搜索逻辑保持）
- 不持久化 per-session 手选（重启回历史模型即期望行为）
- 不动 `agentSel`（agent 选择同样全局共享，另行处理）
- gateway / SDK 零改动（纯 renderer）

## 验证

- desktop 无 test script（不在 CI）：`npx electron-vite build`（main/preload/renderer 三段）作门禁
- 人工验证点：①切换两个用过不同模型的会话，pill 跟随各自最后模型；②手选后发送走手选模型且 pill 固定；③split view 两 pane 独立；④新会话落到 recent 默认
