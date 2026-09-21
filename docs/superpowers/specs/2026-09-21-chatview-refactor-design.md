# ChatView 结构与美学重构设计

> 日期：2026-09-21
> 状态：已确认（用户逐节审批 §1-§4）
> 前置：方向 C（任务中心 IA）已调研暂缓（见 2026-09-21-direction-c-task-centric-ia-research.md），本设计不做 IA 变革。

## 背景

ChatPane.tsx 2351 行 + `@ts-nocheck` + 45 个 props（含 5 对 register/unregister 隐藏契约）；sendMessage 235 行五合一；分页合并逻辑在 MafwShell.loadSessionHistory 与 ChatPane.loadOlder 重复两份；flow-card 规则（HIDDEN_TOOLS / CONTEXT_GROUP_TOOLS / renderable(question)）在 desktop flow-card-placement.ts 与 session-ui message-part.tsx 三处手工镜像，靠注释防漂移；store 数据双入口（props + DataProvider）；乐观消息 id 靠 `user-` 字符串前缀三处硬编码识别；workspace 单例已就位但 prop 收敛半途而止（2026-09-20-desktop-ux-refactor-design.md §2.2 未竟项）；isManager 是全局态 prop，split view 下 B pane 错拿 A pane 标记。

美学层 v5（暖纸色板 / 双字体契约 / motion discipline / bento）已落地，主问题在 CSS 工程性：mafw.css 4567 行尾部追加区失序、重复规则、硬编码色残留（旧蓝 `#7aa2f7`、`#e8636b`、diff 面板 rgba 一族）、大量直穿 session-ui 内部 DOM 的 override。

## 决策记录（brainstorming 结论）

| 问题 | 结论 |
|---|---|
| 重构边界 | 结构 + 美学；不做方向 C 的 IA 变革 |
| 拆分激进度 | 彻底类型化 + 共享契约（抽模块 + 去 ts-nocheck + props 收敛 + 规则镜像收编） |
| ts-nocheck 范围 | 仅重构触达文件；拆出的新模块必须严格类型化 |
| 共享契约位置 | session-ui 导出 parts-rules.ts，单一真相源 |
| CSS 深度 | 归位 + 去重 + token 化；session-ui 穿透 override 本轮不动 |
| 执行模式 | 绞杀者分波次（W1→W4），每波独立可测可提交可回滚 |

## W1 共享契约（parts-rules + id 约定）

目标：消灭三处手工同步地雷 + 乐观 id 字符串前缀匹配。

1. 新建 `packages/session-ui/src/parts-rules.ts`（纯 TS 无框架依赖）：
   - `HIDDEN_TOOLS`、`CONTEXT_GROUP_TOOLS`（从 message-part.tsx 提取）
   - `renderable(part, showReasoningSummaries)`（从 message-part.tsx 原样搬迁）
   - `isTopLevelToolEntry(part)`（从 desktop flow-card-placement.ts 迁入，复用同包常量，不再镜像）
   - message-part.tsx 改为从 `./parts-rules` import，行为零变化
2. `packages/session-ui/src/index.ts` re-export parts-rules。
3. desktop `flow-card-placement.ts`：删本地镜像的 `isTopLevelToolEntry` 与常量，改 `import { isTopLevelToolEntry } from "@mafw/session-ui"`；`inlineAnchor`/`findPendingToolPart` 保留（desktop 专属）。
4. 乐观 id 约定：新增 `isLocalMessageId(id)`（判定 `user-`/`local-`/`queued-` 前缀），替换 chat-reducers.ts:21、ChatPane handleVoiceSegment、applyPartUpsert 三处字符串前缀硬编码。

测试：session-ui 侧 parts-rules 单测（renderable/isTopLevelToolEntry 矩阵）；desktop 现有 18 个 flow-card-placement 测试跑共享实现防漂移。
风险：低（纯提取 + import 替换）。

## W2 ChatPane 拆模块

目标：ChatPane ≤600 行布局壳；拆出 5 个独立、可测、严格类型化（无 ts-nocheck）模块，放 `packages/desktop/src/renderer/mafw/chat/`。

| 文件 | 来源（ChatPane 行号） | 职责 | 形态与返回 |
|---|---|---|---|
| `use-attachments.ts` | 608-814 | 文件选择/粘贴/拖拽/canvas 下采样/A2A 上传/mime 表 | hook → `{ attachments, addFiles, addPaste, addDrop, removeAttachment, clearAttachments, uploading }` |
| `use-voice-binding.ts` | 381-584 + 1386-1420 | VoiceSession 接线、assistant 播报、语音分段上传、mediaSpeak 注册、自动播放 effect | hook → `{ voiceState, speakText, startRecording, stopRecording, interruptTts }` |
| `use-send-message.ts` | 816-1051 | sendMessage 五合一拆分 | hook → `{ send, sending, interrupt }`；内部拆 `handleSlash`/`uploadPendingMedia`/`optimisticWrite` 纯函数 |
| `TtsPicker.tsx` | 1232-1306 + 2343-2417 | TTS 引擎/音色/风格完整 UI + 状态 | 组件，props 仅 `{ sessionID }` |
| `flow-card-slots.ts` | 1633-1719 | hasInlineAnchor/inlineCardsForPart/cardsForTurn/unplacedCards/turnOfMessage | 纯函数模块（收 store + cards 数组），ChatPane 只调用 |

ChatPane 保留：titlebar、turn For 循环、滚动系统、renderLimit/visibleTurns、composer JSX 骨架、键盘导航。props 暂不动（W3 收敛）。

依赖方向：5 模块只依赖 workspace/store/纯函数，互不依赖；ChatPane 唯一组装点。

测试：各 hook 纯逻辑（下采样尺寸、slash 匹配、卡片归位）抽纯函数进 bun test；现有 643 测试全量通过为门禁。
风险：中（语音/附件行为密集区逐函数对照搬迁；sendMessage 乐观写库与 chat-reducers 保序）。

## W3 props 收敛 + workspace 注册表 + isManager 修复

目标：ChatPaneProps 45 字段 → 最小集；消灭 5 对 register/unregister props；修 isManager 全局态 bug。

1. workspace 注册表泛化：五个独立 Record 收敛为一个 `Map<CallbackKind, Record<sid, fn>>`；对外 API 不变（`workspace.register(kind, sid, fn)` 返回 unregister / `workspace.call(kind, sid, ...)`），MafwShell 调用点语法零改动。`CallbackKind = 'anchor' | 'sendingReset' | 'queueFlush' | 'phase' | 'mediaSpeak'`。
2. ChatPaneProps 收敛为：
   ```ts
   interface ChatPaneProps {
     sessionID: string
     workspace: SessionWorkspace
     paneId: 'A' | 'B'
     onClose?: () => void
   }
   ```
   删除：`store`/`setStore`（走 workspace）、10 个 register/unregister（走 workspace.register）、`flowCards`/`upsertCard`/`resolveCard`/`sessionCards`（shell 级状态经 context 或 workspace 暴露）、`isManager`（删 prop，改 ChatPane 内部 `workspace.sessionRole(sessionID) === 'manager'` per-session 判定）、`modelPicks`/`agentPicks`（workspace 已有 Record，直接读）。
3. MafwShell：删传给 ChatPane 的 40+ props；flow cards 状态经 Solid context（FlowCardsProvider）或 workspace 暴露给 ChatPane 与 titlebar。

测试：workspace 注册表泛化 bun 测试（register/call/unregister 矩阵）；isManager per-session 判定测试（split view 两 pane 不同 role）；现有 643 全量通过。
风险：中高（MafwShell props 传递链改动面大；flow cards 从 props 改 context 涉及 keyboardOwnerId 归属）。

## W4 CSS 归位 + token 化 + 图标统一

目标：mafw.css 按域分区可读；消灭重复规则与硬编码色；统一剩余字符 glyph 为 SVG Icon。

1. 按域归位（不改样式值，只移动 + 区段注释）：固定区段顺序 `tokens → base → motion → rail → tabs → chat(session-turn/composer/chips/flow-cards/voice/tts/phase/queue/msgnav) → pickers → overlays → docks → dashboard/bento → config → diff → misc`；尾部 4400+ 追加区拆解归位；每区段加注释头。
2. 去重：`.mafw-usage-stack-bar` 两处合并；`.mafw-session-turn-container{position:relative}`(4497) 并入 697 主规则；`.mafw-config-oc-name` font-size 三遍去重；全文件扫描重复规则。
3. 硬编码色 token 化：`#7aa2f7`→token；`#e8636b`→`var(--danger)`；diff 面板 rgba 一族→token；tokens 区外的 `#xxx` 字面量全部替换。
4. 图标统一：titlebar `✕`→`Icon name="x"`；`⎇`→`git-branch`；`← 返回`→`arrow-left`+文字；jump/发送按钮内联 SVG→Icon；`.mafw-stop-icon` CSS 方块保留（停止语义约定）；composer-icons.test.ts 扩充断言。

不动：session-ui 穿透 override 保留原样，区段注释标注"穿透区——session-ui DOM 变更高危"。

门禁：`electron-vite build` 通过 + 现有 643 bun 测试 + 人工目检（chat/dashboard/config）；图标替换点进 composer-icons.test.ts。
风险：低中（纯移动可能改变 specificity，需对照渲染；图标名 git-branch/arrow-left/x 已确认在 v1 表）。

## 全局门禁

每波完成：desktop `bun test` 全量通过（当前基线 643）+ `npx electron-vite build` 通过 + 独立 commit。任一波出问题可独立回滚不阻塞后续。

## 非目标

- 方向 C 任务中心 IA（对话退位/产出物上位/双栏工件列）
- session-ui 穿透 override 收编为样式 API（仅标注高危区）
- 全 renderer ts-nocheck 清理（仅触达文件）
- MafwShell 自身 2598 行拆分（本设计只动它与 ChatPane 的 props 界面）
